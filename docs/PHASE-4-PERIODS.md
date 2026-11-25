# Phase 4 — Period Locks & Fiscal Calendar (F4.9)

**Location:** `server/services/accounting/periods.ts`
**Exports:** `resolvePostingPeriod`, `currentPeriod`

## Calendar Model
- `FiscalYear`: named, dated, status lifecycle (`OPEN` / `CLOSED`)
- `AccountingPeriod`: 12 per year, monthly, `status ∈ {OPEN, SOFT_CLOSED, CLOSED}`

## Locking Rules
- `OPEN` — normal posting allowed
- `SOFT_CLOSED` — posting rejected unless `allowSoftClosedPeriod=true` (privileged adjustment)
- `CLOSED` — posting rejected; only `SUPER_ADMIN` can reopen with a reason and segregation of duties (closer ≠ reopener)

## Lazy Creation
- Calendar generated on first post for a date
- Adjacent years generated lazily for back-dated adjustments
- No admin step required after migration; existing organizations keep working

## Period Resolution
`resolvePostingPeriod(tx, organizationId, postingDate)`:
1. Ensures calendar exists for the fiscal year containing the date
2. Finds the period where `startDate ≤ postingDate ≤ endDate`
3. Validates status; throws `PERIOD_CLOSED` / `PERIOD_SOFT_CLOSED` / `PERIOD_NOT_FOUND`

## API (in `/api/accounting/`)
- `GET /fiscal-years` — list with period counts
- `POST /fiscal-years` — create year + 12 periods
- `GET /periods` — filter by status / fiscal year
- `POST /periods/:id/close` — close (ADMIN/FINANCE_MANAGER)
- `POST /periods/:id/reopen` — reopen (SUPER_ADMIN only, reason required, closer ≠ reopener)

## Integration
Every `postJournal` / `postSalesInvoice` / `postSupplierBill` / `postCustomerPayment` / `postSupplierPayment` calls `resolvePostingPeriod` before writing.