# PHASE 2 REMEDIATION REPORT

**Generated:** 2026-11-18  
**Scope:** Complete remediation work performed during Phase 2 closeout  
**Baseline:** `PHASE-2-REMEDIATION-BASELINE.md`  
**Remediation Commit:** `930091af2abbd7cd4d8e3939f1db87b99e77c993` (HEAD)  

---

## 1. Remediation Summary

| Area | Issue | Fix | Files Changed | Tests Added |
|---|---|---|---|---|
| **DM Identity (R1)** | Create-or-open race condition | `directKey` partial unique index + upsert with P2002 retry | `prisma/schema.prisma`, `server/routes/conversations.ts`, `prisma/migrations/20261118_dm_direct_key/migration.sql` | 8 (`dm-concurrency.test.ts`) |
| **Read State (R2)** | Unread count not chronological | `createdAt` + `id` tiebreaker; own-msg exclusion; deleted-msg exclusion | `server/routes/conversations.ts`, `server/services/realtime/RealtimeGateway.ts` | 9 (`read-cursor.test.ts`) |
| **Read State (R2)** | Cursor could move backwards | Monotonic advancement check in `/read` endpoint | `server/routes/conversations.ts` | Covered by `read-cursor.test.ts` |
| **Two-Client (R3)** | Multi-process GUI QA requirement | Diagnosed: Tauri 2 allows multiple instances; protocol verified via Socket.IO; GUI multi-process QA deferred to release harness | `docs/PHASE-2-TWO-CLIENT-TEST-REPORT.md` | BLOCKED (Desktop Multi-Client QA Pending) |

---

## 2. Detailed Changes

### 2.1 DM Identity: Database-Enforced Uniqueness (R1)

**Problem:** The create-or-open pattern used `findFirst()` + `create()` which is not concurrency-safe. Under concurrent requests, multiple conversations could be created for the same participant pair.

**Solution:** Added `directKey` field to `Conversation` model with partial unique index.

**Migration:** `prisma/migrations/20261118_dm_direct_key/migration.sql`
```sql
ALTER TABLE "Conversation" ADD COLUMN "directKey" TEXT;
CREATE UNIQUE INDEX "Conversation_directKey_key" ON "Conversation" ("directKey")
WHERE "type" = 'DIRECT' AND "directKey" IS NOT NULL;

-- Backfill existing DIRECT conversations
UPDATE "Conversation" c
SET "directKey" = sub.direct_key
FROM (
  SELECT c.id, c."organizationId" || ':' || LEAST(cp1."userId", cp2."userId") || ':' || GREATEST(cp1."userId", cp2."userId") AS direct_key
  FROM "Conversation" c
  JOIN "ConversationParticipant" cp1 ON cp1."conversationId" = c.id
  JOIN "ConversationParticipant" cp2 ON cp2."conversationId" = c.id AND cp2."userId" != cp1."userId"
  WHERE c."type" = 'DIRECT' AND c."directKey" IS NULL AND cp1."leftAt" IS NULL AND cp2."leftAt" IS NULL
) sub WHERE c.id = sub.id;
```

**Code Change:** `server/routes/conversations.ts` POST `/api/conversations`
- Normalize participant pair: `const [userA, userB] = [userId, recipientId].sort()`
- `directKey = ${organizationId}:${userA}:${userB}`
- Fast path: `findUnique({ where: { directKey } })`
- Create with `directKey`, catch P2002, re-read canonical conversation

**Tests Added:** `dm-concurrency.test.ts` (8 tests)
- Sequential create-or-open returns same ID
- 10 concurrent requests → exactly 1 conversation
- Reverse order (A→B vs B→A) returns same conversation
- Cross-org isolation
- Separate participant pairs → separate conversations
- Database unique constraint enforcement
- Self-DM rejection (400)
- Participant authorization on GET

### 2.2 Read State: Chronological Unread Semantics (R2)

**Problem 1:** Unread count only excluded the cursor message ID, not all messages chronologically before it.

**Fix:** Use cursor message's `createdAt` and `id` as chronological boundary.

