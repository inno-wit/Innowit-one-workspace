# Phase 4 — Schema Changes (F4.0)

**Branch:** `work/innowit-one-build`
**Migration:** `prisma/migrations/20261125_phase4_accounting_engine/migration.sql`
**Follow-up:** `prisma/migrations/20261125_phase4_audit_scope/migration.sql`
**Posting mappings:** `prisma/migrations/20261125_phase4_posting_mappings/migration.sql`

## Models Added (20)
- `OrganizationAccountingProfile` — functional currency, fiscal calendar, GL account mappings, approval thresholds
- `FiscalYear` — named fiscal years with status lifecycle
- `AccountingPeriod` — monthly periods with OPEN / SOFT_CLOSED / CLOSED locking
- `CostCentre` — hierarchical cost centres with department link
- `ExchangeRate` — effective-dated, tenant-scoped FX rates with source audit
- `TaxCode` — effective-dated tax rules (VAT, WHT) with legal reference and GL mappings
- `TaxTransaction` — immutable snapshot of every tax calculation at posting time
- `PaymentAllocation` — many-to-many between `CustomerPayment` and `SalesInvoice`
- `SupplierBill` — AP invoice header with duplicate fingerprint, WHT, PO/GRN refs
- `SupplierBillLine` — AP line with tax code, WHT, expense account, cost centre
- `SupplierPayment` — AP payment with bank/cash source, WHT, unapplied cash
- `SupplierPaymentAllocation` — many-to-many payment ↔ bill
- `BankAccount` — bank/cash/MPESA accounts linked to GL asset accounts
- `BankStatement` — imported file with SHA-256 duplicate guard
- `BankStatementLine` — parsed line with fingerprint for matching
- `BankReconciliation` — period-end statement vs GL with preparer/finalizer segregation
- `BankMatch` — statement line ↔ GL/payment match with type and reason
- `MpesaTransaction` — Safaricom Daraja ledger with idempotency key and status lifecycle
- `Budget` — fiscal-year budget with version, status, cost-centre scope
- `BudgetLine` — account × period × cost-centre budget amount
- `DomainEventLog` — outbox for cross-module events (notifications, eTIMS queue, CRM)
- `DocumentSequence` — atomic gapless numbering per prefix/scope/year

## Extensions to Pre-Phase-4 Models
- `Organization` — `kraPin` unique, `accountingProfile` relation
- `Account` — hierarchy (`parentId`), `subtype`, `normalBalance`, `isPostable`, `isControl`, `controlType`, `isSystem`
- `JournalEntry` — `status` lifecycle, `periodId`, `branchId`, `currency`, `exchangeRate`, `sourceKey` idempotency, `postedAt`/`postedBy`, reversal linkage
- `JournalLine` — transaction currency, `fxRate`, `baseDebit`/`baseCredit`, `costCentreId`, `dimensionTag`
- `Branch` — `kraBranchCode`, accounting profile linkage
- `Supplier` — `kraPin`, default payment terms
- `SalesInvoice` — `currency`, `exchangeRate`, `postedJournalId`, `taxSnapshotJson`
- `CustomerPayment` — nullable `salesInvoiceId`, `unappliedAmount`, `status`, `postedJournalId`
- `CreditNote` — lifecycle status, `currency`, `exchangeRate`, `postedJournalId`, `subtotal`
- `AuditLog` — `organizationId`, `branchId`, `correlationId` for tenant-scoped queries

## Enums Added (17)
`JournalStatus`, `FiscalYearStatus`, `PeriodStatus`, `AccountNormalBalance`, `AccountControlType`, `TaxKind`, `TaxApplicability`, `PaymentStatus`, `CreditNoteStatus`, `SupplierBillStatus`, `BankAccountType`, `StatementLineStatus`, `ReconciliationStatus`, `ReconciliationMatchType`, `ExchangeRateSource`, `BudgetStatus`, `MpesaTransactionType`, `MpesaTransactionStatus`, `DomainEventStatus`

## Migration Properties
- **Additive only:** zero `DROP TABLE`, `DROP COLUMN`, `DROP TYPE`, `RENAME`
- **Backfills:** `Account.normalBalance` corrected for liability/equity/revenue; control-account intent for well-known numbers 1100/2100; profile mappings from seeded accounts
- **Applied to:** `innowit_one_test` (dev DB `innowit_one` left untouched with its pre-existing drift)
- **Prisma status:** 9 migrations, up to date
- **Prisma generate:** succeeded