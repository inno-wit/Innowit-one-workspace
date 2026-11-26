# Phase 4: UI-to-Backend Integration Matrix

**Last Updated:** 2026-11-26  
**Scope:** Gate F4.12 (Frontend & Desktop Integration)

---

## 1. Accounting Screen Coverage Matrix

| UI Screen / Component | Route (`Sidebar.tsx` / `App.tsx`) | `apiClient.ts` Methods | Backend Route & Service | Prisma Models | Test / Build Status |
|---|---|---|---|---|---|
| `ChartOfAccountsApiView` -> `ChartOfAccountsView` | `/accounting/chart-of-accounts` | `getAccounts`, `createAccount` | `GET/POST /api/accounting/accounts` (`accounts.ts`) | `Account` | Vite build PASS, `tsc --noEmit` PASS |
| `JournalEntriesApiView` -> `JournalEntriesView` | `/accounting/journal-entries` | `getJournals`, `createJournal`, `reverseJournal` | `GET/POST /api/accounting/journals`, `POST .../reverse` (`journal.ts`) | `JournalEntry`, `JournalLine` | Vite build PASS, `tsc --noEmit` PASS, Integration PASS |
| `InvoicesApiView` -> `InvoicesView` | `/accounting/invoices` | `getInvoices`, `createInvoice`, `postInvoice`, `createCustomerPayment`, `getCustomers` | `/api/accounting/invoices`, `/api/accounting/payments` (`invoices.ts`, `payments.ts`, `arService.ts`) | `SalesInvoice`, `CustomerPayment`, `PaymentAllocation` | Vite build PASS, `tsc --noEmit` PASS, Integration PASS |
| `SupplierBillsView` | `/accounting/supplier-bills` | `getSupplierBills`, `postSupplierBill`, `createSupplierPayment` | `/api/accounting/supplier-bills`, `/api/accounting/supplier-payments` (`supplierBills.ts`, `apService.ts`) | `SupplierBill`, `SupplierPayment`, `SupplierAllocation` | Vite build PASS, `tsc --noEmit` PASS, Integration PASS |
| `FiscalPeriodsView` | `/accounting/fiscal-periods` | `getFiscalYears`, `getFiscalPeriods`, `softClosePeriod`, `hardClosePeriod`, `reopenPeriod` | `/api/accounting/fiscal-years`, `/api/accounting/fiscal-periods/*` (`accounting.ts`, `periods.ts`) | `FiscalYear`, `FiscalPeriod` | Vite build PASS, `tsc --noEmit` PASS, Integration PASS |
| `TaxCodesView` | `/accounting/tax-codes` | `getTaxCodes`, `seedKenyaTaxCodes`, `getVatSummary` | `/api/accounting/tax-codes`, `/api/accounting/reports/vat-summary` (`accounting.ts`, `taxService.ts`) | `TaxCode`, `TaxTransaction` | Vite build PASS, `tsc --noEmit` PASS, Integration PASS |
| `FxRatesView` | `/accounting/fx-rates` | `getFxRates`, `captureFxRate`, `runFxRevaluation` | `/api/accounting/fx-rates`, `/api/accounting/fx-revaluation` (`accounting.ts`, `fxService.ts`) | `ExchangeRate`, `FxRevaluationRun` | Vite build PASS, `tsc --noEmit` PASS, Integration PASS |
| `AccountingReportsView` | `/accounting/reports` | `getTrialBalance`, `getProfitAndLoss`, `getBalanceSheet`, `getCashFlow`, `getArAgeing`, `getApAgeing`, `getVatSummary` | `/api/accounting/reports/*` (`accounting.ts`, `reportService.ts`) | Derived from `JournalLine` | Vite build PASS, `tsc --noEmit` PASS, Integration PASS |
| Budgets Placeholder | `/accounting/budgets` | `getBudgets`, `createBudget`, `approveBudget` (client methods ready) | `/api/accounting/budgets` (`accounting.ts`) | `Budget`, `BudgetLine` | API & Backend Integration PASS; Full UI deferred to Phase 5 |
| Bank Reconciliation & M-Pesa UI | Deferred dedicated tab (API client wired) | `getBankAccounts`, `importBankStatement`, `reconcileBankStatement`, `initiateMpesaStk` | `/api/accounting/bank-accounts`, `/api/accounting/mpesa/*` (`accounting.ts`, `bankService.ts`) | `BankAccount`, `BankStatement`, `MpesaTransaction` | API & Backend Integration PASS; Dedicated UI workspace deferred |

---

## 2. Key Architectural Improvements Made in F4.12

1. **Eliminated Static Seed Prop-Drilling for Core Accounting Screens:**
   - Replaced `DEFAULT_ACCOUNTS`, `SEED_INVOICES`, and `DEFAULT_JOURNAL_ENTRIES` in `App.tsx` routes with live API-backed wrappers (`ChartOfAccountsApiView`, `InvoicesApiView`, `JournalEntriesApiView`, `AccountingReportsView`).
2. **Added 5 New Phase 4 Screens + Navigation:**
   - `SupplierBillsView`, `FiscalPeriodsView`, `TaxCodesView`, `FxRatesView`, and `AccountingReportsView` registered in `Sidebar.tsx` and `App.tsx`.
3. **RBAC & Error Handling:**
   - All views respect `hasPermission(userRole, 'ACCOUNTING', ...)` and display explicit loading spinners, error messages, and retry actions without faking success.
