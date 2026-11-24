# PHASE 3 TEST REPORT: INNOWIT ONE CRM & SALES PIPELINE

**Document Version:** 1.2.0
**Date:** 2026-11-19 (original) · **Reconciled:** 2026-11-23
**Status:** Reconciled
**Commit:** `7c35b39aadcf79e79548059ece46f6e5bbbc7d1f` **[CORRECTED — was `88d6b1b`]**
**Canonical test inventory:** `docs/PHASE-3-TEST-ACCOUNTING.md`

> **Reconciliation notice (2026-11-23).** This report previously published a total of 280/280, a per-file Phase 2 breakdown that did not match the files, and six performance timings with no supporting artifacts. Totals, breakdown, benchmarks and artifact claims are corrected below and marked **[CORRECTED]**. Historical figures are retained in correction notes rather than deleted.

---

## 1. Test Execution Summary

| Test Suite | Command | Tests | Basis | Duration |
|---|---|---:|---|---|
| Phase 1 Acceptance Gates | `npm test` | 19 | Static inventory | not measured **[CORRECTED]** |
| Standalone Integration | `npx tsx server/tests/integration.ts` | 33 | Static inventory | not measured **[CORRECTED]** |
| Vitest — Phase 2 retained | `npx vitest run` | 91 | Static inventory | not measured **[CORRECTED]** |
| Vitest — Phase 3 new CRM | `npx vitest run` | 46 | Static inventory | not measured **[CORRECTED]** |
| **Vitest run total** | `npx vitest run` | **137** | 91 + 46 | not measured |
| **Unique combined** | all three commands | **189** | 19 + 33 + 137 | not measured |

**Execution status.** None of these suites was re-executed during the 2026-11-23 reconciliation. `.env` sets `DATABASE_URL` to `...:5432/innowit_one`, the working application database, not a separate test database. Both Vitest and the integration runner create and delete rows, so running them would mutate working data. All counts above are **static inventories of tests present in the checkout**, not observed pass rates. See `PHASE-3-TEST-ACCOUNTING.md` §7.

**Correction note — durations.** The original table reported 18ms / ~5s / ~11s / ~27s / <5s / ~1s / <3s. Those figures were not reproduced and no raw log is retained in the repository. They are removed rather than restated.

---

## 2. Phase 1 Acceptance Gates (19 assertions)

| Gate | Description | Assertions | Source |
|---|---|---:|---|
| Gate 1 | Accounting Core & GL Integrity | 4 | `acceptanceGates.ts:100,126,148,167` |
| Gate 2 | Inventory & Multi-Warehouse | 3 | `acceptanceGates.ts:201,213,237` |
| Gate 3 | Order-to-Cash Continuity | 4 | `acceptanceGates.ts:276,288,300,320` |
| Gate 4 | Kenya eTIMS Compliance | 4 | `acceptanceGates.ts:354,366,380,401` |
| Gate 5 | Architecture, Security & RBAC | 4 | `acceptanceGates.ts:444,464,482,493` |
| **Total** | | **19** | 19 `check:` objects verified |

Runner: `src/tests/runner.ts`, invoked by `npm test`. In-process, no database, no HTTP. This per-gate split is unchanged from the original and is **correct**.

---

## 3. Phase 2 Regression Tests (91 tests)

**[CORRECTED — the previous per-file breakdown did not match the files.]**

| Test File | Tests (verified) | Previous claim | Description |
|---|---:|---:|---|
| `channels.integration.test.ts` | **24** | 12 | Channel CRUD, membership, archiving |
| `messages.integration.test.ts` | **23** | 15 | DM, threading, reactions, pins |
| `realtime.integration.test.ts` | **11** | 14 | Socket.IO events, presence, typing |
| `notifications.integration.test.ts` | **9** | 8 | Notification types, preferences |
| `read-cursor.test.ts` | **9** | 9 | Read cursor monotonicity |
| `dm-concurrency.test.ts` | **8** | 10 | DM identity, race conditions |
| `attachments.integration.test.ts` | **7** | 7 | File upload, scan, download |
| `integration.ts` (core) | **not a Vitest file** | 16 | Runs standalone, not via Vitest |
| **Total** | **91** | 91 | |

**Correction note.** The previous column summed to the correct 91 by coincidence: it listed 12+15+8+10+9+7+14 = 75 from the seven Vitest files plus 16 from `integration.ts`, which Vitest does not include. The actual seven files sum to 91 on their own. The total was right; the composition was wrong.

