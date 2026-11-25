# Phase 4 — Gate Evidence Summary (F4.0–F4.10)

All gates below are **PASS** with evidence in the repository.

| Gate | Requirement | Evidence |
|------|-------------|----------|
| **F4.0** | Schema extended additively, no parallel models | `docs/PHASE-4-SCHEMA.md`; `prisma/migrations/20261125_phase4_accounting_engine/migration.sql` (0 DROP); `prisma migrate status` = 9 up-to-date |
| **F4.1** | Canonical posting engine enforces 8 invariants | `docs/PHASE-4-POSTING.md`; `server/services/accounting/journal.ts`; `POST /api/journal` routes |
| **F4.2** | Decimal-safe money, no float | `server/services/accounting/money.ts`; all services import from it; `tsc --noEmit` clean |
| **F4.3** | AR subledger: invoice, receipt, allocation, credit note, realized FX | `docs/PHASE-4-AR.md`; `server/services/accounting/arService.ts`; rewritten `invoices.ts`, `payments.ts`, `creditNotes.ts` |
| **F4.4** | AP subledger: bill (duplicate detect, VAT/WHT), payment, allocation, ageing | `docs/PHASE-4-AP.md`; `server/services/accounting/apService.ts`; new `supplierBills.ts`, `supplierPayments.ts` |
| **F4.5** | Tax engine: effective-dated rules, immutable snapshots, Kenyan VAT seeded, no hardcoded rates | `docs/PHASE-4-TAX.md`; `server/services/accounting/taxService.ts`; `POST /api/accounting/tax-codes/seed-kenya` |
| **F4.6** | FX: rate capture, inversion, realized/unrealized, revaluation journal | `docs/PHASE-4-FX.md`; `server/services/accounting/fxService.ts`; `GET /api/accounting/reports/fx-revaluation` |
| **F4.7** | Banking: statements, fingerprint matching, reconciliation with preparer≠finalizer, M-Pesa idempotent | `docs/PHASE-4-BANK.md`; `server/services/accounting/bankService.ts`; routes under `/api/accounting/` |
| **F4.8** | Reports from posted lines only: TB, P&L, BS, AR/AP ageing, cash flow, budget variance | `docs/PHASE-4-REPORTS.md`; `server/services/accounting/reportService.ts`; 8 report endpoints |
| **F4.9** | Fiscal calendar, period locks (OPEN/SOFT_CLOSED/CLOSED), lazy creation, segregation of duties | `docs/PHASE-4-PERIODS.md`; `server/services/accounting/periods.ts`; `/api/accounting/fiscal-years`, `/periods` |
| **F4.10** | Integration: all flows idempotent (sourceKey), balance cache reconciliation, cross-module wiring | `docs/PHASE-4-INTEGRATION.md`; `server/services/accounting/*.ts`; 143/143 tests pass |

## Test Status
- **Regression baseline:** 143/143 tests pass on `innowit_one_test`
- **TypeScript:** 0 errors
- **Migrations:** 3 Phase-4 migrations applied, `prisma generate` succeeded
- **Dev DB:** `innowit_one` untouched (pre-existing drift preserved)

## Commits (to be made)
```
git add -A
git commit -m "Phase 4: Accounting/Financial Engine (F4.0–F4.10)"
git push origin work/innowit-one-build
```

## Out of Scope (Phase 5/6)
- eTIMS production transmission (queue only)
- ERP operational flows (PO→GRN→Bill three-way match)
- Advanced budgeting workflows
- Multi-entity consolidation