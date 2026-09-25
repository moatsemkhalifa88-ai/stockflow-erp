# StockFlow ERP

An inventory and warehouse management system built as a realistic internal business application:
multi-warehouse stock, purchasing, sales, transfers, and a fully audited stock ledger.

> **Status:** Phase 1 of 6 (foundation) is complete: database schema, authentication, roles and RLS, the app shell and demo master data.
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
2. **Stock can never go negative.** `CHECK (quantity >= 0)` on `inventory` plus row locking in the movement engine.
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
| `DEMO_USER_PASSWORD`                   | `seed:users` only  | Optional password for demo accounts                            |

## Scripts

| Command              | Description                                                             |
| -------------------- | ----------------------------------------------------------------------- |
| `npm run dev`        | Start the development server                                            |
| `npm run build`      | Production build                                                        |
| `npm run typecheck`  | Generate route types and run `tsc --noEmit`                             |
| `npm run lint`       | ESLint                                                                  |
| `npm test`           | Database test suite (migrations, constraints, RLS) on embedded Postgres |
| `npm run check`      | typecheck + lint + tests                                                |
| `npm run db:types`   | Regenerate `src/types/database.ts` from the migrations                  |
| `npm run seed:users` | Create or update the demo login accounts                                |

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

**Movement types:** `PURCHASE_RECEIPT`, `SALE`, `TRANSFER_IN`, `TRANSFER_OUT`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `RETURN`.

A full ER diagram will be added in Phase 6.

### Roles and access (Phase 1)

| Capability                              | Admin | Warehouse Manager |
| --------------------------------------- | :---: | :---------------: |
| Read operational data                   |  ✅   |        ✅         |
| Create / edit products and categories   |  ✅   |        ✅         |
| Create / edit warehouses                |  ✅   |        –          |
| Create / edit suppliers and customers   |  ✅   |        –          |
| Manage users (profiles, roles)          |  ✅   |        –          |
| Read the audit log                      |  ✅   |        –          |
| Write inventory / movements directly    |  –    |        –          |
| Hard-delete anything                    |  –    |        –          |

Unauthenticated users have no access to any table. Deactivated users can only read their own profile.
The `roles` table is designed so that `purchasing` (Phase 3) and `sales` (Phase 4) are simply new rows plus policies.

## Testing

```bash
npm test
```

The suite creates a fresh in-memory PostgreSQL ([PGlite](https://pglite.dev)) per test file, applies a small
Supabase stub (roles, `auth.users`, `auth.uid()`), then every migration and the seed. It checks that:

- all tables exist, have RLS enabled and have `created_at` / `updated_at`
- the seed loads and is idempotent, with valid EAN-13 barcodes
- inventory can't go negative or be duplicated per product + warehouse
- stock movements are append-only and internally consistent
- anonymous users are denied everywhere
- each role can only do what the access table above allows
- master-data changes are audited with the acting user

## Project structure

```
src/
  app/
    (app)/            # protected area: layout checks the session + role
      dashboard/
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
scripts/              # seed-users, generate-db-types
tests/db/             # PGlite test harness and DB tests
```

## Roadmap

- [x] **Phase 1: Foundation.** Schema, auth, roles, RLS, app shell, seed data
- [ ] **Phase 2: Inventory engine.** `create_stock_movement`, reversals, products, warehouses, inventory, adjustments
- [ ] **Phase 3: Purchasing.** Suppliers, purchase-order workflow, `receive_goods`
- [ ] **Phase 4: Sales and transfers.** Customers, sales orders, `ship_sales_order`, warehouse transfers
- [ ] **Phase 5: Analytics.** Dashboard KPIs and charts, alerts, reports with CSV export, audit-log UI, BI views
- [ ] **Phase 6: Polish.** Full documentation, ER diagram, screenshots, Power BI

---

All companies, people and addresses in the demo data are fictional.