---

## 4. Standalone Integration Tests (33 checks)

Runner: `server/tests/integration.ts`, invoked by `npx tsx server/tests/integration.ts`. Contains 33 `record(...)` calls numbered `#1`–`#33`, spanning AUTH, RBAC, TENANT, ACCOUNTING, INVENTORY and ETIMS.

This file is **not** matched by the Vitest `include` glob (`server/tests/**/*.test.ts`), so it is a separate execution and never part of the 137 Vitest total.

**Status:** the 33-check inventory is verified. The **pass** result is historical (commit `5578524`, "record 33/33 integration test results after remediation") and is **not** corroborated by the current artifact — see §10.

---

## 5. TypeScript Compilation

**Not re-verified in the 2026-11-23 audit.**

The original report recorded:

```
Command: npx tsc --noEmit
Result: PASS (0 errors, 0 warnings)
Files checked: 1732 modules
```

No raw output is retained in the repository. Retained as a historical claim, not a current observation.

---

## 6. Build Verification

### 6.1 Vite Production Build

**Not re-verified.** Original record: `npm run build` → PASS, `dist/assets/index-*.js` 1.38 MB (gzipped 298 kB), chunk-size warning expected.

### 6.2 Tauri Build Check

**Not re-verified.** Original record: `cd src-tauri && cargo check -q` → PASS (0 errors).

`dist/` and `src-tauri/target/` are gitignored, so no build artifact is committed as evidence.

---

## 7. Phase 3 Specific Test Coverage

### 7.1 Dedicated CRM Integration Test Files — **46 tests** **[CORRECTED]**

| Test File | Tests | Gate Coverage |
|---|---:|---|
| `customers.integration.test.ts` | 12 | P3.1 |
| `deals.integration.test.ts` | 9 | P3.2 |
| `deal-stage-concurrency.integration.test.ts` | 3 | P3.3 |
| `crm-analytics.integration.test.ts` | 4 | P3.4, P3.7 |
| `crm-premium.integration.test.ts` | 4 | P3.8 |
| `sales-reps.integration.test.ts` | 4 | P3.6 |
| `crm-tenant-security.integration.test.ts` | 7 | P3.10 |
| `crm-quotation-order.integration.test.ts` | 3 | P3.11 |
| **Total new CRM tests** | **46** | **P3.1–P3.11** |

**Correction note.** This section was previously headed "Dedicated CRM Integration Test Files (137 tests)" while its own table summed to 46. The 137 figure is the **entire Vitest run**; 46 is the new Phase 3 portion and 91 is retained Phase 2 coverage.

**Additional correction (2026-11-24).** The 4 tests in `crm-premium.integration.test.ts` cover **Saved Views** (2), **Custom Fields** (1), and **Automation Rule creation** (1). **No test covers import or export.** The import/export API routes exist but are non-functional (see `PHASE-3-IMPORT-EXPORT.md` reconciliation notice) and are untested. This is tracked as RC-09 in `PHASE-3-RELEASE-RECONCILIATION.md`.

### 7.2 Schema & Migration Verification

| Test | Method | Status |
|---|---|---|
| Core migration applies cleanly | `npx prisma migrate deploy` | Historical ✅ — not re-run |
| Additive: automation_rules | `npx prisma migrate deploy` | Historical ✅ — not re-run |
| Additive: deal_closed_at | `npx prisma migrate deploy` | Historical ✅ — not re-run |
| Additive: quotation_items | `npx prisma migrate deploy` | Historical ✅ — not re-run |
| New enums created | `SELECT enumlabel FROM pg_enum` | Historical ✅ — not re-run |
| New tables exist | `\dt` | Historical ✅ — not re-run |
| Indexes created | `\di` | Historical ✅ — not re-run |
| FK constraints valid | `information_schema.table_constraints` | Historical ✅ — not re-run |
| Backfill closedAt from stage history | Migration inspection | SQL present; backfill not executed in this audit |

Migration **files** are verified present. Migration **applied** status is `UNVERIFIED`: `npx prisma migrate status` timed out with no reachable database from the audit session.

### 7.3 API Endpoint Coverage (via the 46 CRM tests)

The route surface listed in the original §7.3 is consistent with `server/routes/customers.ts`, `deals.ts`, `tasks.ts`, `salesReps.ts`, `crmAnalytics.ts`, `crmPremium.ts` and `quotations.ts`. Route existence is **source-verified**; per-endpoint pass status is `UNVERIFIED` because the suites were not re-executed.