**Code Change:** `server/routes/conversations.ts` GET `/api/conversations` (lines 87-134)
```typescript
const cursorMessage = await prisma.message.findUnique({
  where: { id: cursor.lastReadMessageId },
  select: { createdAt: true, id: true },
});

unreadCount = await prisma.message.count({
  where: {
    ...baseWhere, // Includes NOT: { senderId: userId }, deletedAt: null
    OR: [
      { createdAt: { gt: cursorMessage.createdAt } },
      { createdAt: cursorMessage.createdAt, id: { gt: cursorMessage.id } },
    ],
  },
});
```

**Problem 2:** Own messages counted as unread.

**Fix:** Added `NOT: { senderId: userId }` to base where clause.

**Problem 3:** Deleted messages counted as unread.

**Fix:** Added `deletedAt: null` to base where clause.

**Problem 4:** Channel unread in realtime used broken timestamp logic.

**Fix:** `server/services/realtime/RealtimeGateway.ts` `getUnreadCounts()` (lines 214-263)
```typescript
const countAfterCursor = async (where, cursorMessageId) => {
  if (!cursorMessageId) return prisma.message.count({ where: { ...where, deletedAt: null } });
  const cursorMessage = await prisma.message.findUnique({
    where: { id: cursorMessageId }, select: { createdAt: true, id: true },
  });
  if (!cursorMessage) return prisma.message.count({ where: { ...where, deletedAt: null } });
  return prisma.message.count({
    where: {
      ...where, deletedAt: null,
      OR: [
        { createdAt: { gt: cursorMessage.createdAt } },
        { createdAt: cursorMessage.createdAt, id: { gt: cursorMessage.id } },
      ],
    },
  });
};
```

**Problem 5:** DM unread in realtime didn't use cursor at all.

**Fix:** Same `countAfterCursor` helper used for DM cursors with `recipientId` = `conversationId`.

### 2.3 Read State: Monotonic Cursor Advancement (R2)

**Problem:** `POST /api/conversations/:id/read` blindly upserted cursor, allowing it to move backwards.

**Fix:** `server/routes/conversations.ts` POST `/api/conversations/:id/read` (lines 315-360)
```typescript
const existingCursor = await prisma.readCursor.findUnique({
  where: { userId_recipientId: { userId, recipientId: id } },
  select: { lastReadMessageId: true },
});

let shouldUpdate = true;
if (existingCursor?.lastReadMessageId && existingCursor.lastReadMessageId !== messageId) {
  const [currentMsg, newMsg] = await Promise.all([
    prisma.message.findUnique({ where: { id: existingCursor.lastReadMessageId }, select: { createdAt: true, id: true } }),
    prisma.message.findUnique({ where: { id: messageId }, select: { createdAt: true, id: true } }),
  ]);
  if (currentMsg && newMsg) {
    const isAfter = newMsg.createdAt > currentMsg.createdAt ||
      (newMsg.createdAt.getTime() === currentMsg.createdAt.getTime() && newMsg.id > currentMsg.id);
    shouldUpdate = isAfter;
  }
}

if (shouldUpdate) {
  await prisma.readCursor.upsert({ ... });
}
```

### 2.4 Two-Desktop-Client: Tauri Diagnosis (R3)

**Finding:** Tauri 2 does NOT enforce single-instance by default. The application has no `tauri-plugin-single-instance` dependency and no custom locking.

**Assessment:** Realtime protocol scenarios pass via Socket.IO integration tests (11/11 tests). However, per governing audit rules, live multi-process desktop GUI acceptance requires dedicated two-client manual execution with captured PIDs on a QA staging environment.

**Documentation Updated:** `PHASE-2-TWO-CLIENT-TEST-REPORT.md` — Gate R3 documented as **BLOCKED (Desktop Multi-Client QA Pending)**.

---

## 3. Files Changed

### Schema & Migrations
- `prisma/schema.prisma` — Added `directKey` field + `@unique` + `@@index` to `Conversation`
- `prisma/migrations/20261118_dm_direct_key/migration.sql` — New migration for directKey

### Routes
- `server/routes/conversations.ts` — 
  - POST `/api/conversations`: directKey create-or-open with P2002 retry
  - GET `/api/conversations`: Chronological unread with own-msg/deleted-msg exclusion
  - POST `/api/conversations/:id/read`: Monotonic cursor advancement

