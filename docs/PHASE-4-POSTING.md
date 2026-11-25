# Phase 4 — Canonical GL Posting Engine (F4.1, F4.2)

**Location:** `server/services/accounting/journal.ts`
**Exports:** `postJournal`, `postJournalInTransaction`, `postDraftJournal`, `reverseJournal`, `reconcileAccountBalances`, `normaliseJournalLines`

## Invariants Enforced (Gate 4.2)
1. **At least two lines** — `JOURNAL_TOO_SHORT`
2. **Single-sided lines** — exactly one of debit/credit per line, positive amounts only (`NEGATIVE_AMOUNT`, `EMPTY_LINE`, `DEBIT_AND_CREDIT_ON_SAME_LINE`)
3. **Exact balance** — `sum(debit) === sum(credit)` at 2dp (`UNBALANCED_JOURNAL`, zero tolerance)
4. **Account validity** — organization-scoped, active, postable, non-control (unless `allowControlAccounts`) (`ACCOUNT_NOT_ACCESSIBLE`, `ACCOUNT_INACTIVE`, `ACCOUNT_NOT_POSTABLE`, `CONTROL_ACCOUNT_NOT_POSTABLE`)
5. **Period lock** — posting date resolves to an OPEN period; SOFT_CLOSED rejected unless `allowSoftClosedPeriod` (`PERIOD_CLOSED`, `PERIOD_SOFT_CLOSED`, `PERIOD_NOT_FOUND`)
6. **Idempotency** — `sourceKey` unique per organization; repeated post returns the original journal (`@@unique([organizationId, sourceKey])` + advisory lock)
7. **Atomicity** — header, lines, balance cache, audit, domain event in one transaction
8. **Immutability** — POSTED journals cannot be edited or deleted; correction by `reverseJournal` only
9. **Reversal** — creates exact mirror journal, marks original `isReversed=true`, `status=REVERSED`, carries lineage via `sourceKey=reversal:{originalId}`

## Money Safety
- All arithmetic via `server/services/accounting/money.ts` (`Prisma.Decimal` only)
- `MONEY_SCALE = 2` (matches `Decimal(14,2)`); `RATE_SCALE = 8` (matches `Decimal(18,8)`)
- `strictPrecision` flag rejects >2dp input instead of rounding

## Multi-Currency
- Every line stores `currency`, `fxRate`, `baseDebit`, `baseCredit` (functional currency)
- `exchangeRate` on header; functional currency from `OrganizationAccountingProfile`

## Cost Centres / Dimensions
- Optional `costCentreId` (FK to `CostCentre`) and free-text `dimensionTag` per line

## API Surface
- `POST /api/journal` — create draft or post directly (`status: DRAFT | PENDING_APPROVAL | POSTED`)
- `PUT /api/journal/:id` — draft-only edit
- `POST /api/journal/:id/post` — move draft → ledger (re-validates period)
- `POST /api/journal/:id/reverse` — exact reversal with reason
- `GET /api/journal/balance-reconciliation` — drift report
- `POST /api/journal/balance-reconciliation/apply` — write corrections (SUPER_ADMIN / FINANCE_MANAGER)

## Audit & Events
- `AuditLog` entry on CREATE/POST/REVERSE with full payload
- `DomainEventLog` `journal.posted` / `journal.reversed` for downstream consumers