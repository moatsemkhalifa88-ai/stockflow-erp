# StockFlow ERP

An inventory and warehouse management system built as a realistic internal business application:
multi-warehouse stock, purchasing, sales, transfers, and a fully audited stock ledger.

> **Status:** Phase 2 of 6 is complete. Phase 1 delivered the foundation (schema, auth, roles, RLS, app shell, demo data).
> Phase 2 adds the inventory engine plus the products, warehouses, inventory and stock-movement modules.
> See the [roadmap](#roadmap).

## Tech stack

| Layer     | Technology                                                  |
| --------- | ----------------------------------------------------------- |
| Frontend  | Next.js 16 (App Router), React 19, TypeScript (strict)      |
| Styling   | Tailwind CSS 4, lucide-react icons                          |
| Backend   | Supabase: PostgreSQL 17, Auth, Row Level Security           |
| Charts    | Recharts (Phase 5)                                          |
| Testing   | Vitest + PGlite (embedded PostgreSQL, no Docker needed)     |

## Core design principles

1. **Business logic lives in PostgreSQL.** Every inventory-changing operation (receipts, shipments, transfers,
   adjustments, reversals) runs in a single transaction inside a PostgreSQL function. The client never writes
   quantities directly. RLS and revoked privileges enforce this.
2. **Stock can never go negative.** `CHECK (quantity >= 0)` on `inventory` plus row locking in the movement engine
   (see [Inventory engine](#inventory-engine)).
3. **Append-only ledger.** Every quantity change creates a `stock_movements` row with `quantity_before` /
   `quantity_after`. Movements cannot be updated or deleted (a trigger blocks it); mistakes are corrected with reversal movements.
4. **Everything is audited.** Master-data changes are written to `audit_log` automatically, with the acting user and changed fields.
5. **Nothing is hard-deleted.** Products, suppliers, customers and warehouses are deactivated instead.

## Getting started

### Prerequisites

- Node.js 20.9+ (22 recommended)
- One of:
  - **Local:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) and the Supabase CLI (`npx supabase`)
  - **Hosted:** a free [Supabase](https://supabase.com) project

### 1. Install

```bash
npm install
cp .env.example .env.local
```

### 2a. Database: local Supabase (Docker)

```bash
npx supabase start          # starts Postgres, Auth, Studio; prints URL and keys
npx supabase db reset       # applies supabase/migrations/* and supabase/seed.sql
```

Copy `API URL`, the publishable (anon) key and the secret (service_role) key from `npx supabase status` into `.env.local`.
Studio is at http://127.0.0.1:54323.

### 2b. Database: hosted Supabase

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push --include-seed
```

Copy the project URL and API keys from **Project Settings → API Keys** into `.env.local`.
Under **Authentication → Sign In / Providers**, turn off "Allow new users to sign up" (accounts are created by an admin).

### 3. Create demo users and start the app

```bash
npm run seed:users          # creates the demo accounts (needs SUPABASE_SERVICE_ROLE_KEY)
npm run seed:stock          # optional: opening balances, posted through the inventory engine
npm run dev                 # http://localhost:3000
```

### Demo accounts

Password for all accounts: `StockFlow!2026` (override with `DEMO_USER_PASSWORD`).

| Email                           | Role              | Manages warehouses        |
| ------------------------------- | ----------------- | ------------------------- |
| `admin@stockflow.example`       | Administrator     | none                      |
| `manager.tlv@stockflow.example` | Warehouse Manager | Tel Aviv, Ashdod          |
| `manager.hfa@stockflow.example` | Warehouse Manager | Haifa, Jerusalem, Be'er Sheva |

## Environment variables

| Variable                               | Where used         | Description                                                    |
| -------------------------------------- | ------------------ | -------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | browser + server   | Supabase API URL                                               |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server   | Publishable key (`sb_publishable_…`) or legacy anon key. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also accepted |
| `SUPABASE_SERVICE_ROLE_KEY`            | `seed:users` only  | Secret / service-role key. **Never** exposed to the browser    |
| `DEMO_USER_PASSWORD`                   | `seed:users`, `seed:stock` | Optional password for demo accounts                    |
| `DATABASE_URL`                         | `test:live` only   | Postgres connection string (Session pooler). **Secret**; see [Concurrency test](#concurrency-test-real-postgresql) |
| `DATABASE_CA_CERT`                     | `test:live` only   | Optional path to Supabase CA certificate to verify TLS         |

## Scripts

| Command              | Description                                                             |
| -------------------- | ----------------------------------------------------------------------- |
| `npm run dev`        | Start the development server                                            |
| `npm run build`      | Production build                                                        |
| `npm run typecheck`  | Generate route types and run `tsc --noEmit`                             |
| `npm run lint`       | ESLint                                                                  |
| `npm test`           | Test suite on embedded Postgres: migrations, constraints, RLS, inventory engine, validation |
| `npm run test:live`  | Concurrency tests against a real Postgres (`DATABASE_URL`); cleans up after itself |
| `npm run check`      | typecheck + lint + tests                                                |
| `npm run db:types`   | Regenerate `src/types/database.ts` from the migrations                  |
| `npm run seed:users` | Create or update the demo login accounts                                |
| `npm run seed:stock` | Post demo opening balances through `create_stock_movement` (empty ledger only) |

> The npm scripts call each tool's JavaScript entry point through `node` rather than the `node_modules/.bin`
> shims, because the Windows `.cmd` shims break when the project path contains `&`.

## Database

Migrations live in [`supabase/migrations`](supabase/migrations) and are applied in order:

| Migration            | Contents                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `…0100_foundation`   | enum types, `roles`, `profiles` (auto-created from Auth), role helpers, `audit_log`       |
| `…0200_master_data`  | `categories`, `warehouses`, `products`, `suppliers`, `customers`                          |
| `…0300_inventory`    | `inventory` (unique per product + warehouse, never negative), `stock_movements` ledger    |
| `…0400_documents`    | purchase orders, goods receipts, sales orders, stock transfers (+ line tables, totals)    |
| `…0500_audit`        | audit triggers on all master data                                                         |
| `…0600_rls`          | privileges and Row Level Security policies                                                |
| `…0700_inventory_engine` | `create_stock_movement`, `reverse_stock_movement`, SKU lock, valuation and summary views |

**Movement types:** `PURCHASE_RECEIPT`, `SALE`, `TRANSFER_IN`, `TRANSFER_OUT`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `RETURN`.

A full ER diagram will be added in Phase 6.

### Roles and access

| Capability                              | Admin | Warehouse Manager |
| --------------------------------------- | :---: | :---------------: |
| Read operational data                   |  ✅   |        ✅         |
| Create / edit products and categories   |  ✅   |        ✅         |
| Create / edit warehouses                |  ✅   |        –          |
| Create / edit suppliers and customers   |  ✅   |        –          |
| Manage users (profiles, roles)          |  ✅   |        –          |
| Read the audit log                      |  ✅   |        –          |
| Post stock adjustments and reversals    |  ✅   |        ✅         |
| Write inventory / movements directly    |  –    |        –          |
| Hard-delete anything                    |  –    |        –          |

Unauthenticated users have no access to any table. Deactivated users can only read their own profile.
The `roles` table is designed so that `purchasing` (Phase 3) and `sales` (Phase 4) are simply new rows plus policies.

## Inventory engine

Stock is never typed into a table. Every change (a receipt, a sale, an adjustment or a correction) goes
through one PostgreSQL function, `create_stock_movement`, which does all of the following as **one
transaction**. Either every step happens or none of them do.

1. **Find the stock record and lock it.** Each product has one inventory row per warehouse. If it doesn't
   exist yet, it is created with quantity 0. The function then locks that row (`SELECT … FOR UPDATE`).
2. **Check the result.** It works out the new quantity. If that would be below zero, it stops with
   *"Insufficient stock: 5 available, 6 requested"* and nothing is saved.
3. **Write the ledger entry.** It adds a row to `stock_movements` with the product, warehouse, type,
   quantity, quantity **before** and **after**, unit cost, reference, reason, user and date.
4. **Update the quantity** on the inventory row.
5. **Write an audit entry** to `audit_log`.

### How it prevents negative stock, even with many users at once

Suppose two people ship the last 7 of 10 units at the same moment. Without locking, both would read "10",
both would succeed, and the warehouse would have shipped 14 units it didn't have. With the lock, the second
request **waits** until the first one finishes. It then reads the new quantity (3) and is rejected. The
database also has `CHECK (quantity >= 0)` on `inventory` as a final safety net. The live concurrency test
proves this against a real PostgreSQL server (see [Testing](#testing)).

### How reversals work

History is never edited or deleted: `stock_movements` and `audit_log` reject every `UPDATE` and
`DELETE` with a trigger. To undo a mistake, `reverse_stock_movement(movement_id, reason)` posts a **new,
opposite movement** through the same engine. For example, a receipt of +20 is reversed by an adjustment of
−20. The new movement is linked to the original (`reversal_of_id`), needs a reason and goes through the same
checks. So:

- the original row stays exactly as it was, and both rows show in the ledger;
- a movement can be reversed **once**, and a reversal cannot itself be reversed;
- reversing a receipt whose stock has already been shipped is rejected, because it would make stock negative.

### Rules and permissions

| Rule                                                    | Enforced by                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| Only admins and warehouse managers move stock           | role check at the start of both functions (`42501` otherwise) |
| Clients can't write `inventory` / `stock_movements`     | privileges revoked for `authenticated` + RLS                  |
| Adjustments need a reason                               | function check + table `CHECK`                                |
| Direction matches type (e.g. SALE is always out)        | derived in the function + table `CHECK`                       |
| Inactive products / warehouses can't receive stock      | function check (they can still be counted out)                |
| Document references must exist                          | function check for PO / GR / SO / transfer ids                |
| SKU can't change once stock has moved                   | `products_protect_sku` trigger                                |

Business documents in later phases (goods receipts, shipments, transfers) will call `create_stock_movement`
and `reverse_stock_movement` too, so every future module follows the same rules. The shared core lives in
`private.post_stock_movement`, which clients can't call.

**Inventory value** = quantity × product cost price. It is calculated in exactly one place, the
`inventory_valuation` view. The product, warehouse and dashboard totals all add up rows from that view, so
the figures always agree. **Stock status:** *Out of Stock* at 0, *Low Stock* at or below the product's
minimum stock level, otherwise *In Stock*.

## Testing

```bash
npm test            # fast, offline: embedded PostgreSQL
npm run test:live   # concurrency: real PostgreSQL with a connection pool
```

The main suite creates a fresh in-memory PostgreSQL ([PGlite](https://pglite.dev)) per test file, applies a small
Supabase stub (roles, `auth.users`, `auth.uid()`), then every migration and the seed. It checks that:

- all tables exist, have RLS enabled and have `created_at` / `updated_at`
- the seed loads and is idempotent, with valid EAN-13 barcodes
- inventory can't go negative or be duplicated per product + warehouse
- stock movements are append-only and internally consistent
- anonymous users are denied everywhere
- each role can only do what the access table above allows
- master-data changes are audited with the acting user
- the inventory engine handles receipts, rejects negative stock (and leaves nothing behind), reverses correctly
  (once only, never a reversal of a reversal) and writes audit entries
- `inventory_valuation` values stock correctly and the product / warehouse totals agree with it
- only admins and warehouse managers can call the engine; anonymous and deactivated users, other roles and
  direct table writes are all rejected

### Concurrency test (real PostgreSQL)

PGlite has a single connection, so it can't prove that row locking works. `npm run test:live` connects to
your hosted Supabase database through a connection pool and runs several transactions **at the same time on
the same inventory row**:

- a second withdrawal is shown to be *blocked by* the first (`pg_blocking_pids`). After the first commits, the
  second sees the new quantity and is rejected;
- 8 parallel withdrawals of 1 from a stock of 5: exactly 5 succeed, each seeing a different starting quantity;
- 4 parallel first receipts for a new location create exactly one inventory row;
- 2 parallel reversals of the same movement: exactly one succeeds.

It creates its own user, category, warehouse and products under a random run id and deletes all of them
afterwards, including their ledger and audit rows. To do that, it switches off the append-only triggers
**inside one transaction** as the table owner. No other session ever sees them switched off. The test
then checks that nothing was left behind and that both triggers are enabled again.

**Get `DATABASE_URL`:**

1. Supabase dashboard → your project → **Connect** (top bar) → **Connection string** tab.
2. Type **URI**, Method **Session pooler** (works on IPv4 networks; the "Direct connection" is IPv6-only).
3. Copy it: `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-<n>-<region>.pooler.supabase.com:5432/postgres`.
4. Replace `[YOUR-PASSWORD]` with the database password. If you don't know it, use **Project Settings → Database →
   Reset database password**. Percent-encode special characters (`@` → `%40`, `#` → `%23`, `/` → `%2F`).
5. Add it to `.env.local` as `DATABASE_URL=...`. It is a secret: `.env.local` is git-ignored, so never commit it.

The connection is always encrypted. To also verify the server certificate, download the CA certificate from
**Project Settings → Database → SSL Configuration** and set `DATABASE_CA_CERT=path/to/prod-ca-2021.crt`.

## Project structure

```
src/
  app/
    (app)/            # protected area: layout checks the session + role
      dashboard/
      products/       # list, detail, new, edit
      inventory/      # stock per product + warehouse with status and value
      movements/      # ledger, adjustment form, movement detail + reversal
      warehouses/     # list and detail
    login/            # sign-in page + form (Server Action)
  components/
    layout/           # app shell: sidebar, top bar, breadcrumbs, user menu
    ui/               # button, card, badge, toast, empty/error states, skeleton…
  lib/
    auth/             # session, roles, sign-in/out actions
    supabase/         # browser, server and proxy clients
  proxy.ts            # session refresh + redirect to /login
  types/database.ts   # generated database types
supabase/
  migrations/         # SQL schema
  seed.sql            # demo master data
scripts/              # seed-users, seed-stock, generate-db-types
tests/db/             # PGlite test harness and DB tests (schema, RLS, inventory engine)
tests/live/           # concurrency tests against a real PostgreSQL (npm run test:live)
tests/unit/           # validation and helper unit tests
```

## Roadmap

- [x] **Phase 1: Foundation.** Schema, auth, roles, RLS, app shell, seed data
- [x] **Phase 2: Inventory engine.** `create_stock_movement`, reversals, products, warehouses, inventory, adjustments
- [ ] **Phase 3: Purchasing.** Suppliers, purchase-order workflow, `receive_goods`
- [ ] **Phase 4: Sales and transfers.** Customers, sales orders, `ship_sales_order`, warehouse transfers
- [ ] **Phase 5: Analytics.** Dashboard KPIs and charts, alerts, reports with CSV export, audit-log UI, BI views
- [ ] **Phase 6: Polish.** Full documentation, ER diagram, screenshots, Power BI

---

All companies, people and addresses in the demo data are fictional.
