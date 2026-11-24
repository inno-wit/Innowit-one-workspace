# PHASE 3 REA EVIDENCE

**Document Version:** 1.0.0
**Created:** 2026-11-23
**Status:** Reconciled replacement for a document that was previously claimed but did not exist
**Audited HEAD:** `7c35b39aadcf79e79548059ece46f6e5bbbc7d1f`
**Branch:** `work/innowit-one-build`

---

## 0. Reconciliation notice

`PHASE-3-EXIT-AUDIT.md` §4 listed `PHASE-3-REA-EVIDENCE.md` in its evidence package as though it were a delivered document. It was **not present in the repository**: `git ls-files docs/` did not contain it, and no such file existed on disk at the start of this audit.

This document replaces that false claim. It records only what was actually observed during the 2026-11-23 reconciliation, with every item explicitly classified. Where no evidence exists, that is stated rather than filled with invented observations.

---

## 1. Evidence classification scheme

| Class | Meaning |
|---|---|
| `SOURCE_INSPECTED` | A file in the repository was read and a claim is supported by its contents, with path and line reference |
| `TEST_VERIFIED` | A test suite was executed during this audit and its output retained |
| `LIVE_RUNTIME_OBSERVED` | A running application or live database was observed during this audit |
| `PUBLIC_DOCUMENTATION` | An external published source was consulted |
| `INFERRED` | A conclusion drawn from source inspection rather than direct observation |
| `UNVERIFIED` | Claimed elsewhere but not substantiated by any available evidence |

---

## 2. Summary of evidence actually obtained

| Class | Count in this audit |
|---|---:|
| `SOURCE_INSPECTED` | 18 findings |
| `TEST_VERIFIED` | **0** |
| `LIVE_RUNTIME_OBSERVED` | **0** |
| `PUBLIC_DOCUMENTATION` | 0 |
| `INFERRED` | 5 findings |
| `UNVERIFIED` | 6 claims |

**No test suite was executed and no live application session was conducted during this audit.** Reading TypeScript and TSX source is source inspection, not runtime observation, and is classified accordingly throughout.

---

## 3. `SOURCE_INSPECTED` findings

### 3.1 Repository and Git

| ID | Finding | Evidence |
|---|---|---|
| S-01 | Branch is `work/innowit-one-build`; HEAD is `7c35b39aadcf79e79548059ece46f6e5bbbc7d1f` | `git branch --show-current`, `git rev-parse HEAD` |
| S-02 | All six reported SHAs exist and are ancestors of HEAD | `git rev-parse --verify`, `git merge-base --is-ancestor` |
| S-03 | `673ebaf` is the last commit touching `prisma/schema.prisma` and `server/tests/` | `git log -1 -- prisma/schema.prisma` |
| S-04 | Eight post-`673ebaf` commits are documentation-only SHA rewrites | `git log --oneline --decorate --graph -30` |
| S-05 | Working tree clean apart from untracked `docs/PHASE-3-docs.zip` | `git status --porcelain=v1` |

### 3.2 Test inventory

| ID | Finding | Evidence |
|---|---|---|
| S-06 | Vitest includes `server/tests/**/*.test.ts` only | `vitest.config.ts` |
| S-07 | 15 Vitest files contain 137 `it(`/`test(` declarations | per-file regex count |
| S-08 | The 8 CRM files contain 46 tests (12/9/7/4/4/4/3/3) | per-file count |
| S-09 | The 7 Phase 2 files contain 91 tests | per-file count |
| S-10 | `server/tests/integration.ts` contains 33 `record(...)` calls numbered `#1`–`#33` | source read |
| S-11 | `src/tests/acceptanceGates.ts` contains 19 `check:` assertions across 5 gates | source read |
| S-12 | `server/tests/integration-results.json` holds 1 result with `pass: false` | JSON parse |

### 3.3 Schema and migrations

| ID | Finding | Evidence |
|---|---|---|
| S-13 | `schema.prisma` declares 57 models and 26 enums | regex count |
| S-14 | Baseline `b87ac48` declares 46 models and 22 enums | `git show b87ac48:prisma/schema.prisma` |
| S-15 | Phase 3 adds 11 models and 4 enums, counted once | set difference |
| S-16 | `AutomationRule` and `AutomationExecutionLog` are created only in `20261119_phase3_automation_rules` | migration SQL read |
| S-17 | No `ImportJob` model exists in schema or any migration | model list + migration read |
| S-18 | 4 Phase 3 migration directories exist; 7 migration directories total | directory listing |

