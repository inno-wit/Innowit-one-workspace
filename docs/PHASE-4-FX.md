# Phase 4 — Foreign Exchange (F4.6)

**Location:** `server/services/accounting/fxService.ts`
**Exports:** `captureRate`, `resolveRate`, `toFunctional`, `realizedDifference`, `computeRevaluation`, `postRevaluationJournal` (via journal service)

## Rules
- **No silent 1.0.** Missing rate throws `FX_RATE_NOT_FOUND` before posting.
- **Effective-dated.** `ExchangeRate` rows scoped to organization, `fromCurrency` → `toCurrency`, `rateDate`, `source` (CBK, MANUAL, CONTRACTUAL, PROVIDER).
- **Inversion fallback.** If KES/USD is captured but USD/KES is needed, the engine inverts automatically.
- **Override flag.** `isOverride=true` with `overrideReason` for contractual rates differing from market.
- **Snapshot on document.** Every foreign-currency invoice, bill, payment captures its `exchangeRate` at posting.

## Realized FX
On settlement of a foreign-currency AR/AP item:
```
Difference = (amount × settlementRate) − (amount × bookedRate)
Positive = gain → DR AR/CR FX Gain
Negative = loss → DR FX Loss/CR AR
```

## Unrealized FX (Period-End Revaluation)
`computeRevaluation` scans all open foreign-currency AR and AP, revalues at the closing rate, and returns per-currency buckets:
- Receivable difference (by invoice)
- Payable difference (by bill)
- Group totals for journal posting

The revaluation journal is posted separately via the canonical engine so the calculation and the accounting entry are separately auditable.

## API
- `GET/POST /api/accounting/exchange-rates`
- `GET /api/accounting/exchange-rates/convert` — preview conversion
- `GET /api/accounting/reports/fx-revaluation` — read-only computation