# Phase 4 — Test Evidence (F4.0–F4.10)

## Baseline Regression
```
$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/innowit_one_test?schema=public'
npx vitest run
```
**Result:** 15 test files, 143 tests, all passing (59.04s)

## Mandatory Scenarios (§18) — Coverage

| Scenario | Test File(s) | Status |
|----------|--------------|--------|
| COA hierarchy: parent/child, postable enforcement, control account blocking | `accounts.test.ts`, `journal.test.ts` | Existing |
| Fiscal periods: OPEN/SOFT_CLOSED/CLOSED transitions, lazy year creation | `periods.test.ts` | Existing |
| GL balanced posting: two-line minimum, single-sided, exact balance | `journal.test.ts` | Existing |
| Draft → post workflow, period re-validation | `journal.test.ts` | Existing |
| Exact reversal with lineage, double-reversal blocked | `journal.test.ts` | Existing |
| Idempotent post (same sourceKey returns original) | `journal.test.ts` | Existing |
| Multi-currency: FX rate capture, baseDebit/baseCredit, conversion | `fx.test.ts` | Existing |
| Sales invoice post: AR/Revenue/VAT, tax snapshot, status transitions | `invoices.test.ts` | Existing |
| Customer receipt: draft→post, unapplied cash, bank vs cash source | `payments.test.ts` | Existing |
| Payment allocation: exact, partial, over-allocation rejection (both levels) | `payments.test.ts` | Existing |
| Credit note: draft→post, revenue/VAT reversal, AR credit | `creditNotes.test.ts` | Existing |
| Realized FX on foreign-currency invoice settlement | `ar.test.ts` | Existing |
| Supplier bill: duplicate fingerprint, VAT recoverable, WHT liability | `supplierBills.test.ts` | **New** |
| Supplier payment: draft→post, unapplied cash | `supplierPayments.test.ts` | **New** |
| Supplier allocation: exact, partial, over-allocation rejection | `supplierPayments.test.ts` | **New** |
| AP ageing buckets match control account | `ap.test.ts` | **New** |
| Bank statement import: CSV parse, fileHash duplicate block | `bank.test.ts` | **New** |
| Auto-match: exact rules, ambiguity handling | `bank.test.ts` | **New** |
| Reconciliation finalize: difference ≠ 0 blocked, preparer ≠ finalizer | `bank.test.ts` | **New** |
| M-Pesa callback: idempotency key, CONFIRMED only on resultCode 0/1032 | `mpesa.test.ts` | **New** |
| M-Pesa link: exact amount enforcement | `mpesa.test.ts` | **New** |
| Tax resolution: effective-dated, code vs id, VAT catalogue seed | `tax.test.ts` | **New** |
| VAT summary: output/input/net by rule applied | `tax.test.ts` | **New** |
| Unrealized FX revaluation: AR/AP open items, per-currency buckets | `fx.test.ts` | **New** |
| Reports: TB balanced, P&L=rev-exp, BS assets=liab+equity, AR/AP tie to control | `reports.test.ts` | **New** |
| Budget variance: budget lines vs actual posted, utilisation % | `budgets.test.ts` | **New** |
| Balance cache reconciliation: drift report, apply corrections | `journal.test.ts` | Existing |

## Test DB Safety
- `vitest.config.ts`: `setupFiles: ['server/tests/db-singleton.ts']`
- `global-setup.ts` guards: aborts if `current_database() !== 'innowit_one_test'`
- **Never** runs against `innowit_one` (dev DB with pre-existing drift)

## TypeScript
`npx tsc --noEmit` — 0 errors

## Migration Integrity
- 3 Phase-4 migrations applied to `innowit_one_test`
- `prisma migrate status`: 9 migrations, up to date
- Zero destructive operations in any migration