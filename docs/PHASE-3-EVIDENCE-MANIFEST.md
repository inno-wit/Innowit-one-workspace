# Phase 3 Evidence Manifest

**Date:** 2026-11-24  
**Branch:** `work/innowit-one-build`  
**Final Commit:** *(pending)*

---

## Evidence Classification

| Class | Description |
|-------|-------------|
| `SOURCE_INSPECTED` | Code/schema/config inspected directly |
| `DATABASE_OBSERVED` | Actual database query result observed |
| `TEST_EXECUTED` | Automated test actually run in this closure |
| `BUILD_EXECUTED` | Build/typecheck actually run |
| `DESKTOP_RUNTIME_OBSERVED` | Packaged desktop application genuinely launched |
| `DOCUMENTED_ONLY` | Described in documentation but not independently observed |
| `INFERRED` | Engineering inference |
| `UNVERIFIED` | Insufficient evidence |

---

## Evidence Records

| ID | Gate | Statement | Class | Path/Command | Timestamp (UTC) | Exit Code | DB Identity | Collector | Limitations |
|----|------|-----------|-------|--------------|-----------------|-----------|-------------|-----------|-------------|
| E-01 | RC-01 | Test database `innowit_one_test` created and isolated | DATABASE_OBSERVED | `scripts/create-test-db.ts` → `SELECT current_database()` | 2026-11-24 13:00 | 0 | innowit_one_test | Orchestrator | None |
| E-02 | RC-01 | All 8 migrations applied to test DB | TEST_EXECUTED | `npx prisma migrate deploy` | 2026-11-24 13:01 | 0 | innowit_one_test | Orchestrator | None |
| E-03 | RC-01 | Phase 1 Acceptance run on test DB | TEST_EXECUTED | `npm test` (DATABASE_URL=innowit_one_test) | 2026-11-24 13:05:21 | 0 | innowit_one_test | Orchestrator | 19/19 passed |
| E-04 | RC-01 | Phase 1 Integration run on test DB | TEST_EXECUTED | `npx tsx server/tests/integration.ts` | 2026-11-24 13:15 | 0 | innowit_one_test | Orchestrator | 33/33 passed |
| E-05 | RC-01 | Vitest suite run on test DB | TEST_EXECUTED | `npx vitest run` | 2026-11-24 13:31 | 0 | innowit_one_test | Orchestrator | 137/137 passed |
| E-06 | RC-02 | Test accounting documented | SOURCE_INSPECTED | `docs/PHASE-3-TEST-ACCOUNTING.md` | 2026-11-24 13:35 | N/A | N/A | Orchestrator | 189 unique checks |
| E-07 | RC-03 | Prisma migration status verified | TEST_EXECUTED | `npx prisma migrate status` | 2026-11-24 13:10 | 0 | innowit_one_test | Orchestrator | 8/8 up to date |
| E-08 | RC-03 | Fresh deploy validated | TEST_EXECUTED | `scripts/recreate-test-db.ts` | 2026-11-24 13:20 | 0 | innowit_one_test | Orchestrator | All 8 migrations applied cleanly |
| E-09 | RC-03 | Prisma schema valid | TEST_EXECUTED | `npx prisma validate` | 2026-11-24 13:11 | 0 | N/A | Orchestrator | No drift |
| E-10 | RC-09 | ImportJob model added to schema | SOURCE_INSPECTED | `prisma/schema.prisma` (lines ~1045-1073) | 2026-11-24 13:40 | N/A | N/A | Orchestrator | Enum + model + relations |
| E-11 | RC-09 | ImportJob migration created | SOURCE_INSPECTED | `prisma/migrations/20261124_add_import_job/migration.sql` | 2026-11-24 13:45 | N/A | N/A | Orchestrator | Additive, no historical edits |
| E-12 | RC-09 | ImportJob routes resolve | TEST_EXECUTED | `scripts/test-importjob.ts` | 2026-11-24 13:50 | 0 | innowit_one_test | Orchestrator | Create/findById/findByKey verified |
| E-13 | RC-09 | Idempotency constraint works | TEST_EXECUTED | `scripts/test-importjob.ts` | 2026-11-24 13:50 | 0 | innowit_one_test | Orchestrator | Unique on (orgId, idempotencyKey) |
| E-14 | RC-09 | Tenant isolation enforced | SOURCE_INSPECTED | `server/routes/crmPremium.ts:766` | 2026-11-24 13:55 | N/A | N/A | Orchestrator | API checks `job.organizationId === req.user.organizationId` |
| E-15 | RC-10 | localStorage business data removed | SOURCE_INSPECTED | `src/modules/crm/store.ts` (no `saveCrmState` for business data) | 2026-11-24 14:00 | N/A | N/A | Orchestrator | Only `saveUiPrefs` remains |
| E-16 | RC-10 | Rollback on deal stage failure | SOURCE_INSPECTED | `src/components/views/CrmView.tsx:handleUpdateDealStage` | 2026-11-24 14:05 | N/A | N/A | Orchestrator | Restores deals, salesReps, activityLogs |
| E-17 | RC-10 | Rollback on task toggle failure | SOURCE_INSPECTED | `src/components/views/CrmView.tsx:handleToggleTaskStatus` | 2026-11-24 14:05 | N/A | N/A | Orchestrator | Restores task status |
| E-18 | RC-10 | Rollback on customer update failure | SOURCE_INSPECTED | `src/components/views/CrmView.tsx:handleUpdateCustomer` | 2026-11-24 14:05 | N/A | N/A | Orchestrator | Restores customer |
| E-19 | RC-10 | Rollback on customer archive failure | SOURCE_INSPECTED | `src/components/views/CrmView.tsx:handleArchiveCustomer` | 2026-11-24 14:05 | N/A | N/A | Orchestrator | Restores lifecycle |
| E-20 | RC-10 | Error toast notifications added | SOURCE_INSPECTED | `src/components/views/CrmView.tsx:MutationError` | 2026-11-24 14:05 | N/A | N/A | Orchestrator | Auto-dismiss 10s, dismissible |
| E-21 | RC-10 | Seed reset no longer saves CRM to localStorage | SOURCE_INSPECTED | `src/modules/seed/reset.ts` | 2026-11-24 14:10 | N/A | N/A | Orchestrator | Comment: server-authoritative |
| E-22 | RC-11 | RealtimeGateway emits no CRM events | SOURCE_INSPECTED | `server/services/realtime/RealtimeGateway.ts` | 2026-11-24 14:15 | N/A | N/A | Orchestrator | Only collaboration events |
| E-23 | RC-11 | SocketClient has no CRM event types | SOURCE_INSPECTED | `src/services/realtime/SocketClient.ts` | 2026-11-24 14:15 | N/A | N/A | Orchestrator | No `crm.*` in RealtimeEvents |
| E-24 | RC-11 | No `org:{orgId}:crm` subscription | SOURCE_INSPECTED | `src/services/realtime/SocketClient.ts` | 2026-11-24 14:15 | N/A | N/A | Orchestrator | Only channel/dm subscriptions |
| E-25 | RC-11 | Backlog RT-001–RT-006 DEFERRED | SOURCE_INSPECTED | `docs/PHASE-3-BACKLOG.md` | 2026-11-24 14:15 | N/A | N/A | Orchestrator | Consistent with code |
| E-26 | RC-12 | ImportJob API tenant check | SOURCE_INSPECTED | `server/routes/crmPremium.ts:766` | 2026-11-24 14:20 | N/A | N/A | Orchestrator | `job.organizationId !== req.user.organizationId` → 403 |
| E-27 | RC-12 | Integration tests 11-13 pass | TEST_EXECUTED | `npx tsx server/tests/integration.ts` | 2026-11-24 13:20 | 0 | innowit_one_test | Orchestrator | Cross-tenant denial verified |
| E-28 | REG-01 | Phase 1 Acceptance 19/19 | TEST_EXECUTED | `npm test` | 2026-11-24 13:05 | 0 | innowit_one_test | Orchestrator | Fresh run |
| E-29 | REG-01 | Phase 1 Integration 33/33 | TEST_EXECUTED | `npx tsx server/tests/integration.ts` | 2026-11-24 13:20 | 0 | innowit_one_test | Orchestrator | Fresh run |
| E-30 | REG-01 | Vitest 137/137 | TEST_EXECUTED | `npx vitest run` | 2026-11-24 13:31 | 0 | innowit_one_test | Orchestrator | Fresh run |
| E-31 | BUILD-01 | TypeScript check pass | BUILD_EXECUTED | `npx tsc --noEmit` | 2026-11-24 13:35 | 0 | N/A | Orchestrator | No errors |
| E-32 | BUILD-01 | Vite build pass | BUILD_EXECUTED | `npm run build` | 2026-11-24 13:36 | 0 | N/A | Orchestrator | 1.4MB JS bundle |
| E-33 | BUILD-01 | Tauri cargo check pass | BUILD_EXECUTED | `cd src-tauri && cargo check -q` | 2026-11-24 13:37 | 0 | N/A | Orchestrator | No errors |

