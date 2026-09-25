@AGENTS.md

# StockFlow ERP: project rules

- All inventory-changing logic runs in PostgreSQL functions (one transaction). Clients never write
  `inventory` or `stock_movements`; both are revoked for `authenticated`.
- `stock_movements` and `audit_log` are append-only (trigger-enforced). Corrections = reversal movements.
- Schema changes: add a new file in `supabase/migrations/`, never edit an applied migration.
  Then run `npm run db:types` and add tests in `tests/db/`.
- No `any`. Keep components small; shared UI lives in `src/components/ui`.
- Verify with `npm run check` (typecheck + lint + tests). Use the npm scripts: the project path contains
  `&`, which breaks `npx <tool>` shims on Windows.
