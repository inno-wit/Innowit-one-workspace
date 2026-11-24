# PHASE 3 TEST ACCOUNTING: CANONICAL TEST INVENTORY

**Document Version:** 1.0.0
**Audit Date:** 2026-11-23
**Status:** Canonical (supersedes contradictory totals in earlier Phase 3 documents)
**Branch:** `work/innowit-one-build`
**Audited HEAD:** `7c35b39aadcf79e79548059ece46f6e5bbbc7d1f`
**Purpose:** Establish one exact, deduplicated test inventory for Phase 3.

---

## 1. Why this document exists

Earlier Phase 3 documents published mutually incompatible test totals: **19, 33, 46, 91, 137, 143, 176 and 280**. Some of those numbers are correct subtotals; several are double-counted totals. This document resolves them from the actual repository contents rather than from arithmetic or prior prose.

Nothing here is inferred from a previous report. Every count below is derived from the test files present in the audited checkout.

---

## 2. Test discovery configuration (verified)

`vitest.config.ts`:

```ts
test: {
  include: ['server/tests/**/*.test.ts'],
  exclude: ['node_modules', 'dist'],
  setupFiles: ['server/tests/db-singleton.ts'],
  environment: 'node',
  fileParallelism: false,
}
```

Relevant `package.json` scripts:

| Script | Command |
|---|---|
| `test` | `tsx src/tests/runner.ts` |
| `lint` | `tsc --noEmit` |

There is **no** `vitest` script in `package.json`; Vitest is invoked directly via `npx vitest run`.

There is **no** Playwright configuration, no `e2e/` directory, and no `@playwright/test` dependency. See Gate I in the release reconciliation.

---

## 3. Canonical inventory

### 3.1 Phase 1 Acceptance Gates — 19 assertions

- Runner: `src/tests/runner.ts`
- Assertion definitions: `src/tests/acceptanceGates.ts`
- Invoked by: `npm test` (equivalently `npx tsx src/tests/runner.ts`)
- Mechanism: in-process, no database, no HTTP

| Gate | Assertions | Line refs (`acceptanceGates.ts`) |
|---|---:|---|
| Gate 1 — Accounting Core & GL Integrity | 4 | 100, 126, 148, 167 |
| Gate 2 — Inventory Ledger & Multi-Warehouse | 3 | 201, 213, 237 |
| Gate 3 — Cross-Module Order-to-Cash | 4 | 276, 288, 300, 320 |
| Gate 4 — Kenya eTIMS Compliance & Air-Gap | 4 | 354, 366, 380, 401 |
| Gate 5 — Architecture, Security & 12-Role RBAC | 4 | 444, 464, 482, 493 |
| **Total** | **19** | |

Verified by counting 19 `check:` assertion objects in `acceptanceGates.ts`. The earlier report's per-gate split (4/3/4/4/4) is **correct**.

### 3.2 Standalone integration suite — 33 checks

- Runner: `server/tests/integration.ts`
- Invoked by: `npx tsx server/tests/integration.ts`
- Mechanism: spawns its own API server on port 3101 and exercises the real HTTP API against PostgreSQL
- Structure: 33 `record(id, suite, expected, actual, pass)` calls, numbered `// #1` … `// #33`

The earlier report's 33-row table (AUTH, RBAC, TENANT, ACCOUNTING, INVENTORY, ETIMS) matches the runner structure. **33 is correct.**

Important: this suite is **not** matched by the Vitest `include` glob (`server/tests/**/*.test.ts`) because the filename is `integration.ts`, not `*.test.ts`. It is therefore a **separate execution**, never part of the Vitest total.

### 3.3 Vitest suite — 137 tests across 15 files

Command: `npx vitest run`

| Test file | Tests | Phase |
|---|---:|---|
| `channels.integration.test.ts` | 24 | Phase 2 |
| `messages.integration.test.ts` | 23 | Phase 2 |
| `realtime.integration.test.ts` | 11 | Phase 2 |
| `notifications.integration.test.ts` | 9 | Phase 2 |
| `read-cursor.test.ts` | 9 | Phase 2 |
| `dm-concurrency.test.ts` | 8 | Phase 2 |
| `attachments.integration.test.ts` | 7 | Phase 2 |
| **Phase 2 subtotal** | **91** | |
| `customers.integration.test.ts` | 12 | Phase 3 |
| `deals.integration.test.ts` | 9 | Phase 3 |
| `crm-tenant-security.integration.test.ts` | 7 | Phase 3 |
| `crm-analytics.integration.test.ts` | 4 | Phase 3 |
| `crm-premium.integration.test.ts` | 4 | Phase 3 |
| `sales-reps.integration.test.ts` | 4 | Phase 3 |
| `deal-stage-concurrency.integration.test.ts` | 3 | Phase 3 |
| `crm-quotation-order.integration.test.ts` | 3 | Phase 3 |
| **Phase 3 CRM subtotal** | **46** | |
| **Vitest total** | **137** | |

Verified by counting `it(`/`test(` declarations per file: 91 + 46 = 137.

---

## 4. Deduplication analysis

| Question | Answer | Evidence |
|---|---|---|
| Are the 33 integration checks included in the 137 Vitest total? | **No** | `integration.ts` does not match `server/tests/**/*.test.ts` |
| Are the 19 acceptance assertions included in the 137? | **No** | They run in-process from `src/tests/`, outside the Vitest include glob |
| Do the 46 CRM tests overlap the 91 Phase 2 tests? | **No** | Distinct files, distinct `describe` blocks, no shared file |
| Is any test file executed by more than one command? | **No** | Each suite has exactly one entry point |

