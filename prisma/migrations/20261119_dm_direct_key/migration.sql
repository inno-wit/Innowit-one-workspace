-- DM Direct Key Uniqueness Constraint
-- Generated: 2026-11-18
-- Purpose: Enforce database-level uniqueness for 1:1 DM conversations per organization
-- Baseline: Phase 2 closeout audit (commit 930091a)

-- ============================================================================
-- 1. ADD directKey COLUMN TO Conversation
-- ============================================================================

ALTER TABLE "Conversation" ADD COLUMN "directKey" TEXT;

-- ============================================================================
-- 2. CREATE PARTIAL UNIQUE INDEX FOR DIRECT CONVERSATIONS ONLY
-- ============================================================================
-- This ensures only DIRECT conversations get a directKey and enforces uniqueness
-- per organization + normalized participant pair.

CREATE UNIQUE INDEX "Conversation_directKey_key" ON "Conversation" ("directKey")
WHERE "type" = 'DIRECT' AND "directKey" IS NOT NULL;

-- ============================================================================
-- 3. BACKFILL directKey FOR EXISTING DIRECT CONVERSATIONS
-- ============================================================================
-- directKey format: orgId:participantAId:participantBId (sorted lexicographically)

UPDATE "Conversation" c
SET "directKey" = sub.direct_key
FROM (
  SELECT
    c.id,
    c."organizationId" || ':' ||
    LEAST(cp1."userId", cp2."userId") || ':' ||
    GREATEST(cp1."userId", cp2."userId") AS direct_key
  FROM "Conversation" c
  JOIN "ConversationParticipant" cp1 ON cp1."conversationId" = c.id
  JOIN "ConversationParticipant" cp2 ON cp2."conversationId" = c.id AND cp2."userId" != cp1."userId"
  WHERE c."type" = 'DIRECT'
    AND c."directKey" IS NULL
    AND cp1."leftAt" IS NULL
    AND cp2."leftAt" IS NULL
) sub
WHERE c.id = sub.id;

-- ============================================================================
-- 4. VERIFICATION QUERIES (for reference, not executed as part of migration)
-- ============================================================================
-- Verify all DIRECT conversations have directKey:
-- SELECT COUNT(*) FROM "Conversation" WHERE "type" = 'DIRECT' AND "directKey" IS NULL;
-- Expected: 0

-- Verify uniqueness:
-- SELECT "directKey", COUNT(*) FROM "Conversation" WHERE "type" = 'DIRECT' GROUP BY "directKey" HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- Verify no duplicate conversations for same participant pair in same org:
-- SELECT "organizationId", LEAST(cp1."userId", cp2."userId") as user_a, GREATEST(cp1."userId", cp2."userId") as user_b, COUNT(*)
-- FROM "Conversation" c
-- JOIN "ConversationParticipant" cp1 ON cp1."conversationId" = c.id
-- JOIN "ConversationParticipant" cp2 ON cp2."conversationId" = c.id AND cp2."userId" != cp1."userId"
-- WHERE c."type" = 'DIRECT' AND cp1."leftAt" IS NULL AND cp2."leftAt" IS NULL
-- GROUP BY "organizationId", user_a, user_b
-- HAVING COUNT(*) > 1;
-- Expected: 0 rows