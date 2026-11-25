# Phase 4 — AP Subledger (F4.4)

**Location:** `server/services/accounting/apService.ts`
**Exports:** `postSupplierBill`, `postSupplierPayment`, `allocateSupplierPayment`, `apAgeing`

## Supplier Bill Posting
```
DR Expense (net of recoverable VAT, per line expense account)
DR VAT input (if VAT-registered) — mapped from rule's GL input account
DR Non-recoverable VAT (if not VAT-registered) — into expense
CR AP control (total)
CR WHT payable (withholding tax withheld) — if bill carries WHT
```
- Duplicate detection: SHA-256 fingerprint over `(supplierId, billNumber, billDate, total)` blocks the same supplier invoice from posting twice
- Input VAT recoverable only for VAT-registered organizations (profile flag)
- WHT captured as a real liability to KRA, not a silent expense reduction
- `goodsReceiptRef` is only ever caller-supplied; never fabricated
- Idempotent via `sourceKey=supplier-bill:{billId}`

## Supplier Payment
```
DR AP control (amount)
CR Bank/Cash (amount)
```
- Created as DRAFT; posted explicitly
- Unapplied cash allowed; `SupplierPaymentAllocation` provides many-to-many payment ↔ bill
- Over-allocation rejected at payment level AND bill level

## AP Ageing
Computed from open `SupplierBill` balances against `dueDate`:
- Current, 1-30, 31-60, 61-90, 90+ days
- Only posted bills; cancelled/paid excluded

## API Routes (new)
- `GET/POST /api/suppliers/bills` (create draft) → `POST /api/suppliers/bills/:id/post`
- `GET/POST /api/suppliers/payments` (create draft) → `POST /api/suppliers/payments/:id/post`
- `POST /api/suppliers/payments/:id/allocate`
- `GET /api/accounting/reports/ap-ageing`

## Tenant Scoping
Every lookup validates `organizationId`; supplier ownership enforced.