### 7.4 Concurrency & Lifecycle Tests

Covered by `deals.integration.test.ts` (9) and `deal-stage-concurrency.integration.test.ts` (3): valid/invalid transitions, WON with `closedAt`, LOST with mandatory reason, reopen with reason, history immutability, stale-version conflict, concurrent transitions, org isolation, close-edit-reopen-close.

### 7.5 Tenant Security Tests

Covered by `crm-tenant-security.integration.test.ts` (7): cross-org customer/deal/task/contact/sales-rep access blocked, client-supplied `orgId` ignored, branch scoping enforced.

---

## 8. Performance Benchmarks — **UNVERIFIED** **[CORRECTED]**

The original table published these figures:

| Operation | Target | Previously claimed "Actual" | Evidence status |
|---|---|---|---|
| Customer list (100 records) | < 200ms | ~45ms | **No reproducible evidence** |
| Deal Kanban load (500 deals) | < 500ms | ~180ms | **No reproducible evidence** |
| Dashboard metrics | < 500ms | ~120ms | **No reproducible evidence** |
| Task toggle complete | < 50ms | ~15ms | **No reproducible evidence** — and this measures a UI state update, not API or database latency |
| Customer search (10k) | < 300ms | ~85ms | **No reproducible evidence** |
| Pipeline analytics | < 1s | ~350ms | **No reproducible evidence** |

**Correction note.** A repository search found no benchmark script, no performance npm script, no fixture dataset for 100/500/10,000-record scenarios, no raw timing artifact, and no recorded environment, warm-up, iteration count or statistic (mean/median/p95). These six numbers are **informal observations with no retained evidence**. They are not verified performance claims and should not be cited in capacity planning.

---

## 9. Security Test Results

The original table's expectations are consistent with the tenant-security test file and with `authorize()` guards in `crmPremium.ts`. Retained as **source-consistent**, with pass status `UNVERIFIED` pending re-execution.

---

## 10. Test Artifacts

| Artifact | Location | Status |
|---|---|---|
| Integration results | `server/tests/integration-results.json` | **Present but stale — contains 1 result with `pass: false`, not 33/33** **[CORRECTED]** |
| Vitest coverage | `coverage/` | Gitignored, not committed |
| TypeScript build output | `dist/` | Gitignored, not committed |
| Core migration SQL | `prisma/migrations/20261119_phase3_crm_domain/migration.sql` | Present |
| Additive: automation_rules | `prisma/migrations/20261119_phase3_automation_rules/migration.sql` | Present |
| Additive: deal_closed_at | `prisma/migrations/20261119_phase3_deal_closed_at/migration.sql` | Present |
| Additive: quotation_items | `prisma/migrations/20261119_phase3_quotation_items/migration.sql` | Present |
| CRM test files | `server/tests/*.integration.test.ts` (8 files) | Present, 46 tests |

**Correction note.** `integration-results.json` was cited as proof of 33/33. It does not contain that. It holds a single failing result, apparently from a partial or aborted run. The 33/33 claim therefore rests on commit `5578524`, not on a current artifact.

---

## 11. Conclusion

**Static inventory: 189 unique checks.**

- Phase 1 Acceptance: **19**
- Standalone Integration: **33**
- Vitest total: **137** — of which **91** retained Phase 2 and **46** new Phase 3 CRM
- Unique combined: **189** (19 + 33 + 137, no overlap)
- Retained regression subtotal: **143** (19 + 33 + 91)

**Current pass rate: not measured.** No suite was executed against a safe test database in the 2026-11-23 reconciliation.

**Correction note.** The previous conclusion read "All Tests Pass: 280/280 (176 regression + 137 new Phase 3 + 46 dedicated CRM)". That arithmetic double-counts twice: the 46 CRM tests are already inside 137, and the 33-check integration suite was counted in both the 176 and the 137 lineage. 280 is not a valid total.

**Phase 3 CRM & Sales Pipeline: inventory verified, pass rate unverified, release decision CONDITIONAL PASS.** See `docs/PHASE-3-RELEASE-RECONCILIATION.md`.

---

*Originally generated: 2026-11-19 08:27 UTC*
*Reconciled: 2026-11-23 · against HEAD `7c35b39aadcf79e79548059ece46f6e5bbbc7d1f`*
