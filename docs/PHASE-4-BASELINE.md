# PHASE 4 — BASELINE AND FORENSIC AUDIT (Wave 4.0)

**Project:** Innowit One Workspace
**Audit date:** 2026-11-25
**Auditor:** OpenCode Principal Orchestrator
**Scope:** Repository, schema, accounting code paths, financial UI, test inventory — **read-only**, no business logic changed before this document was written.

---

## 1. Git baseline

| Item | Actual value | Expected | Match |
|---|---|---|---|
| Branch | `work/innowit-one-build` | `work/innowit-one-build` | YES |
| HEAD | `e319f29c92faacd33ead9cec735e5323134bd315` | `e319f29c92faacd33ead9cec735e5323134bd315` | YES |
| Working tree | clean (`git status --short` empty) | clean | YES |
| Remote | `origin → https://github.com/Thee-keem/Innowit-one-workspace.git` | — | — |

Last 5 commits:

```
e319f29 docs(phase3): record verified final commit SHA
2796ba3 fix(phase3): harden ImportJob multi-tenancy, add integration tests and final test report
b99bdfd fix(phase3): close CRM release verification gaps
16ae9c3 docs(phase3): record documentation commit SHA 3e55458
3e55458 docs(phase3): reconcile CRM release evidence and acceptance status
```

No untracked user files were present at audit start. The two anomalous directories
`C:\Users\thee-keem\Projects\Innovit-one-workspace` (2 entries: `server/`, `tmp_b87_schema.prisma`)
and `Innowit-one-workspace` (the real repo) are distinct paths on a case-sensitive
filesystem; the real repository is `Innowit-one-workspace` with git history. The stray
`Innovit-one-workspace/server` folder is **outside** the repository and untouched.

---

## 2. Database identity

| Item | Value |
|---|---|
| Development DB | `postgresql://postgres:***@localhost:5432/innowit_one` |
| Isolated test DB | `postgresql://postgres:***@localhost:5432/innowit_one_test` |
| Test DB migration state | **8/8 applied — "Database schema is up to date"** |
| Development DB migration state | **DRIFTED** (pre-existing, see §3) |

No destructive command was executed against `innowit_one` at any point in this audit.
`prisma migrate status` was the only statement run against it.

### 2.1 Pre-existing migration drift (development DB only)

`npx prisma migrate status` against `innowit_one` reports:

- Last common migration: `20261119_phase3_quotation_items`
- Not yet applied locally→DB: `20261124_add_import_job`
- Present in DB but not on disk: `20261118_dm_direct_key` (recorded twice in `_prisma_migrations`)

Interpretation: the development database received the direct-message migration under an
earlier folder name (`20261118_…`) before it was renamed to `20261119_dm_direct_key`, and
the ImportJob migration has not been applied there. **This is a pre-existing condition, not
introduced by Phase 4.** The isolated test database is consistent. Phase 4 migrations will be
applied to the test database first and verified; the development database will not be
rewritten without explicit owner approval.

---

## 3. Test inventory (actual, from disk)

`vitest.config.ts` runs `server/tests/**/*.test.ts`, `fileParallelism: false`,
`setupFiles: ['server/tests/db-singleton.ts']`, 60 s timeouts.

| Suite file | `it()`/`test()` blocks |
|---|---|
| attachments.integration.test.ts | 7 |
| channels.integration.test.ts | 24 |
| crm-analytics.integration.test.ts | 4 |
| crm-premium.integration.test.ts | 10 |
| crm-quotation-order.integration.test.ts | 3 |
| crm-tenant-security.integration.test.ts | 7 |
| customers.integration.test.ts | 12 |
| deal-stage-concurrency.integration.test.ts | 3 |
| deals.integration.test.ts | 9 |
| dm-concurrency.test.ts | 8 |
| messages.integration.test.ts | 23 |
| notifications.integration.test.ts | 9 |
| read-cursor.test.ts | 9 |
| realtime.integration.test.ts | 11 |
| sales-reps.integration.test.ts | 4 |
| **Vitest total** | **143** |

Plus the Phase 1 suites: `npm test` → `src/tests/runner.ts` (19 acceptance assertions across
5 gates) and `npx tsx server/tests/integration.ts` (33 checks). Reported retained baseline:
**195 unique checks = 19 + 33 + 143**. Phase 4 re-execution results are recorded in
`PHASE-4-TEST-REPORT.md`.

### 3.1 Test-database safety defect found

`server/tests/global-setup.ts` line 32 defaults to **`innowit_one`** (the development
database) when `DATABASE_URL` is unset:

```ts
const testDbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/innowit_one?schema=public';
```

`server/tests/test-db.ts` correctly defaults to `innowit_one_test`. The harness therefore
has one path that can silently target the development DB. **Defect D-01.** Phase 4 adds a
hard guard that asserts `current_database()` is an approved test database before any fixture
mutation, and fails closed otherwise.

