# Phase 4 — Integration & Idempotency (F4.10)

## Idempotency Keys
Every posting flow uses a `sourceKey` unique per organization:
- Sales invoice: `sales-invoice:{invoiceId}`
- Customer payment: `customer-payment:{paymentId}`
- Credit note: `credit-note:{creditNoteId}`
- Supplier bill: `supplier-bill:{billId}`
- Supplier payment: `supplier-payment:{paymentId}`
- Manual journal: caller-supplied or `manual:{uuid}`
- Reversal: `reversal:{originalJournalId}`

Enforced by:
- `@@unique([organizationId, sourceKey])` on `JournalEntry`
- Advisory lock `pg_advisory_xact_lock(hashtext(organizationId:sourceModule:sourceKey))` inside the transaction

**Result:** duplicate API calls return the original journal (`created: false`, `idempotentReplay: true`).

## Cross-Module Posting Flows
| Flow | Service | Journal SourceModule | Balance Cache | Audit | Domain Event |
|------|---------|---------------------|---------------|-------|--------------|
| Sales invoice | `arService.postSalesInvoice` | `SALES_INVOICE` | ✅ | ✅ | `invoice.posted` |
| Customer payment | `arService.postCustomerPayment` | `CUSTOMER_PAYMENT` | ✅ | ✅ | `payment.posted` |
| Payment allocation | `arService.allocateCustomerPayment` | `FX_REALIZED` (if FX) | ✅ | ✅ | `payment.allocated` |
| Credit note | `arService.postCreditNote` | `CREDIT_NOTE` | ✅ | ✅ | `credit-note.posted` |
| Supplier bill | `apService.postSupplierBill` | `SUPPLIER_BILL` | ✅ | ✅ | `supplier-bill.posted` |
| Supplier payment | `apService.postSupplierPayment` | `SUPPLIER_PAYMENT` | ✅ | ✅ | `supplier-payment.posted` |
| Supplier allocation | `apService.allocateSupplierPayment` | — | ✅ | ✅ | `supplier-payment.allocated` |
| Bank reconciliation | `bankService.finalizeReconciliation` | — | — | ✅ | `bank-reconciliation.finalized` |
| M-Pesa callback | `bankService.recordMpesaCallback` | — | — | — | — |

## Balance Cache Reconciliation
`reconcileAccountBalances(organizationId, { apply: true })`:
- Reads all posted journal lines, computes derived balance per account using `normalBalance`
- Compares to `Account.currentBalance`
- Reports drift; optionally writes corrections with `AuditLog` entry

## Test Coverage (Mandatory Scenarios §18)
1. **COA/Periods:** hierarchy, postable/control enforcement, period lock transitions
2. **GL Posting:** balanced/unbalanced, draft→post, reversal lineage, idempotency, multi-currency
3. **AR:** invoice post, receipt post, allocation (exact/partial/over), credit note, realized FX
4. **AP:** bill post (duplicate detect, VAT/WHT), payment post, allocation, ageing
5. **Bank/M-Pesa:** statement import, auto-match, reconciliation finalize (difference ≠ 0 blocked), M-Pesa callback + link
6. **FX/Tax:** rate capture, revaluation, VAT summary, WHT liability
7. **Reports tie-out:** TB balanced, P&L = revenue−expense, BS assets=liabilities+equity, AR/AP ageing sums = control account balances

All 143 existing tests pass; new integration tests to be added in next session.