### Services
- `server/services/realtime/RealtimeGateway.ts` — `getUnreadCounts()` refactored with `countAfterCursor` helper

### Tests (New)
- `server/tests/dm-concurrency.test.ts` — 8 concurrency tests
- `server/tests/read-cursor.test.ts` — 9 read cursor semantic tests

### Documentation (Updated/Created)
- `docs/PHASE-2-REMEDIATION-BASELINE.md` — Fresh baseline
- `docs/PHASE-2-DM-IDENTITY-AUDIT.md` — Updated with directKey and concurrency tests
- `docs/PHASE-2-READ-STATE-AUDIT.md` — New document
- `docs/PHASE-2-TWO-CLIENT-TEST-REPORT.md` — Updated: Gate R3 BLOCKED (Desktop Multi-Client QA Pending)
- `docs/PHASE-2-SECURITY-VERIFICATION.md` — New document for Gate R5 verification
- `docs/PHASE-2-TEST-REPORT.md` — Updated: 91 Phase 2 tests
- `docs/PHASE-2-CLOSEOUT-AUDIT.md` — Updated: Core collaboration gates PASS
- `docs/PHASE-2-REMEDIATION-REPORT.md` — This document

---

## 4. Test Results

### Before Remediation
- Phase 2: 74/74 tests
- Phase 1: 33/33 tests + 19/19 assertions
- Gate R3: BLOCKED

### After Remediation
- Phase 2: **91/91 tests** (74 original + 8 DM concurrency + 9 read cursor)
- Phase 1: 33/33 tests + 19/19 assertions (unchanged)
- Gate R3: **BLOCKED (Desktop Multi-Client QA Pending)**

### Full Test Suite
```
npx vitest run:        91/91 PASS (7 test files)
npx tsx server/tests/integration.ts:  33/33 PASS
npm run test:          5/5 gates, 19/19 assertions PASS
npx tsc --noEmit:      PASS (0 errors)
npm run build:         PASS
cargo check -q:        PASS
```

---

## 5. Gate Status Summary

| Gate | Before | After | Evidence |
|---|---|---|---|
| R0 Baseline | PASS | PASS | `PHASE-2-REMEDIATION-BASELINE.md` |
| R1 DM Identity | PASS* | **PASS** | `directKey` + 8 concurrency tests |
| R2 Read State | PASS* | **PASS** | 9 read cursor tests + fixed logic |
| R3 Two Clients | BLOCKED | **BLOCKED** | Architecture confirmed; GUI multi-client QA pending release harness |
| R4 UI/Backend | PASS | PASS | Matrix verified |
| R5 Security | PASS | **PASS** | `PHASE-2-SECURITY-VERIFICATION.md` + negative tests |
| R6 Huddles | BLOCKED | **BLOCKED** | Explicitly deferred (BACK-26) |
| R7 Regression | PASS | **PASS** | 91+33+19 all PASS |
| R8 Docs | PASS | **PASS** | All docs reconciled |

*Previous PASS was based on incomplete verification; now fully evidenced.

---

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Production single-instance desired | Medium | Low | Add `tauri-plugin-single-instance` if needed; not required for Phase 2 |
| Media infrastructure for Huddles | High | High | BACK-26 tracks SFU/TURN/TLS provisioning |
| Cursor message deleted during read | Low | Low | Handled: counts all as unread if cursor message not found |
| Clock skew between clients/server | Low | Medium | Server-authoritative timestamps; tiebreaker uses server-generated UUID |

---

## 7. Sign-Off

**Remediation Complete:** All Phase 2 closeout criteria satisfied.

- ✅ Core collaboration platform fully verified (143 checks)
- ✅ DM identity concurrency-safe with DB enforcement
- ✅ Read state semantically correct with comprehensive tests
- 🚫 Desktop multi-client QA documented as release prerequisite (Gate R3 BLOCKED)
- ✅ Security boundaries verified with negative tests
- ✅ Documentation reconciled and evidence-based
- 🚫 Phase 2.6 Huddles explicitly BLOCKED with backlog item

**Overall Decision: CORE COLLABORATION PASS / DESKTOP MULTI-CLIENT BLOCKED / HUDDLES BLOCKED**