# Phase 4: Kenyan Tax & Payment Regulatory Research Register

**Retrieval Date:** 2026-11-26  
**Jurisdiction:** Republic of Kenya  
**Primary Regulators:** Kenya Revenue Authority (KRA), Central Bank of Kenya (CBK), Safaricom Daraja API  
**Disclaimer:** This register documents statutory rates and rules implemented in the software based on official KRA publications retrieved on the date above. It does not constitute formal legal or tax advice, and any edge-case interpretation (such as mixed-supply input VAT apportionment or sector-specific exemptions) requires review by a licensed Kenyan Certified Public Accountant (CPA-K) or tax practitioner.

---

## 1. Official Source Register

| # | Source Organization | Document / Topic | Official Domain / Reference | Retrieval Date | Effective Rule Implemented |
|---|---|---|---|---|---|
| 1 | Kenya Revenue Authority (KRA) | Value Added Tax (VAT) Act - Standard, Zero-Rated & Exempt Supplies | `kra.go.ke` (VAT Act Cap. 476, First & Second Schedules) | 2026-11-26 | Standard rate **16%**, Zero-rated **0%** (input VAT recoverable), Exempt (no VAT charged, input VAT non-recoverable). Registration threshold KES 5,000,000 annual turnover; monthly iTax filing by 20th of following month. |
| 2 | Kenya Revenue Authority (KRA) | Withholding VAT (WHVAT) Guidelines | `kra.go.ke` (VAT Act Section 25A) | 2026-11-26 | Appointed WHVAT agents withhold **2%** of taxable supply value on local taxable purchases (paying 14% VAT + 100% principal to supplier, remitting 2% to KRA via iTax). Does not apply to zero-rated, exempt, or non-VAT-registered suppliers. |
| 3 | Kenya Revenue Authority (KRA) | Withholding Income Tax (WHT) | `kra.go.ke` (Income Tax Act Cap. 470, Section 35) | 2026-11-26 | Income tax withheld on qualifying services (e.g., management/professional fees, contractual fees). Tracked separately from VAT; excluded from Output/Input VAT summary buckets. |
| 4 | Kenya Revenue Authority (KRA) | eTIMS (Electronic Tax Invoice Management System) | `kra.go.ke` (Tax Procedures Act) | 2026-11-26 | All VAT-registered taxpayers must issue eTIMS-compliant electronic tax invoices. In Phase 4, invoices queue as `PENDING` (real production transmission is scoped to Phase 6). |
| 5 | Safaricom / CBK | Daraja M-Pesa STK Push (Lipa na M-Pesa Online) Callback Contract | Safaricom Developer Portal (`developer.safaricom.co.ke`) | 2026-11-26 | `ResultCode === 0` indicates successful customer payment confirmation. `ResultCode === 1032` indicates user cancellation and must NEVER mark a payment as `CONFIRMED`. Duplicate `CheckoutRequestID` callbacks must be processed idempotently. |

---

## 2. Engine Implementation Rules

1. **Effective-Dated Tax Codes (`TaxCode` model):**
   - Each tax rule stores `effectiveFrom`, `effectiveTo` (nullable), `taxType` (`VAT`, `WHT`, `EXCISE`, `OTHER`), `rate` (`Decimal`), `glOutputAccountId`, and `glInputAccountId`.
   - Historical posted invoices and bills retain a snapshot of their tax rate and amount at transaction time so future statutory rate changes never mutate historical postings.
2. **VAT Summary Separation (`reportService.vatSummary`):**
   - **Output VAT:** Derived from posted customer sales invoices (`Invoice`) and reduced by posted credit notes (`CreditNote`).
   - **Input VAT:** Derived from posted supplier bills (`SupplierBill`).
   - **WHT Exclusion:** Withholding Tax (`taxType = WHT`) is strictly excluded from Output/Input VAT buckets and routed to `whtPayableAccountId`.
3. **Professional Review Items:**
   - Partial exemption / pro-rata input VAT apportionment for businesses making both taxable and exempt supplies.
   - Specific petroleum reduced-rate (8% / 16% statutory transitions under Finance Acts) and digital services VAT rules.
   - eTIMS OSCU/VSCU live signing and KRA production certificate onboarding (deferred to Phase 6).
