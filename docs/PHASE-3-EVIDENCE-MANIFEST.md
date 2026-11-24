# PHASE 3 EVIDENCE MANIFEST

**Document Version:** 1.0.0
**Created:** 2026-11-23
**Status:** Authoritative deliverable list
**Audited HEAD:** `7c35b39aadcf79e79548059ece46f6e5bbbc7d1f`
**Branch:** `work/innowit-one-build`
**Documentation Commit:** _recorded in the follow-up commit_

---

## 0. Rule applied

A file is listed as `DELIVERED` only if it exists in the committed repository at the audited HEAD or was created by this reconciliation and committed. Nothing is listed as delivered on the strength of a prior claim alone.

---

## 1. Phase 3 documentation deliverables

| # | Path | Exists at HEAD | Status | Evidence source |
|---|---|---:|---|---|
| 1 | `docs/PHASE-3-BASELINE.md` | Yes | `DELIVERED` — retained, no correction required | `git ls-files docs/` |
| 2 | `docs/PHASE-3-ARCHITECTURE.md` | Yes | `DELIVERED` — realtime claim corrected | Source inspection of `RealtimeGateway.ts` |
| 3 | `docs/PHASE-3-DOMAIN-MODEL.md` | Yes | `DELIVERED` — model/enum counts corrected | Schema diff `b87ac48..HEAD` |
| 4 | `docs/PHASE-3-API-CONTRACT.md` | Yes | `DELIVERED` — route surface verified accurate | `server/routes/*.ts` |
| 5 | `docs/PHASE-3-PERMISSION-MATRIX.md` | Yes | `DELIVERED` — retained | `authorize(...)` guards in route files |
| 6 | `docs/PHASE-3-EVENT-CATALOG.md` | Yes | `DELIVERED` — relabelled as contract, not implementation | `RealtimeGateway.ts` emits no `crm.*` |
| 7 | `docs/PHASE-3-CRM-UI-MAP.md` | Yes | `DELIVERED` — §5 state model and realtime corrected | `store.ts`, `CrmView.tsx` |
| 8 | `docs/PHASE-3-IMPORT-EXPORT.md` | Yes | `DELIVERED` — backend-only status clarified | `crmPremium.ts`; no UI component found |
| 9 | `docs/PHASE-3-TEST-REPORT.md` | Yes | `DELIVERED` — totals, breakdown, benchmarks, artifacts corrected | `PHASE-3-TEST-ACCOUNTING.md` |
| 10 | `docs/PHASE-3-BACKLOG.md` | Yes | `DELIVERED` — status labels and counts reconciled | Release reconciliation §6, §7 |
| 11 | `docs/PHASE-3-EXIT-AUDIT.md` | Yes | `DELIVERED` — counts, models, P3.8/P3.9/P3.12, evidence list corrected | Release reconciliation §5–§12 |
| 12 | `docs/PHASE-3-REA-EVIDENCE.md` | **No — created by this audit** | `DELIVERED (new)` — replaces a previously claimed but absent document | `PHASE-3-REA-EVIDENCE.md` §0 |
| 13 | `docs/PHASE-3-RELEASE-RECONCILIATION.md` | **No — created by this audit** | `DELIVERED (new)` — canonical release record | This audit |
| 14 | `docs/PHASE-3-EVIDENCE-MANIFEST.md` | **No — created by this audit** | `DELIVERED (new)` — this file | This audit |
| 15 | `docs/PHASE-3-TEST-ACCOUNTING.md` | **No — created by this audit** | `DELIVERED (new)` — canonical test inventory | This audit |

---

## 2. Correction notice for item 12

`PHASE-3-EXIT-AUDIT.md` §4 previously listed `PHASE-3-REA-EVIDENCE.md` as a delivered document. At the audited HEAD the file **did not exist**. That claim was false.

It now exists because this reconciliation created it from verifiable source inspection only. It contains **zero** `LIVE_RUNTIME_OBSERVED` and **zero** `TEST_VERIFIED` findings, and says so explicitly. It does not retroactively validate the original false claim.

---

## 3. Product deliverables — verified by source inspection

These are code artifacts, not documents. They are listed to separate what exists from what was merely asserted.