No test is executed by two commands. There is no genuine duplication in the repository — the duplication exists only in the **reporting**, where the same suite was counted in multiple table rows.

---

## 5. Unique combined count

```
Phase 1 Acceptance   19
Standalone Integration 33
Vitest total        137   (91 Phase 2 + 46 Phase 3 CRM)
-----------------------
UNIQUE TOTAL        189
```

**189 unique checks** (19 + 33 + 137), with no overlap.

### 5.1 New Phase 3 CRM tests: 46

The figure **137** describes the *entire Vitest run*, not new Phase 3 tests. 137 − 91 (retained Phase 2 tests) = **46 new CRM tests**. Any statement that Phase 3 introduced 137 new tests is incorrect.

---

## 6. Correction of historical totals

| Historical figure | Where claimed | Verdict | Explanation |
|---|---|---|---|
| **19** | Test Report §1, Exit Audit §5 | Correct | Phase 1 acceptance assertions |
| **33** | Test Report §1, §4; Exit Audit §5 | Correct | Standalone integration checks |
| **46** | Test Report §7.1 | Correct | New Phase 3 CRM tests |
| **91** | Test Report §3; Exit Audit §5 | Correct | Phase 2 Vitest subset |
| **137** | Test Report §1, §11; Exit Audit §5 | Correct total, wrong label | It is the **whole Vitest run**, not "new Phase 3 tests" |
| **143** | Test Report §1 "Total Regression" | Correct subtotal, misleading label | 19 + 33 + 91. It **excludes** the 46 CRM tests, so calling it a "Total" is wrong |
| **176** | Exit Audit §1, §5 | **Incorrect — double count** | 19 + 33 + 91 + 33. The 33-check integration suite is counted twice, once as "Phase 1 Integration" and again as "Phase 2 Integration" |
| **280** | Test Report §11 | **Incorrect — double count** | 176 + 137 + 46. The 46 CRM tests are already inside 137, and 137 is not additive to 176 |

### 6.1 Additional defect: incorrect per-file breakdown

`PHASE-3-TEST-REPORT.md` §3 lists Phase 2 per-file counts that do **not** match the files:

| File | Report claims | Actual |
|---|---:|---:|
| `channels.integration.test.ts` | 12 | **24** |
| `messages.integration.test.ts` | 15 | **23** |
| `notifications.integration.test.ts` | 8 | **9** |
| `dm-concurrency.test.ts` | 10 | **8** |
| `realtime.integration.test.ts` | 14 | **11** |
| `read-cursor.test.ts` | 9 | 9 |
| `attachments.integration.test.ts` | 7 | 7 |
| `integration.ts` (core) | 16 | **not a Vitest file at all** |

The reported column sums to 91, and the actual Phase 2 Vitest files also sum to 91 — but the composition is different. The report appears to have padded the Phase 2 table with 16 phantom checks from `integration.ts` to reach the correct total. The total was right; the breakdown was fabricated. It is corrected in §3.3 above.

---

## 7. Execution status in this audit

**No database-backed suite was re-executed during this reconciliation.**

Reason: `.env` sets

```
DATABASE_URL="postgresql://postgres:***@localhost:5432/innowit_one?schema=public"
```

The configured target is **`innowit_one`** — the working application database, not a dedicated test database (no `_test` suffix, no separate test URL, and `server/tests/db-singleton.ts` does not override `DATABASE_URL`). Both `npx vitest run` and `npx tsx server/tests/integration.ts` create, mutate and delete rows. Executing them against the working database would violate the audit's data-safety constraint.

| Suite | Re-executed in this audit? | Reason |
|---|---|---|
| Phase 1 Acceptance (19) | No | Not re-run; prior artifact retained. Does not touch the database, so re-execution is safe and recommended as a follow-up |
| Integration (33) | No | Writes to `innowit_one` |
| Vitest (137) | No | Writes to `innowit_one` |

### 7.1 Stored integration artifact is stale

`server/tests/integration-results.json` currently contains **1 result with `pass: false`** — not a 33/33 pass record. The file does not corroborate the historical "33/33" claim. It appears to have been overwritten by a partial or aborted run. The 33/33 claim therefore rests on the historical commit `5578524` ("record 33/33 integration test results after remediation"), which is **historical evidence, not a current-checkout observation**.

### 7.2 Required follow-up

1. Provision a dedicated test database (e.g. `innowit_one_test`) and point `DATABASE_URL` at it for test runs.
2. Run `npx vitest run` and `npx tsx server/tests/integration.ts` against it, capturing exit codes and runner summaries.
3. Regenerate `server/tests/integration-results.json` from a complete run.
4. Record the fresh results here, replacing §7.

Until then, the 189-check figure is a **static inventory count** (tests present in the checkout), not a freshly observed pass rate.

---

## 8. Summary

| Metric | Value | Basis |
|---|---:|---|
| Phase 1 acceptance assertions | 19 | Static, verified |
| Standalone integration checks | 33 | Static, verified |
| Vitest tests | 137 | Static, verified |
| — Phase 2 retained | 91 | Static, verified |
| — Phase 3 new CRM | 46 | Static, verified |
| **Unique total** | **189** | 19 + 33 + 137, no overlap |
| Fresh pass rate observed in this audit | **Not measured** | Suites not re-run (see §7) |
| Historical claims superseded | 143, 176, 280 | Double counts (§6) |

---

*Generated: 2026-11-23 · Audit of `7c35b39` on `work/innowit-one-build`*