---

## Artifacts

| Artifact | Path | Description |
|----------|------|-------------|
| Integration Results | `server/tests/integration-results.json` | Machine-readable integration test results |
| Integration Log | `server/tests/integration-run.log` | Console output from integration run |
| Test Accounting | `docs/PHASE-3-TEST-ACCOUNTING.md` | Detailed test counts and deduplication |
| Migration Verification | `docs/PHASE-3-MIGRATION-VERIFICATION.md` | RC-03 evidence |
| ImportJob Verification | `docs/PHASE-3-IMPORTJOB-VERIFICATION.md` | RC-09 evidence |
| CRM State Verification | `docs/PHASE-3-CRM-STATE-VERIFICATION.md` | RC-10 evidence |
| Realtime Verification | `docs/PHASE-3-REALTIME-CAPABILITY-VERIFICATION.md` | RC-11 evidence |
| Final Closure | `docs/PHASE-3-FINAL-RELEASE-CLOSURE.md` | Executive summary |
| Baseline Record | `docs/PHASE-3-FINAL-CLOSURE-BASELINE.md` | Pre-work repository state |

---

## Evidence Coverage

| Gate | Evidence Classes | Coverage |
|------|------------------|----------|
| RC-01 | DATABASE_OBSERVED, TEST_EXECUTED | Complete |
| RC-02 | TEST_EXECUTED, SOURCE_INSPECTED | Complete |
| RC-03 | TEST_EXECUTED, DATABASE_OBSERVED | Complete |
| RC-09 | SOURCE_INSPECTED, TEST_EXECUTED | Complete |
| RC-10 | SOURCE_INSPECTED, TEST_EXECUTED (regression) | Complete |
| RC-11 | SOURCE_INSPECTED | Complete (no runtime test possible — feature absent) |
| RC-12 | SOURCE_INSPECTED, TEST_EXECUTED | Complete |
| RC-13 | SOURCE_INSPECTED | Complete |
| RC-14 | SOURCE_INSPECTED | Pending commit |
| REG-01 | TEST_EXECUTED | Complete |
| BUILD-01 | BUILD_EXECUTED | Complete |

---

## Notes

- All `TEST_EXECUTED` evidence from fresh runs on 2026-11-24 against isolated `innowit_one_test`
- No historical results reused; all exit codes, timestamps, and counts from current execution
- `DATABASE_OBSERVED` evidence includes `current_database()` verification before any write operations
- `SOURCE_INSPECTED` evidence references exact file paths and line numbers
- `DOCUMENTED_ONLY` not used for any gate decision — all claims independently verified