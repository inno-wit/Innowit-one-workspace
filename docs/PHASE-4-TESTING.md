# Phase 4 — Test Evidence (F4.0–F4.10)

## Full Vitest Suite (Phase 1–4)
```powershell
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/innowit_one_test?schema=public'
npx vitest run
```
- **Phase 1–3 Baseline:** 15 test files, 143 tests passing
- **Phase 4 Accounting & Financial Engine (`server/tests/phase4-accounting.integration.test.ts`):** 1 test file, 9 integration tests passing against real PostgreSQL (`innowit_one_test`)
- **Aggregate:** 16 test files, 152 tests passing

## Mandatory Scenarios (§18) — Verified Coverage

All scenarios below are executed against `innowit_one_test` in `server/tests/phase4-accounting.integration.test.ts`:

| Gate | Scenario | Status |
|------|----------|--------|
| **F4.1** | Lazy fiscal year & 12-period creation, `OPEN -> CLOSED -> REOPEN` (with reason & audit), closed-period posting rejected (`409`) | PASS |
| **F4.2** | Unbalanced, single-line, dual-sided, summary, inactive, control, and cross-tenant lines rejected; balanced post idempotent (`sourceKey`); posted edit blocked (`409`); exact reversal once; balance cache zero drift | PASS |
| **F4.3** | Sales invoice post creates balanced GL journal + eTIMS `PENDING` queue (never `ACCEPTED`); partial payment allocation; over-allocation rejected; credit note posting | PASS |
| **F4.4** | Supplier bill draft -> post (input VAT), duplicate supplier invoice blocked, supplier payment post/allocate/reverse (with GL reversal) | PASS |
| **F4.5** | Kenyan VAT catalogue seed, tax code creation with optional GL accounts, effective-date boundary resolution | PASS |
| **F4.6** | FX rate capture, inverted conversion, `fx-revaluation` using tenant functional currency | PASS |
| **F4.7** | Bank account GL `ASSET` validation, CSV statement import & duplicate `fileHash` block, reconciliation segregation of duties (`preparer !== finalizer`), M-Pesa callback idempotency & `resultCode === '0'` confirmation rule (`1032` not confirmed) | PASS |
| **F4.8** | Trial Balance (`debit === credit`, `balanced: true`), Balance Sheet (`balanced: true`, `difference === '0.00'`), P&L, Cash Flow, VAT summary (output vs input), Budget creation & self-approval block, Org B tenant isolation | PASS |

## Test DB Safety
- `vitest.config.ts`: `setupFiles: ['server/tests/db-singleton.ts']`
- `db-singleton.ts` cleans Phase 1–4 test data in FK order before re-seeding
- **Never** runs against `innowit_one` (dev DB)

## Migration Integrity
- 11 migrations in `prisma/migrations` (8 prior + 3 Phase-4 additive migrations)
- `prisma migrate status` on `innowit_one_test`: 11 migrations, database schema is up to date
