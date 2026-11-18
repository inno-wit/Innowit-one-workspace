# PHASE 2 REMEDIATION BASELINE

**Generated:** 2026-11-18  
**Orchestrator:** Principal Engineering Orchestrator  
**Purpose:** Establish verified baseline before remediation work begins  

---

## 1. Git Baseline

| Property | Value |
|---|---|
| **Branch** | `work/innowit-one-build` |
| **Current HEAD** | `930091af2abbd7cd4d8e3939f1db87b99e77c993` |
| **Reported Milestone Commit** | `930091af2abbd7cd4d8e3939f1db87b99e77c993` ✓ Verified |
| **Working Tree Changes** | Modified: `package-lock.json`, `package.json`, `prisma/schema.prisma`, `server/index.ts`, `server/middleware/tenant.ts`, `server/routes/channels.ts`, `server/routes/messages.ts`, `src-tauri/capabilities/default.json`, `src-tauri/src/lib.rs`, `src/components/collaboration/MessageComposer.tsx`, `tsconfig.json` |
| **Untracked Files** | Phase 2 docs, new routes/services/tests, uploads, vitest.config.ts |

---

## 2. Environment Versions

| Tool | Version |
|---|---|
| Node.js | v26.13.0 |
| npm | 11.20.0 |
| Rust | 1.100.0 |
| Cargo | 1.100.0 |
| Tauri CLI | 2.12.5 |
| Prisma | 5.22.0 |
| @prisma/client | 5.22.0 |
| TypeScript | 7.0.2 |
| Vite | 8.3.8 |
| Vitest | 5.1.1 |
| PostgreSQL | Not in PATH (remote/local instance assumed) |

---

## 3. Phase 2 Source Inventory

### 3.1 Prisma Schema & Migrations
- `prisma/schema.prisma` — 1161 lines, includes all Phase 2 models
- `prisma/migrations/0_init/migration.sql` — Phase 1 baseline
- `prisma/migrations/20261118_phase2_collaboration/migration.sql` — Phase 2 collaboration extensions (448 lines)

### 3.2 New Phase 2 Routes
- `server/routes/conversations.ts` — DM conversation CRUD + create-or-open
- `server/routes/attachments.ts` — File attachment upload/complete/download
- `server/routes/meetings.ts` — Meeting lifecycle (metadata only, SFU BLOCKED)
- `server/routes/notifications.ts` — Notification feeds, preferences, read state

### 3.3 New Phase 2 Services
- `server/services/collaboration/CollaborationService.ts` — Core channel/DM/message logic
- `server/services/collaboration/NotificationService.ts` — Notification triggers and preferences
- `server/services/collaboration/AttachmentService.ts` — File validation, storage, signed URLs
- `server/services/realtime/RealtimeGateway.ts` — Socket.IO gateway with auth, rooms, presence

### 3.4 Test Suites (Phase 2)
- `server/tests/channels.integration.test.ts` — 24 tests
- `server/tests/messages.integration.test.ts` — 23 tests
- `server/tests/realtime.integration.test.ts` — 11 tests
- `server/tests/notifications.integration.test.ts` — 9 tests
- `server/tests/attachments.integration.test.ts` — 7 tests
- **Total: 74 Phase 2 integration tests**

### 3.5 Test Infrastructure
- `server/tests/db-singleton.ts` — Global Prisma singleton + test data seeding
- `server/tests/test-db.ts` — Test utilities, token generation
- `vitest.config.ts` — Sequential file execution, 60s timeouts

### 3.6 Documentation (Existing)
- `docs/PHASE-2-ARCHITECTURE.md`
- `docs/PHASE-2-REA-EVIDENCE.md`
- `docs/PHASE-2-BACKLOG.md`
- `docs/PHASE-2-CLOSEOUT-AUDIT.md`
- `docs/PHASE-2-DM-IDENTITY-AUDIT.md`
- `docs/PHASE-2-EXIT-AUDIT.md`
- `docs/PHASE-2-TEST-REPORT.md`
- `docs/PHASE-2-TWO-CLIENT-TEST-REPORT.md`
- `docs/PHASE-2-UI-BACKEND-MATRIX.md`
- `docs/PHASE-2-API-CONTRACT.md`
- `docs/PHASE-2-REALTIME-EVENTS.md`
- `docs/PHASE-2-SECURITY-MODEL.md`
- `docs/PHASE-2-OPERATIONS.md`

---

## 4. Baseline Test Execution (Fresh Runs)

### 4.1 Phase 1 Acceptance Gates (`npm test`)
```
Timestamp: 2026-11-18 19:22:26
Total Gates: 5 (5 Passed, 0 Failed)
Total Assertions: 19 (19 Passed, 0 Failed)
Total Duration: 2630.6 ms
★ ACCEPTANCE VERIFICATION: ALL 5 MANDATORY ACCEPTANCE GATES PASSED [100%]
```

### 4.2 Phase 1 Integration Tests (`npx tsx server/tests/integration.ts`)
```
Total: 33 | Passed: 33 | Failed: 0
Categories: AUTH (6), RBAC (4), TENANT (3), ACCOUNTING (9), INVENTORY (6), ETIMS (5)
```

