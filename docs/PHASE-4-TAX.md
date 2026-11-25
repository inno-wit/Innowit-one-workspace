# Phase 4 — Tax Engine (F4.5)

**Location:** `server/services/accounting/taxService.ts`
**Exports:** `resolveTaxCode`, `findTaxCode`, `taxAmountFor`, `ruleSnapshot`, `recordTaxTransaction`, `vatSummary`, `seedKenyanVatCodes`

## Design Principles
- **No hardcoded rates.** 16% VAT, 5% WHT, etc. are *data* in `TaxCode`, not literals in code.
- **Effective-dated.** A rate applies for `effectiveFrom ≤ date < effectiveTo`. A Finance Act change means a new row with a later `effectiveFrom`, not an update of the old row.
- **Legal traceability.** Every rule carries `legalRef` (e.g. "VAT Act 2013 s.5(1)").
- **Immutable snapshot.** `TaxTransaction.ruleSnapshotJson` captures the exact rule at posting time. A reversal in 2030 reproduces the 2026 calculation.
- **Per-line resolution.** Sales invoice lines, supplier bill lines, and journal lines each resolve their own rule by date and classification.

## Kenyan VAT Catalogue (seeded)
| Code | Kind | Rate | Legal Ref |
|------|------|------|-----------|
| KE-VAT-STD | VAT_STANDARD | 16% | VAT Act 2013 s.5(1) |
| KE-VAT-ZERO | VAT_ZERO | 0% | VAT Act 2013 s.7 (First Schedule) |
| KE-VAT-EXEMPT | VAT_EXEMPT | 0% | VAT Act 2013 s.8 (Second Schedule) |

These are inserted by `seedKenyanVatCodes` at first use; an organization supersedes them when the law changes.

## Withholding Tax
**NOT seeded.** WHT rates vary by payment type (management fees 5%, rent 10%, etc.) and residence. Finance must enter the current KRA schedule as effective-dated `TaxCode` rows with `kind=WHT_INCOME` or `WHT_VAT`. The engine applies them identically to VAT.

## VAT Position Report
`vatSummary(organizationId, from, to)` groups `TaxTransaction` by rule actually applied, producing:
- Output VAT (sales, standard/zero/reverse-charge)
- Input VAT (purchases, recoverable)
- Net payable = output − input

## API
- `GET/POST/PUT /api/accounting/tax-codes`
- `POST /api/accounting/tax-codes/seed-kenya`
- `GET /api/accounting/reports/vat-summary` (via `vatSummary`)