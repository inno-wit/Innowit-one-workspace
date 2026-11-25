# Phase 4 — Banking & Reconciliation (F4.7)

**Location:** `server/services/accounting/bankService.ts`
**Exports:** `createBankAccount`, `importStatement`, `parseStatementCsv`, `autoMatch`, `startReconciliation`, `finalizeReconciliation`, `recordMpesaCallback`, `linkMpesaToPayment`, `mpesaIdempotencyKey`

## Bank Accounts
- Linked to GL asset account (`glAccountId`); must be `type=ASSET`
- Types: `BANK`, `CASH`, `MPESA`
- Opening balance/date for first reconciliation

## Statement Import
- CSV parser: `date,description,reference,debit,credit`
- SHA-256 of file content (`fileHash`) blocks duplicate imports
- Per-line fingerprint (date, amount, reference, description, line number) enables matching
- Lines start as `UNMATCHED`

## Auto-Matching
Exact, deterministic rules:
- Same amount (±0)
- Same bank account
- Within 5 days of value date
- **Exactly one** candidate payment/receipt → `AUTO_EXACT`
- Zero or multiple candidates → stays `UNMATCHED` for human review

## Reconciliation Workflow
1. `POST /api/accounting/bank-reconciliation` — create draft with period and statement closing balance
2. `POST /api/accounting/bank-reconciliation/:id/auto-match` — run rules
3. Manual matches via UI (create `BankMatch` rows)
4. `POST /api/accounting/bank-reconciliation/:id/finalize` — **preparer ≠ finalizer** (segregation of duties)
   - Recomputes GL balance at finalization time
   - Rejects if difference ≠ 0
   - Sets `status=FINALIZED`, `finalizedBy`, `finalizedAt`

## M-Pesa (Safaricom Daraja)
- `recordMpesaCallback` stores provider payload with `idempotencyKey` (TransID / CheckoutRequestID / MerchantRequestID)
- `CONFIRMED` only when provider `resultCode` is `0` or `1032`
- `linkMpesaToPayment` enforces exact amount match between M-Pesa transaction and customer receipt

## API
- `GET/POST /api/accounting/bank-accounts`
- `POST /api/accounting/bank-statements/import`
- `GET /api/accounting/bank-statements`
- `POST/GET /api/accounting/bank-reconciliation`
- `POST /api/accounting/bank-reconciliation/:id/auto-match`
- `POST /api/accounting/bank-reconciliation/:id/finalize`
- `POST /api/accounting/mpesa/callback`
- `POST /api/accounting/mpesa/:id/link-payment`