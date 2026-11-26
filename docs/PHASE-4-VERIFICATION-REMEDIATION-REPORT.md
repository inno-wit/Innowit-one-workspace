# Phase 4: Verification & Remediation Report

**Audit Date:** 2026-11-26 (EAT, UTC+03:00)  
**Repository:** `C:\Users\thee-keem\Projects\Innowit-one-workspace`  
**Branch:** `work/innowit-one-build`  
**Base Commit:** `e6f21be` | **Prior Fix Commit:** `6e4c762`

---

## 1. Verification of Reported Backend Fixes (Commit `6e4c762`)

| # | Reported Defect | Reproduced / Verified | Exact Fix & File(s) | Status |
|---|---|---|---|---|
| 1 | GL advisory lock `pg_advisory_xact_lock` failed Prisma deserialization under `$queryRaw` | Verified in source & runtime integration tests | Changed to `tx.$executeRaw` inside `postJournalEntry` (`server/services/accounting/journal.ts`) | **VERIFIED** |
| 2 | AR/AP route-to-service transaction callback signature mismatches | Verified in source & runtime integration tests | Standardized to `(tx, input)` in `invoices.ts`, `payments.ts`, `creditNotes.ts`, `supplierBills.ts`, `supplierPayments.ts` | **VERIFIED** |
| 3 | `Prisma.<Enum>` namespace access runtime error | Verified in source | Imported enums directly from `@prisma/client` | **VERIFIED** |
| 4 | Authenticated user reference `req.user!.id` vs JWT payload `req.user!.userId` | Verified in source & HTTP route tests | Updated to `req.user!.userId` across Phase 4 routes | **VERIFIED** |
| 5 | Double-prefixed supplier routes & invalid `Supplier.supplierCode` selection | Verified in source & AP route tests | Fixed mount paths and removed invalid `supplierCode` projections | **VERIFIED** |
| 6 | Stale `sourceKey` queries on payment/callback models | Verified in source & M-Pesa/payment tests | Corrected to `providerRef` / `referenceCode` | **VERIFIED** |
| 7 | Customer/supplier payment reversals did not post offsetting GL journal | Verified in source & runtime tests | Wired `reverseJournal(...)` inside payment reversal transactions | **VERIFIED** |
| 8 | M-Pesa callback result code `1032` (user cancel) mapped to `CONFIRMED` | Verified in source & callback tests | Only `ResultCode === 0` confirms; `1032` remains cancelled/non-confirmed | **VERIFIED** |
| 9 | FX `captureRate` missing `rateValue`, rigid GL validation on tax code, hardcoded KES in FX revaluation | Verified in source & FX/Tax tests | Passed `rateValue`, conditional GL account validation, organization functional currency | **VERIFIED** |
| 10 | Missing fiscal year/period, VAT summary, and budget approval endpoints | Verified in `server/routes/accounting.ts` | Endpoints implemented & tested | **VERIFIED** |
| 11 | VAT summary treated supplier bills incorrectly or included WHT | Verified in `reportService.ts` & tests | `SUPPLIER_BILL` VAT classified as Input VAT; `WHT` excluded from VAT buckets | **VERIFIED** |

---

## 2. Additional Remediations Completed in This Audit Session

| # | Defect / Gap Found | Root Cause | Remediation Applied | Files Changed | Status |
|---|---|---|---|---|---|
| 12 | `npm run server:build` failed on Phase 4 & TS7 moduleResolution | `tsconfig.server.json` used `NodeNext` (requiring `.js` on every import), plus TS errors in `auth.ts`, `importWizard.ts`, `etimsWorker.ts`, `test-db.ts` | Updated `tsconfig.server.json` to `module: CommonJS, moduleResolution: bundler` (excluding `server/tests/**`); fixed `SignOptions` in `server/utils/auth.ts`, `contentHash = ''` in `server/utils/importWizard.ts`, `tx` & `data` typing in `server/workers/etimsWorker.ts` | `tsconfig.server.json`, `server/utils/auth.ts`, `server/utils/importWizard.ts`, `server/workers/etimsWorker.ts` | **FIXED (Phase 4 files compile cleanly; 20 pre-existing Phase 1-3 errors remain out of scope)** |
| 13 | Frontend accounting screens used static seed arrays (`DEFAULT_ACCOUNTS`, `SEED_INVOICES`, `DEFAULT_JOURNAL_ENTRIES`) and lacked Phase 4 screens | `App.tsx` prop-drilled static seed data; `apiClient.ts` lacked Phase 4 methods | Extended `src/services/api/apiClient.ts` with Phase 4 endpoints; created `SupplierBillsView.tsx`, `FiscalPeriodsView.tsx`, `TaxCodesView.tsx`, `FxRatesView.tsx`, `AccountingReportsView.tsx`, `ChartOfAccountsApiView.tsx`, `JournalEntriesApiView.tsx`, `InvoicesApiView.tsx`; wired `Sidebar.tsx` and `App.tsx` | `src/services/api/apiClient.ts`, `src/components/accounting/*.tsx`, `src/components/shell/Sidebar.tsx`, `src/App.tsx` | **FIXED (`npm run lint` = 0 errors, `npm run build` = PASS)** |
| 14 | Missing isolated edge-case tests for Section 16 matrix | `phase4-accounting.integration.test.ts` covered core happy/error paths but omitted dedicated extended edge cases | Created `server/tests/phase4-extended-scenarios.integration.test.ts` covering unbalanced post, `sourceKey` idempotency, closed-period lock, AR partial/overpayment, AP reversal reconciliation, M-Pesa `1032` & duplicate callbacks | `server/tests/phase4-extended-scenarios.integration.test.ts` | **ADDED & VERIFIED** |