### 3.4 Frontend and realtime

| ID | Finding | Evidence |
|---|---|---|
| S-19 | `localStorage` key `innowit_crm_v3` persists full CRM records | `src/modules/crm/store.ts:19,107–136` |
| S-20 | CRM syncs from server on mount and sets `isServerSynced: true` | `src/components/views/CrmView.tsx:63–100` |
| S-21 | Failed writes keep optimistic local state with no rollback | `CrmView.tsx:139–147` |
| S-22 | `RealtimeGateway` emits no `crm.*` events | `server/services/realtime/RealtimeGateway.ts` |
| S-23 | No CRM room subscription in the frontend | `src/services/realtime/SocketClient.ts` |

---

## 4. `INFERRED` findings

| ID | Inference | Basis | Confidence |
|---|---|---|---|
| I-01 | The CRM frontend is server-backed with a non-authoritative local cache | S-19, S-20, S-21 | High |
| I-02 | CRM realtime is deferred, not implemented | S-22, S-23 | High |
| I-03 | Premium CRM is backend-complete but frontend-absent | route inspection + absence of components | High |
| I-04 | The 176 and 280 totals are double counts | suite identity comparison | High |
| I-05 | The historical "33/33 integration pass" is not corroborated by the current artifact | S-12 | Medium |

---

## 5. `TEST_VERIFIED` — none

No suite was executed in this audit.

`.env` sets `DATABASE_URL` to `...:5432/innowit_one`, which is the working application database. `server/tests/db-singleton.ts` does not override it. Both the Vitest suite and the integration runner create and delete rows, so executing them would mutate working data. The audit's data-safety constraint prohibits this.

| Suite | Executed | Exit code | Reason |
|---|---|---|---|
| `npm test` | No | — | Not re-run (safe to run; no DB dependency). Recommended follow-up |
| `npx tsx server/tests/integration.ts` | No | — | Writes to working database |
| `npx vitest run` | No | — | Writes to working database |

---

## 6. `LIVE_RUNTIME_OBSERVED` — none

No desktop application session, browser session, API request, or PostgreSQL query was executed against a running system during this audit. No screenshots were captured. No UI interaction was performed.

Therefore:

- No claim in this document rests on observed user-facing behaviour.
- No rendering of a React screen is treated as proof of server-backed data.
- No API endpoint is treated as proven by the existence of a route file alone; route existence is recorded as source inspection, and end-to-end usage remains `UNVERIFIED` where no test or runtime observation supports it.

---

## 7. `UNVERIFIED` claims carried from prior documents

| Claim | Source | Why unverified |
|---|---|---|
| "176/176 regression checks pass" | Exit Audit §1, §5 | Double count; no run in this audit |
| "280/280 total" | Test Report §11 | Double count; no run in this audit |
| "137/137 new Phase 3 vitest tests pass" | Exit Audit §5 | 137 is the whole run, not new tests; no run in this audit |
| Six performance timings (45ms, 180ms, 120ms, 15ms, 85ms, 350ms) | Test Report §8 | No benchmark script, fixtures or raw artifact |
| "4 migrations applied successfully" | Test Report §7.2, Exit Audit §1 | `prisma migrate status` timed out; no reachable DB |
| "Cargo check PASS" | Test Report §6.2 | Not re-run; no retained output in repo |

---

## 8. Limitations of this evidence set

1. Everything here is static. No execution, no runtime, no observation.
2. Route presence is not proof of working behaviour; only `SOURCE_INSPECTED` is claimed.
3. Migration **applied** status could not be confirmed because no database was reachable from the audit session.
4. The 189-check inventory describes what exists in the checkout, not what passes.
5. Absence of a premium UI component was established by searching `src/components` for the relevant identifiers; a component with an unexpected name cannot be fully excluded.

---

*Generated: 2026-11-23 · Audit of `7c35b39` on `work/innowit-one-build`*
