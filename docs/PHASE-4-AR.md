# Phase 4 — AR Subledger (F4.3)

**Location:** `server/services/accounting/arService.ts`
**Exports:** `postSalesInvoice`, `postCustomerPayment`, `allocateCustomerPayment`, `postCreditNote`

## Invoice Posting
```
DR AR control (total)
CR Revenue (net, per line)
CR VAT output (per rule's GL account)
```
- Idempotent via `sourceKey=sales-invoice:{invoiceId}`
- Resolves revenue account from `OrganizationAccountingProfile.defaultRevenueAccountId`
- Tax rules resolved by effective date and classification; snapshot into `TaxTransaction` and `taxSnapshotJson`
- Invoice status transitions: `VALIDATED` → `POSTED` → `PAID` / `PARTIALLY_PAID` based on `paidAmount`
- eTIMS queue is enqueued separately; **POSTED ≠ eTIMS ACCEPTED**

## Customer Receipt (Payment)
```
DR Bank/Cash (amount)
CR AR control (amount)
```
- Created as DRAFT; posted explicitly via `POST /api/payments/:id/post`
- Unapplied cash allowed (`unappliedAmount` on `CustomerPayment`)
- `PaymentAllocation` provides many-to-many payment ↔ invoice
- Over-allocation rejected at receipt level AND invoice level

## Realized FX on Allocation
When a foreign-currency invoice is settled by a different-currency receipt:
- AR relieved at **invoice rate**
- Cash arrives at **receipt rate**
- Difference booked to FX gain/loss accounts from profile

## Credit Note
```
DR Revenue (net)
DR VAT output (tax)
CR AR control (total)
```
- Created as DRAFT; posted explicitly
- Idempotent via `sourceKey=credit-note:{creditNoteId}`

## API Routes (rewritten)
- `POST /api/invoices/:id/post` → `postSalesInvoice`
- `POST /api/payments` (create draft) → `POST /api/payments/:id/post` → `postCustomerPayment`
- `POST /api/payments/:id/allocate` → `allocateCustomerPayment`
- `POST /api/credit-notes` (create draft) → `POST /api/credit-notes/:id/post` → `postCreditNote`

## Tenant Scoping
Every lookup validates `organizationId`; no cross-tenant access possible.