---

## 4. Schema reality (58 models, 19 enums, 1,562 lines)

Accounting-relevant models and their true state:

| Concept | Model | State |
|---|---|---|
| Chart of accounts | `Account` | flat list; `type`, `accountNumber`, `currency`, `isActive`, mutable `currentBalance` |
| Journal | `JournalEntry` / `JournalLine` | no status field, no branch, no period, no FX, no source idempotency key |
| Sales invoice | `SalesInvoice` / `SalesInvoiceItem` | exists; `taxClassification` enum; no tax-rate snapshot per line |
| Customer payment | `CustomerPayment` | **1 payment → 1 invoice hard FK**; no allocation table |
| Credit note | `CreditNote` | header-only, no lines, no status |
| eTIMS | `EtimsConfiguration` / `EtimsInvoice` / `EtimsTransmissionQueue` | real outbox with idempotency key and retry fields |
| Supplier / PO | `Supplier` / `PurchaseOrder` | header-only PO, no items, no GRN, no bills |
| Audit | `AuditLog` | free-text action/entity, **no organizationId** |

Absent (confirmed by name and by schema read): `FiscalYear`, `AccountingPeriod`,
`CostCentre`, `Dimension`, `Budget`, `TaxCode`, `TaxRate`, `ExchangeRate`, `BankAccount`,
`BankStatement`, `BankReconciliation`, `PaymentAllocation`, `SupplierBill`, `SupplierPayment`,
`GoodsReceipt`, `MpesaTransaction`.

Money is typed `Decimal @db.Decimal(14,2)` throughout (49 occurrences) — the type layer is
sound; the **application layer is not** (see §5).

---

## 5. Confirmed defects in the financial code paths

| ID | Severity | Defect | Evidence |
|---|---|---|---|
| D-01 | High | Test global setup defaults to the development DB `innowit_one` | `server/tests/global-setup.ts:32` |
| D-02 | Critical | Journal balance check uses **float** `z.number()` and `Math.abs(a-b) < 0.01` — a rounding tolerance, not exact equality | `server/routes/journal.ts:10-15, 49-53` |
| D-03 | Critical | No journal lifecycle: any authenticated accountant POSTs a journal straight into the ledger; no DRAFT/PENDING/POSTED, no approval, no `postedBy` | `server/routes/journal.ts:133-208` |
| D-04 | Critical | Posted journals are editable: `PUT /api/journal/:id` deletes and recreates lines and rewrites balances outside a transaction | `server/routes/journal.ts:211-310` |
| D-05 | Critical | Reversal is not atomic: reversal entry, original `isReversed` flag and balance updates run outside a transaction | `server/routes/journal.ts:348-391` |
| D-06 | High | No idempotency: a retried source post creates a second journal. `entryNumber` uniqueness is the only guard and it is client-supplied | `server/routes/journal.ts:142-148` |
| D-07 | Critical | Account balance cache is written by ad-hoc `increment` calls in four route files with **no reconciliation** and no derived-balance check | `journal.ts:197`, `invoices.ts:626`, `payments.ts:250`, `creditNotes.ts:259` |
| D-08 | Critical | No accounting periods or fiscal years exist, so closed-period posting is unenforceable | schema (no model) |
| D-09 | Critical | No branch or cost-centre dimension on journal lines | `JournalLine` definition |
| D-10 | High | Invoice posting resolves accounts by hardcoded number with a type fallback (`find(a => a.type === 'ASSET')`), so it can post AR to any asset account | `server/routes/invoices.ts:579-581` |
| D-11 | High | Payments can over-allocate: the guard is a read-then-write comparison on `paidAmount` with `Number()` coercion | `server/routes/payments.ts:193-208` |
| D-12 | High | `DELETE /api/invoices/:id` hard-deletes a posted invoice and its journal (marks the journal reversed, then deletes the invoice) — posted financial records are not immutable | `server/routes/invoices.ts:699-727` |
| D-13 | Medium | Invoice POST creates a journal but does not enforce that debit=credit from snapshotted amounts; it trusts the stored subtotal/tax/total | `server/routes/invoices.ts:592-623` |
| D-14 | Medium | Tax is an enum (`STANDARD_16`) with the rate hardcoded in comments and `QuotationItem.taxRate @default(16.00)` — no effective-dated tax rule | `schema.prisma:157-162`, quotation models |
| D-15 | High | The accounting UI is **localStorage mock data**: `loadAccountingState()` returns `SEED_INVOICES`, `SEED_BANK_TRANSACTIONS`, `SEED_SUPPLIER_BILLS` and persists to `innowit_accounting_v4` | `src/modules/accounting/store.ts:17-55` |
| D-16 | Medium | Financial reports compute from the in-memory `accounts[].balance` array, not from posted journal lines | `src/components/accounting/FinancialReportsView.tsx:33-75` |
| D-17 | Low | `AuditLog` has no `organizationId`, so tenant-scoped audit queries require a join and cross-tenant leakage is plausible | `schema.prisma:1547-1562` |
| D-18 | Low | `JournalEntry.reversalEntryId` is `@unique` with no `@relation` — referential integrity is unenforced | `schema.prisma:1105` |

