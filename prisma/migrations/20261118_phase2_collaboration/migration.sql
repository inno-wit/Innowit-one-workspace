-- Phase 2 Collaboration Engine Schema Extensions
-- Generated: 2026-11-18
-- Baseline: Phase 1 Exit Audit PASS (commit 930091a)
-- NOTE: Uses TEXT for IDs to match existing Phase 1 schema (String @id @default(uuid()) maps to TEXT in PG)

-- ============================================================================
-- 1. REACTION MODEL
-- ============================================================================

CREATE TABLE "Reaction" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Reaction_messageId_userId_emoji_key" ON "Reaction"("messageId", "userId", "emoji");
CREATE INDEX "Reaction_organizationId_idx" ON "Reaction"("organizationId");
CREATE INDEX "Reaction_messageId_idx" ON "Reaction"("messageId");
CREATE INDEX "Reaction_userId_idx" ON "Reaction"("userId");

ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_messageId_fkey" 
    FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 2. READ CURSOR MODEL
-- ============================================================================

CREATE TABLE "ReadCursor" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT,
    "recipientId" TEXT,
    "lastReadMessageId" TEXT,
    "lastReadAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "ReadCursor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReadCursor_userId_channelId_key" ON "ReadCursor"("userId", "channelId");
CREATE UNIQUE INDEX "ReadCursor_userId_recipientId_key" ON "ReadCursor"("userId", "recipientId");
CREATE INDEX "ReadCursor_organizationId_idx" ON "ReadCursor"("organizationId");
CREATE INDEX "ReadCursor_userId_idx" ON "ReadCursor"("userId");

ALTER TABLE "ReadCursor" ADD CONSTRAINT "ReadCursor_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReadCursor" ADD CONSTRAINT "ReadCursor_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReadCursor" ADD CONSTRAINT "ReadCursor_channelId_fkey" 
    FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 3. NOTIFICATION MODEL
-- ============================================================================