### 4.3 Phase 2 Integration Tests (`npx vitest run`)
```
Test Files: 5 passed (5)
Tests: 74 passed (74)
Duration: 8.41s
- channels.integration.test.ts: 24 tests
- messages.integration.test.ts: 23 tests
- realtime.integration.test.ts: 11 tests
- notifications.integration.test.ts: 9 tests
- attachments.integration.test.ts: 7 tests
```

### 4.4 TypeScript Check (`npx tsc --noEmit`)
```
PASS — 0 errors
```

### 4.5 Vite Production Build (`npm run build`)
```
PASS — built in 7.13s
dist/index.html: 1.32 kB
dist/assets/index-uOtvoBZi.js: 1,381.30 kB (gzip: 297.97 kB)
dist/assets/index--OzPgbLP.css: 54.88 kB (gzip: 10.52 kB)
```

### 4.6 Cargo Check (`cargo check -q` in `src-tauri`)
```
PASS — 0 errors
```

---

## 5. Baseline Test Inventory Reconciliation

### 5.1 Reported vs Actual Counts

| Source | Reported Phase 2 Tests | Actual Phase 2 Tests | Delta |
|---|---|---|---|
| Earlier Implementation Report | 79 (23 ch, 23 msg, 18 rt, 8 notif, 7 att) | — | — |
| Latest Closeout Report | 74 (24 ch, 23 msg, 11 rt, 9 notif, 7 att) | 74 | 0 |
| **Fresh Run (This Baseline)** | — | **74** | **0** |

**Breakdown by Suite (Actual):**
| Suite | Tests | Historical (Closeout) | Match |
|---|---|---|---|
| channels.integration.test.ts | 24 | 24 | ✓ |
| messages.integration.test.ts | 23 | 23 | ✓ |
| realtime.integration.test.ts | 11 | 11 | ✓ |
| notifications.integration.test.ts | 9 | 9 | ✓ |
| attachments.integration.test.ts | 7 | 7 | ✓ |
| **Total** | **74** | **74** | ✓ |

**Phase 1:**
- Integration tests: 33 (matches reported)
- Acceptance assertions: 19 across 5 gates (matches reported)

**Combined:** 107 integration tests + 19 acceptance assertions = 126 verified checks

---

## 6. Database Baseline

- **Database URL:** `postgresql://postgres:postgres@localhost:5432/innowit_one?schema=public` (from env)
- **Test Organizations:** `A001234567A` (Org A), `B001234567B` (Org B)
- **Test Users:** admin@orga.com, member@orga.com, admin@orgb.com, finance@orga.com
- **Fixture Channels:** `fixture-test-channel`, `fixture-other-channel` (persist across test runs)
- **Migrations Applied:** `0_init`, `20261118_phase2_collaboration`

---

## 7. Key Architectural Findings (Pre-Remediation)

### 7.1 DM Identity (Gate R1 — Critical)
- `Conversation` model exists with `type: "DIRECT" | "GROUP"`
- `ConversationParticipant` with `joinedAt`/`leftAt` lifecycle
- Create-or-open uses `findFirst` + `create` pattern (NOT concurrency-safe at DB level)
- No `directKey` unique constraint on `(organizationId, sorted participant pair)`
- `recipientId` on `Message` remains as legacy/compatibility field
- `ReadCursor` uses `recipientId` = `conversationId` for DMs (nullable unique key)

### 7.2 Read Cursors (Gate R2 — Critical)
- `ReadCursor` model has `@@unique([userId, channelId])` and `@@unique([userId, recipientId])`
- DM cursor uses `recipientId` = `conversationId`
- Unread count calculation in `conversations.ts` uses `id: { not: cursor.lastReadMessageId }` — **excludes only cursor message, not chronological**
- Real-time `getUnreadCounts` uses simplified timestamp comparison (not message ID ordering)

### 7.3 Tauri Single-Instance (Gate R3 — Blocked)
- `tauri.conf.json`: No `tauri-plugin-single-instance` dependency
- `Cargo.toml`: No `tauri-plugin-single-instance` in dependencies
- `src-tauri/src/lib.rs`: No single-instance plugin initialization
- Windows default behavior: second launch focuses existing window
- No QA build profile with distinct app identifier configured

### 7.4 UI Source of Truth (Gate R4)
- All collaboration views trace to REST/Socket.IO → Prisma → PostgreSQL
- No `localStorage`/`sessionStorage`/`indexedDB` for durable collaboration state
- Error/offline states explicit with retry paths

### 7.5 Security (Gate R5)
- Socket.IO middleware validates JWT, user existence, org match, active status
- Room names derived server-side (`channel:{id}`, `dm:{conversationId}`, `meeting:{id}`)
- Membership rechecked on subscribe, sendMessage, typing
- Attachment validation includes magic bytes, size limits, opaque keys

---

## 8. Deliverables Preserved

All historical test logs and evidence documents preserved. Fresh results captured in this baseline document.

---

## 9. Next Steps

Proceed to Gate R1: DM Identity, Uniqueness and Concurrency Audit.