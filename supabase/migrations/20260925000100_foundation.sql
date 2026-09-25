-- =============================================================================
-- StockFlow ERP - 01 Foundation
-- Schemas, enum types, shared trigger helpers, roles, user profiles, audit log.
-- =============================================================================

-- Internal helpers live in a schema that is NOT exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
-- Enum types (statuses and movement types)
-- -----------------------------------------------------------------------------
create type public.movement_type as enum (
  'PURCHASE_RECEIPT',
  'SALE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'RETURN'
);

create type public.purchase_order_status as enum (
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED'
);

create type public.sales_order_status as enum (
  'DRAFT',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'COMPLETED',
  'CANCELLED'
);

create type public.transfer_status as enum (
  'REQUESTED',
  'APPROVED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED'
);

-- -----------------------------------------------------------------------------
-- Shared trigger helpers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Used on append-only tables (stock_movements, audit_log).
create or replace function private.prevent_modification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: rows cannot be updated or deleted (create a reversal instead)', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

-- -----------------------------------------------------------------------------
-- Roles (a table, not an enum, so purchasing / sales can be added later)
-- -----------------------------------------------------------------------------
create table public.roles (
  id          smallint generated always as identity primary key,
  code        text not null unique check (code ~ '^[a-z][a-z_]{1,39}$'),
  name        text not null check (length(btrim(name)) > 0),
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function private.set_updated_at();

insert into public.roles (code, name, description) values
  ('admin', 'Administrator', 'Full access: master data, approvals, user management and audit log.'),
  ('warehouse_manager', 'Warehouse Manager', 'Manages products, inventory, stock movements and warehouse operations.');

-- -----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  role_id    smallint not null references public.roles (id),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_role_id_idx on public.profiles (role_id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- A profile is created automatically for every new auth user.
-- The role comes from app_metadata.role, which only the service role can set.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_code text := coalesce(new.raw_app_meta_data ->> 'role', 'warehouse_manager');
  v_role_id   smallint;
begin
  select r.id into v_role_id
  from public.roles r
  where r.code = v_role_code and r.is_active;

  if v_role_id is null then
    raise exception 'Cannot create profile: unknown or inactive role "%"', v_role_code;
  end if;

  insert into public.profiles (id, email, full_name, role_id)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
    v_role_id
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- Role helpers used by RLS policies.
-- SECURITY DEFINER so policies can read profiles without recursive RLS checks.
-- -----------------------------------------------------------------------------
create or replace function private.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.code
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = auth.uid()
    and p.is_active
    and r.is_active;
$$;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_app_role() is not null;
$$;

create or replace function private.has_any_role(variadic p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() = any (p_roles), false);
$$;

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- user_id intentionally has no FK: audit history must survive user removal.
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  user_id     uuid,
  user_email  text,
  action      text not null check (action ~ '^[A-Z][A-Z_]{1,49}$'),
  entity_type text not null check (length(btrim(entity_type)) > 0),
  entity_id   text,
  details     jsonb not null default '{}'::jsonb,
  old_values  jsonb,
  new_values  jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index audit_log_occurred_at_idx on public.audit_log (occurred_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_user_id_idx on public.audit_log (user_id);
create index audit_log_action_idx on public.audit_log (action);

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function private.prevent_modification();

-- Single entry point for writing audit entries (used by triggers and, in later
-- phases, by business RPCs such as receive_goods / ship_sales_order).
create or replace function private.write_audit(
  p_action      text,
  p_entity_type text,
  p_entity_id   text,
  p_details     jsonb default '{}'::jsonb,
  p_old_values  jsonb default null,
  p_new_values  jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_id      bigint;
begin
  insert into public.audit_log (user_id, user_email, action, entity_type, entity_id, details, old_values, new_values)
  values (
    v_user_id,
    (select p.email from public.profiles p where p.id = v_user_id),
    p_action,
    p_entity_type,
    p_entity_id,
    coalesce(p_details, '{}'::jsonb),
    p_old_values,
    p_new_values
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Generic row-level audit trigger for master data tables.
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_changed jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb)
      into v_changed
    from jsonb_each(v_new) n
    where n.key <> 'updated_at'
      and v_old -> n.key is distinct from n.value;

    -- Nothing but updated_at changed: skip the noise.
    if v_changed = '{}'::jsonb then
      return new;
    end if;
  end if;

  perform private.write_audit(
    tg_op,
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    case when v_changed is null then '{}'::jsonb
         else jsonb_build_object('changed_fields', v_changed) end,
    v_old,
    v_new
  );

  return coalesce(new, old);
end;
$$;