| Deliverable | Path | Exists | Verified how |
|---|---|---:|---|
| CRM schema additions | `prisma/schema.prisma` | Yes | 11 models, 4 enums added vs `b87ac48` |
| Core CRM migration | `prisma/migrations/20261119_phase3_crm_domain/` | Yes | SQL read: 8 tables created |
| Automation migration | `prisma/migrations/20261119_phase3_automation_rules/` | Yes | SQL read: 2 tables created |
| Deal closedAt migration | `prisma/migrations/20261119_phase3_deal_closed_at/` | Yes | SQL read: 2 columns + index |
| QuotationItem migration | `prisma/migrations/20261119_phase3_quotation_items/` | Yes | SQL read: 1 table created |
| Customers API | `server/routes/customers.ts` | Yes | Route file read |
| Deals API | `server/routes/deals.ts` | Yes | Route file read |
| Tasks API | `server/routes/tasks.ts` | Yes | Route file read |
| Sales reps API | `server/routes/salesReps.ts` | Yes | Route file read |
| CRM analytics API | `server/routes/crmAnalytics.ts` | Yes | Route file read |
| CRM premium API | `server/routes/crmPremium.ts` | Yes | Route file read; `authorize()` guards present |
| CRM store | `src/modules/crm/store.ts` | Yes | `localStorage` key `innowit_crm_v3` |
| CRM view | `src/components/views/CrmView.tsx` | Yes | Server sync on mount; optimistic writes |
| Realtime gateway | `server/services/realtime/RealtimeGateway.ts` | Yes | Exists; emits no `crm.*` events |
| Socket client | `src/services/realtime/SocketClient.ts` | Yes | Exists; no CRM room subscription |

### 3.1 CRM test files — 8 files, 46 tests

| Path | Tests |
|---|---:|
| `server/tests/customers.integration.test.ts` | 12 |
| `server/tests/deals.integration.test.ts` | 9 |
| `server/tests/crm-tenant-security.integration.test.ts` | 7 |
| `server/tests/crm-analytics.integration.test.ts` | 4 |
| `server/tests/crm-premium.integration.test.ts` | 4 |
| `server/tests/sales-reps.integration.test.ts` | 4 |
| `server/tests/deal-stage-concurrency.integration.test.ts` | 3 |
| `server/tests/crm-quotation-order.integration.test.ts` | 3 |
| **Total** | **46** |

---

## 4. Deliverables explicitly NOT delivered

| Item | Status | Reason |
|---|---|---|
| Saved Views UI (FE-008) | `DEFERRED` | No component in `src/components` |
| Custom Fields UI (FE-009) | `DEFERRED` | No component in `src/components` |
| Import/Export UI (FE-010) | `DEFERRED` | No component in `src/components` |
| Import/Export API functional | `BROKEN` | `prisma.importJob` undefined; routes call non-existent model; dry-run returns mocks; zero tests |
| Workflow Builder UI (FE-011) | `DEFERRED` | No component in `src/components` |
| Sales Rep Performance View (FE-007) | `DEFERRED` | Dashboard KPI cards only; no dedicated view |
| CRM realtime (RT-001…RT-006) | `DEFERRED` | No `crm.*` events emitted; no CRM room subscription |
| Playwright E2E suite (TD-007) | `DEFERRED` | No config, no `e2e/`, no dependency |
| Performance benchmarks | `UNVERIFIED` | No script, fixtures or raw output |
| Applied-migration confirmation | `UNVERIFIED` | No reachable database during audit |

---

## 5. Historical artifacts retained

These are preserved, not rewritten. They are historical evidence, not current observations.

| Artifact | Status |
|---|---|
| `server/tests/integration-results.json` | Present but holds 1 failing result, not 33/33. Retained unmodified |
| `server/tests/integration-run.log` | Ignored by git (`*.log`); retained on disk |
| Commits `1ca7075`, `1658e6e`, `5578524`, `673ebaf` | Unmodified |
| Commits `32c48ec`, `f409ec0`, `88d6b1b`, `5580348`, `5a76335`, `05b59dc`, `dee3e3c`, `7c35b39` | Unmodified documentation commits |
| `docs/PHASE-3-docs.zip` | Untracked user-supplied archive; left untracked and unmodified |

No historical report was deleted. Where a prior number was wrong, it is quoted and corrected with an explicit note rather than silently replaced.

---

## 6. Release decision

`PHASE 3 RELEASE CONDITIONAL PASS`

See `docs/PHASE-3-RELEASE-RECONCILIATION.md` §14 for the full rationale and §13 for the nine open items (RC-01…RC-09) with owners and required actions.

---

## 7. Commit provenance

| Field | Value |
|---|---|
| Branch | `work/innowit-one-build` |
| Pre-audit HEAD | `7c35b39aadcf79e79548059ece46f6e5bbbc7d1f` |
| Documentation commit | `3e55458f5f4cedd806591d102ed3e775f2d17c0d` |
| Working tree after audit | Clean apart from untracked `docs/PHASE-3-docs.zip` |

---

*Generated: 2026-11-23 · Audit of `7c35b39` on `work/innowit-one-build`*