---

## 6. Entity reuse / dependency matrix

| Phase 4 need | Existing asset | Decision |
|---|---|---|
| GL header/lines | `JournalEntry`, `JournalLine` | **EXTEND** additively: `status`, `branchId`, `periodId`, `currency`, `exchangeRate`, `sourceKey` (idempotency), `postedAt/postedBy`, `approvedAt/approvedBy`, `reversalOfId`, `reversalReason`. No new ledger table. |
| Chart of accounts | `Account` | **EXTEND**: `parentId`, `subtype`, `normalBalance`, `isPostable`, `isControl`, `controlType`, `description`. Keep `accountNumber` and `currentBalance`. |
| AR invoice | `SalesInvoice` + items | **REUSE**. Add `taxSnapshotJson`, `postedJournalId`, `currency`, `exchangeRate`. |
| AR receipt | `CustomerPayment` | **EXTEND** to allow unapplied cash: `salesInvoiceId` becomes nullable via additive migration, add `customerId`, `branchId`, `currency`, `unappliedAmount`, `status`, `providerRef`. New `PaymentAllocation` table for many-to-many allocation. |
| Credit note | `CreditNote` | **EXTEND**: `status`, `postedJournalId`, `branchId`, optional `customerPaymentId`. |
| AP | `Supplier`, `PurchaseOrder` | **REUSE**; new `SupplierBill`, `SupplierBillLine`, `SupplierPayment`, `PaymentAllocation` (shared). No GRN fabrication. |
| Tax | `TaxClassification` enum | **KEEP for legacy**; new `TaxCode` (effective-dated, versioned) and `TaxTransaction` snapshot table. |
| eTIMS | `EtimsTransmissionQueue` | **UNTOUCHED** semantics. Posting still enqueues `PENDING`; `POSTED ≠ ACCEPTED`. |
| Audit | `AuditLog` | **EXTEND** with `organizationId`, `branchId` (nullable, additive). |
| Periods | none | **NEW** `FiscalYear`, `AccountingPeriod`. |
| Banking | none | **NEW** `BankAccount`, `BankStatement`, `BankStatementLine`, `BankReconciliation`, `BankMatch`. |
| FX | none | **NEW** `ExchangeRate`. |
| Budget | none | **NEW** `Budget`, `BudgetLine`. |
| Dimensions | `Department`, `Branch` | **REUSE** `Department` as cost-centre source; add `costCentreId` to journal lines. Do not build Phase 5 project management. |
| M-Pesa | none | **NEW** `MpesaTransaction` + provider adapter interface. |

**No second ledger, no second invoice model, no duplicate customer/supplier records.**

---

## 7. Architecture conflict record

The original specification suite references **Next.js**. The shipped runtime is
**React 19 + Vite + Express + Prisma + PostgreSQL + Tauri 2**. Per master prompt §0.1(4),
the repository is authoritative and no framework rewrite will occur. Phase 4 work targets the
existing Express route modules and the existing React component tree.

---

## 8. Baseline risk register

| Risk | Impact | Mitigation in Phase 4 |
|---|---|---|
| Balance cache drift already present in dev DB | Reports may disagree with ledger | Add derived-balance reconciliation service + report; never silently rewrite. Report drift as a finding. |
| Pre-existing migration name drift on `innowit_one` | `migrate deploy` would fail there | New migrations applied and verified on `innowit_one_test`; dev DB remediation is a separate, owner-approved step. |
| Float arithmetic in existing endpoints | Rounding imbalance | Canonical posting service uses `Prisma.Decimal` exclusively; legacy endpoints routed through it. |
| Mock-data UI | Accountant could trust fabricated figures | Replace store with API-backed data for all Phase 4 screens. |
| 143 Vitest tests depend on shared DB fixtures | New models may break cleanup order | Extend cleanup in FK order; run full suite after each wave. |

---

## 9. Gate 4.0 decision

| Requirement | Status |
|---|---|
| Baseline tests executed and totals recorded | Recorded in `PHASE-4-TEST-REPORT.md` |
| No financial business logic changed before baseline evidence | **HONOURED** — this audit is read-only |
| All accounting assets and defects inventoried | YES (§4, §5) |
| Next.js vs React/Vite mismatch documented | YES (§7) |

**Gate 4.0: PASS** (baseline captured; implementation begins from this record).
