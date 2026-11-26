# Phase 4: Backlog & Scope Disposition

**Last Updated:** 2026-11-26  
**Scope:** Phase 4 Accounting & Financial Engine

---

## 1. Completed in Phase 4

- **Database Schema & Migrations:** 3 additive migrations (`20261125_phase4_accounting_engine`, `20261125_phase4_audit_scope`, `20261125_phase4_posting_mappings`), 11 total migrations applied cleanly to `innowit_one_test`.
- **General Ledger & Money Engine:** `money.ts` (Decimal-only), `journal.ts` (8 invariants, `$executeRaw` advisory lock, idempotent `sourceKey`, immutable posted entries, offsetting reversals).
- **Accounts Receivable & Payable:** `arService.ts`, `apService.ts`, `invoices.ts`, `payments.ts`, `creditNotes.ts`, `supplierBills.ts`, `supplierPayments.ts`.
- **Tax, FX, Fiscal Periods, Banking, M-Pesa, Budgets, Reports:** `taxService.ts`, `fxService.ts`, `periods.ts`, `bankService.ts`, `reportService.ts`, `accounting.ts`.
- **Frontend API Integration (F4.12):**
  - `apiClient.ts` Phase 4 methods.
  - `ChartOfAccountsApiView`, `JournalEntriesApiView`, `InvoicesApiView`, `SupplierBillsView`, `FiscalPeriodsView`, `TaxCodesView`, `FxRatesView`, `AccountingReportsView`.
  - `Sidebar.tsx` and `App.tsx` routing.
- **Desktop & Build Checks:** `npm run lint` (0 errors), `npm run build` (PASS), `cargo check -q` (PASS).

---

## 2. Deferred (Non-Blocking for Phase 4 Backend/Core UI)

| Item | Owner | Target Phase | Notes |
|---|---|---|---|
| Full Budgets CRUD & Variance UI (`BudgetsView.tsx`) | Frontend Team | Phase 5 | `/accounting/budgets` route wired with placeholder; `/api/accounting/budgets` backend & `apiClient` methods are complete and tested. |
| Dedicated Bank Reconciliation & M-Pesa UI Workspace | Frontend Team | Phase 5 | Backend services (`bankService.ts`), API routes, and `apiClient` methods are complete and tested; dedicated UI tab deferred. |
| Fix 20 pre-existing Phase 1-3 TypeScript errors in `npm run server:build` (`salesOrders.ts`, `salesReps.ts`, `tasks.ts`, `warehouses.ts`, `StorageProvider.ts`, `importWizard.ts`) | Backend Team | Pre-Release Hardening | Phase 4 files compile cleanly with `moduleResolution: bundler`; legacy errors are pre-existing Phase 1-3 issues outside Phase 4 scope. |
| Fix 2 intermittent/pre-existing failures in `server/tests/sales-reps.integration.test.ts` | CRM/Phase 3 Owner | Phase 3 Maintenance | Reproduced in isolation; unrelated to Phase 4 accounting changes. |

---

## 3. Externally Blocked (Credentials / Third-Party)

- **Live Safaricom Daraja M-Pesa STK Push:** Blocked pending production/sandbox Daraja consumer key, secret, passkey, and shortcode configuration. Callback contract and idempotency are verified via deterministic fixtures.
- **Live KRA eTIMS OSCU/VSCU Production Transmission:** Scoped to Phase 6; Phase 4 queues invoices as `PENDING` without fabricating `ACCEPTED` state.

---

## 4. Out of Scope for Phase 4

- Phase 5 ERP Operations: Inventory valuation/costing (FIFO/weighted average), three-way match (`PO -> GRN -> SupplierBill`), HR & Payroll GL integration, Fixed Assets depreciation runs.
- Phase 6: Production KRA eTIMS transmission, multi-entity consolidation.
