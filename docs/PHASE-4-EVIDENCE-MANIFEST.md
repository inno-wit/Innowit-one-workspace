# Phase 4: Evidence Manifest

**Audit Date:** 2026-11-26 (EAT, UTC+03:00)  
**Repository:** `C:\Users\thee-keem\Projects\Innowit-one-workspace`  
**Branch:** `work/innowit-one-build`  
**Base Commit:** `e6f21be`  
**Prior Fix Commit:** `6e4c762`  
**Audit Remediation Commit:** Recorded in Git log immediately following this manifest

---

## 1. Database & Migration Artifacts

- `prisma/schema.prisma`
- `prisma/migrations/20261125_phase4_accounting_engine/migration.sql`
- `prisma/migrations/20261125_phase4_audit_scope/migration.sql`
- `prisma/migrations/20261125_phase4_posting_mappings/migration.sql`

## 2. Backend Services, Routes & Build Config

- `tsconfig.server.json`
- `server/utils/auth.ts`
- `server/utils/importWizard.ts`
- `server/workers/etimsWorker.ts`
- `server/services/accounting/*.ts` (`money.ts`, `sequences.ts`, `audit.ts`, `periods.ts`, `context.ts`, `taxService.ts`, `fxService.ts`, `journal.ts`, `arService.ts`, `apService.ts`, `bankService.ts`, `reportService.ts`)
- `server/routes/accounts.ts`, `journal.ts`, `invoices.ts`, `payments.ts`, `creditNotes.ts`, `accounting.ts`, `supplierBills.ts`, `supplierPayments.ts`

## 3. Frontend Integration Artifacts (F4.12)

- `src/services/api/apiClient.ts`
- `src/components/shell/Sidebar.tsx`
- `src/App.tsx`
- `src/components/accounting/ChartOfAccountsApiView.tsx`
- `src/components/accounting/JournalEntriesApiView.tsx`
- `src/components/accounting/InvoicesApiView.tsx`
- `src/components/accounting/SupplierBillsView.tsx`
- `src/components/accounting/FiscalPeriodsView.tsx`
- `src/components/accounting/TaxCodesView.tsx`
- `src/components/accounting/FxRatesView.tsx`
- `src/components/accounting/AccountingReportsView.tsx`

## 4. Automated Test Suites

- `server/tests/phase4-accounting.integration.test.ts` (9/9 PASS on `innowit_one_test`)
- `server/tests/phase4-extended-scenarios.integration.test.ts` (6/6 PASS on `innowit_one_test`)

## 5. Audit & Governance Documentation

- `docs/PHASE-4-BASELINE-AUDIT.md`
- `docs/PHASE-4-VERIFICATION-REMEDIATION-REPORT.md`
- `docs/PHASE-4-TEST-REPORT.md`
- `docs/PHASE-4-UI-BACKEND-MATRIX.md`
- `docs/PHASE-4-TAX-RESEARCH.md`
- `docs/PHASE-4-GATES.md`
- `docs/PHASE-4-BACKLOG.md`
- `docs/PHASE-4-EVIDENCE-MANIFEST.md`