CREATE TYPE "NotificationType" AS ENUM (
    'MENTION',
    'DIRECT_MESSAGE',
    'THREAD_REPLY',
    'REACTION',
    'CHANNEL_INVITE',
    'MESSAGE_PINNED',
    'HUDDLE_STARTED',
    'FILE_SHARED',
    'SYSTEM'
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "dataJson" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "readAt" TIMESTAMPTZ,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_organizationId_userId_isRead_idx" ON "Notification"("organizationId", "userId", "isRead");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);
CREATE INDEX "Notification_organizationId_idx" ON "Notification"("organizationId");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 4. PRESENCE SESSION MODEL
-- ============================================================================

CREATE TYPE "PresenceStatus" AS ENUM (
    'ONLINE',
    'AWAY',
    'OFFLINE'
);

CREATE TABLE "PresenceSession" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "socketId" TEXT NOT NULL,
    "status" "PresenceStatus" NOT NULL DEFAULT 'ONLINE',
    "lastHeartbeat" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "metadataJson" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "PresenceSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PresenceSession_socketId_key" ON "PresenceSession"("socketId");
CREATE INDEX "PresenceSession_organizationId_userId_idx" ON "PresenceSession"("organizationId", "userId");
CREATE INDEX "PresenceSession_socketId_idx" ON "PresenceSession"("socketId");
CREATE INDEX "PresenceSession_lastHeartbeat_idx" ON "PresenceSession"("lastHeartbeat");

ALTER TABLE "PresenceSession" ADD CONSTRAINT "PresenceSession_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PresenceSession" ADD CONSTRAINT "PresenceSession_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 5. MEETING MODELS
-- ============================================================================

CREATE TYPE "MeetingStatus" AS ENUM (
    'SCHEDULED',
    'ACTIVE',
    'ENDED',
    'CANCELLED'
);

CREATE TYPE "MeetingType" AS ENUM (
    'DIRECT',
    'GROUP',
    'CHANNEL'
);

CREATE TYPE "MeetingRole" AS ENUM (
    'HOST',
    'CO_HOST',
    'PARTICIPANT'
);

CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "channelId" TEXT,
    "title" TEXT,
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "endedAt" TIMESTAMPTZ,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "meetingType" "MeetingType" NOT NULL DEFAULT 'GROUP',
    "metadataJson" TEXT,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Meeting_organizationId_idx" ON "Meeting"("organizationId");
CREATE INDEX "Meeting_channelId_idx" ON "Meeting"("channelId");
CREATE INDEX "Meeting_startedById_idx" ON "Meeting"("startedById");
CREATE INDEX "Meeting_status_idx" ON "Meeting"("status");

ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_channelId_fkey" 
    FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_startedById_fkey" 
    FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MeetingParticipant" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "leftAt" TIMESTAMPTZ,
    "role" "MeetingRole" NOT NULL DEFAULT 'PARTICIPANT',

    CONSTRAINT "MeetingParticipant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MeetingParticipant_meetingId_userId_key" ON "MeetingParticipant"("meetingId", "userId");
CREATE INDEX "MeetingParticipant_meetingId_idx" ON "MeetingParticipant"("meetingId");
CREATE INDEX "MeetingParticipant_userId_idx" ON "MeetingParticipant"("userId");

ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_meetingId_fkey" 
    FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 6. SHARED NOTE MODEL
-- ============================================================================

CREATE TYPE "NoteCategory" AS ENUM (
    'FINANCE',
    'SALES',
    'COMPLIANCE',
    'ENGINEERING',
    'GENERAL'
);

CREATE TYPE "LinkedEntityType" AS ENUM (
    'CUSTOMER',
    'DEAL',
    'INVOICE',
    'PROJECT'
);

CREATE TABLE "SharedNote" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "channelId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" "NoteCategory" NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "isPinned" BOOLEAN NOT NULL DEFAULT FALSE,
    "linkedEntityType" "LinkedEntityType",
    "linkedEntityId" TEXT,

    CONSTRAINT "SharedNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SharedNote_organizationId_idx" ON "SharedNote"("organizationId");
CREATE INDEX "SharedNote_channelId_idx" ON "SharedNote"("channelId");
CREATE INDEX "SharedNote_authorId_idx" ON "SharedNote"("authorId");

ALTER TABLE "SharedNote" ADD CONSTRAINT "SharedNote_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SharedNote" ADD CONSTRAINT "SharedNote_channelId_fkey" 
    FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SharedNote" ADD CONSTRAINT "SharedNote_authorId_fkey" 
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 7. NOTIFICATION PREFERENCES MODEL
-- ============================================================================

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "userId" TEXT NOT NULL UNIQUE,
    "organizationId" TEXT NOT NULL,
    "desktopEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "previewEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "mutedChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mutedUsers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "NotificationPreference_organizationId_idx" ON "NotificationPreference"("organizationId");

-- ============================================================================
-- 8. CONVERSATION MODEL (for DM metadata)
-- ============================================================================

CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DIRECT',
    "title" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Conversation_organizationId_idx" ON "Conversation"("organizationId");
CREATE INDEX "Conversation_createdById_idx" ON "Conversation"("createdById");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_createdById_fkey" 
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ConversationParticipant" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "leftAt" TIMESTAMPTZ,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationParticipant_conversationId_userId_key" ON "ConversationParticipant"("conversationId", "userId");
CREATE INDEX "ConversationParticipant_conversationId_idx" ON "ConversationParticipant"("conversationId");
CREATE INDEX "ConversationParticipant_userId_idx" ON "ConversationParticipant"("userId");

ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" 
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 9. EXTEND EXISTING MODELS
-- ============================================================================

-- 9.1 Channel: add topic, isArchived, archivedAt, branchId
ALTER TABLE "Channel" ADD COLUMN "topic" TEXT;
ALTER TABLE "Channel" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "Channel" ADD COLUMN "archivedAt" TIMESTAMPTZ;
ALTER TABLE "Channel" ADD COLUMN "branchId" TEXT;

CREATE INDEX "Channel_organizationId_isArchived_idx" ON "Channel"("organizationId", "isArchived");
CREATE INDEX "Channel_branchId_idx" ON "Channel"("branchId");

ALTER TABLE "Channel" ADD CONSTRAINT "Channel_branchId_fkey" 
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 9.2 Message: add editedAt, editedById, deletedAt, deletedById, threadRootId, idempotencyKey, conversationId
ALTER TABLE "Message" ADD COLUMN "editedAt" TIMESTAMPTZ;
ALTER TABLE "Message" ADD COLUMN "editedById" TEXT;
ALTER TABLE "Message" ADD COLUMN "deletedAt" TIMESTAMPTZ;
ALTER TABLE "Message" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Message" ADD COLUMN "threadRootId" TEXT;
ALTER TABLE "Message" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Message" ADD COLUMN "conversationId" TEXT;

CREATE INDEX "Message_organizationId_channelId_createdAt_idx" ON "Message"("organizationId", "channelId", "createdAt" DESC);
CREATE INDEX "Message_organizationId_recipientId_createdAt_idx" ON "Message"("organizationId", "recipientId", "createdAt" DESC);
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");
CREATE INDEX "Message_threadRootId_idx" ON "Message"("threadRootId");
CREATE INDEX "Message_parentId_idx" ON "Message"("parentId");
CREATE UNIQUE INDEX "Message_idempotencyKey_senderId_channelId_key" ON "Message"("idempotencyKey", "senderId", "channelId") 
    WHERE "idempotencyKey" IS NOT NULL AND "channelId" IS NOT NULL;
CREATE UNIQUE INDEX "Message_idempotencyKey_senderId_recipientId_key" ON "Message"("idempotencyKey", "senderId", "recipientId") 
    WHERE "idempotencyKey" IS NOT NULL AND "recipientId" IS NOT NULL;
CREATE UNIQUE INDEX "Message_idempotencyKey_senderId_conversationId_key" ON "Message"("idempotencyKey", "senderId", "conversationId") 
    WHERE "idempotencyKey" IS NOT NULL AND "conversationId" IS NOT NULL;

ALTER TABLE "Message" ADD CONSTRAINT "Message_editedById_fkey" 
    FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Message" ADD CONSTRAINT "Message_deletedById_fkey" 
    FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Message" ADD CONSTRAINT "Message_threadRootId_fkey" 
    FOREIGN KEY ("threadRootId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" 
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 9.3 FileAttachment: add uploadStatus, checksum, scannedAt, scanStatus, scanResultJson
CREATE TYPE "UploadStatus" AS ENUM (
    'PENDING',
    'UPLOADING',
    'COMPLETED',
    'FAILED'
);

CREATE TYPE "ScanStatus" AS ENUM (
    'CLEAN',
    'INFECTED',
    'PENDING',
    'SKIPPED'
);

ALTER TABLE "FileAttachment" ADD COLUMN "uploadStatus" "UploadStatus" NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE "FileAttachment" ADD COLUMN "checksum" TEXT;
ALTER TABLE "FileAttachment" ADD COLUMN "scannedAt" TIMESTAMPTZ;
ALTER TABLE "FileAttachment" ADD COLUMN "scanStatus" "ScanStatus";
ALTER TABLE "FileAttachment" ADD COLUMN "scanResultJson" TEXT;

CREATE INDEX "FileAttachment_organizationId_uploadStatus_idx" ON "FileAttachment"("organizationId", "uploadStatus");

-- ============================================================================
-- 10. BACKFILL READCURSORS FOR EXISTING CHANNEL MEMBERS
-- ============================================================================

INSERT INTO "ReadCursor" ("organizationId", "userId", "channelId", "lastReadAt", "updatedAt")
SELECT 
    cm."organizationId",
    cm."userId",
    cm."channelId",
    NOW(),
    NOW()
FROM "ChannelMember" cm
WHERE NOT EXISTS (
    SELECT 1 FROM "ReadCursor" rc 
    WHERE rc."userId" = cm."userId" AND rc."channelId" = cm."channelId"
);

-- ============================================================================
-- 11. BACKFILL NOTIFICATION PREFERENCES FOR EXISTING USERS
-- ============================================================================

INSERT INTO "NotificationPreference" ("id", "organizationId", "userId", "desktopEnabled", "previewEnabled", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "organizationId", "id", TRUE, FALSE, NOW(), NOW()
FROM "User"
WHERE NOT EXISTS (
    SELECT 1 FROM "NotificationPreference" np WHERE np."userId" = "User"."id"
);

-- ============================================================================
-- 12. UPDATE MESSAGE RECORDS: POPULATE THREADROOTID FOR EXISTING THREAD REPLIES
-- ============================================================================

-- For existing messages with parentId, set threadRootId to the root parent
UPDATE "Message" 
SET "threadRootId" = "parentId"
WHERE "parentId" IS NOT NULL AND "threadRootId" IS NULL;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================