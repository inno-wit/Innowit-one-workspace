# Phase 4 — Reports (F4.8)

**Location:** `server/services/accounting/reportService.ts`
**Exports:** `trialBalance`, `profitAndLoss`, `balanceSheet`, `arAgeing`, `cashFlow`, `budgetVariance`

## Data Source
All reports derive from **posted journal lines only** (`JournalLine.baseDebit` / `baseCredit` joined to `JournalEntry` where `status IN ('POSTED', 'REVERSED')`). `Account.currentBalance` is a cache and is **never** used — it can drift and is reconciled separately.

## Trial Balance
- Opening balance = cumulative posted lines before `from`
- Period movement = lines within `from..to`
- Closing = opening + signed movement (respects `normalBalance`)
- Balanced check: `sum(debit) === sum(credit)` in period

## Profit & Loss
- Revenue = sum of `credit − debit` on `type=REVENUE` accounts
- Expense = sum of `debit − credit` on `type=EXPENSE` accounts
- Net profit = revenue − expense

## Balance Sheet
- Assets / Liabilities / Equity from cumulative lines to `asOf`
- Current earnings = YTD revenue − YTD expense (derived, not stored)
- Check: Assets = Liabilities + Equity + Current Earnings

## AR Ageing
Open invoices (posted, not cancelled/paid) aged against `dueDate`:
- Current, 1-30, 31-60, 61-90, 90+
- Totals per bucket and grand total

## AP Ageing
Open supplier bills (posted, not cancelled/paid) aged against `dueDate` — same buckets.

## Cash Flow
Movement through bank/cash GL accounts (`type=ASSET`, linked to `BankAccount`):
- Opening balance per account
- Inflows (debits), outflows (credits) in period
- Closing = opening + inflows − outflows

## Budget Variance
Budget lines (`BudgetLine.accountId`, `periodNumber`) vs actual posted lines in the fiscal year:
- Variance = actual − budget
- Utilisation % = actual / budget × 100

## API
All under `GET /api/accounting/reports/`:
- `trial-balance?from&to&includeZero`
- `profit-and-loss?from&to`
- `balance-sheet?asOf`
- `ar-ageing?asOf`
- `ap-ageing?asOf`
- `cash-flow?from&to`
- `budget-variance/:budgetId`
- `fx-revaluation?asOf`