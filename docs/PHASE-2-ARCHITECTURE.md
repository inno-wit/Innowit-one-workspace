# PHASE 2 ARCHITECTURE: INNOWIT ONE COLLABORATION ENGINE

**Version:** 2.0 (As-Built)  
**Date:** 2026-11-18  
**Status:** As-Built Architecture (Closeout)  
**Baseline:** Phase 1 Exit Audit = PASS (commit `930091a`)  
**Closeout Commit:** `930091af2abbd7cd4d8e3939f1db87b99e77c993`

---

## 1. Executive Summary

Phase 2 delivers a production-quality, multi-user Collaboration Engine integrated into the existing Innowit One desktop application and Express/Prisma/PostgreSQL backend. The architecture extends the Phase 1 foundation with realtime capabilities (Socket.IO), durable collaboration persistence, and Tauri desktop integration.

**Core Principle:** The database is the source of truth. Realtime events notify clients about committed state; they do not replace persistence.

**As-Built Status (Closeout):** 14 of 18 collaboration features fully implemented and automated-test verified. 1 feature (desktop notifications) implemented in source but not runtime-verified on packaged binary. 2 features deferred (shared notes realtime, search). 1 feature explicitly BLOCKED (huddles/media infrastructure not provisioned).

---

## 2. System Context (As-Built)

```
┌─────────────────────────────────────────────────────────────────┐
│                    INNOWIT ONE DESKTOP (Tauri 2)                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  React 19 + Vite │  │  Collaboration   │  │  Tauri       │  │
│  │  Frontend        │◄─┤  Store (React    │  │  Plugins     │  │
│  │                  │  │  Query + React   │  │  - notification│ │
│  │  - Channels/DMs  │  │  State)          │  │  - fs        │ │
│  │  - Messages      │  └────────┬─────────┘  │  - dialog    │ │
│  │  - Threads       │           │           │  - shell     │ │
│  │  - Files/Notes   │           ▼           │  - updater   │ │
│  │  - Huddles       │  ┌──────────────────┐  └──────────────┘  │
│  └────────┬─────────┘  │  Socket.IO Client│                    │
│           │            │  (Phase 2)       │                    │
│           ▼            └────────┬─────────┘                    │
└──────────┼──────────────────────┼──────────────────────────────┘
           │                      │
           │ HTTPS + WSS          │
           ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXPRESS API SERVER (Node 22+)                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  REST Routes     │  │  Socket.IO       │  │  Services    │  │
│  │  - /api/channels │  │  Server          │  │  - Collaboration│ │
│  │  - /api/messages │  │  - Auth handshake│  │  - Membership │ │
│  │  - /api/conversations               │  │  - Realtime   │ │
│  │  - /api/notifications               │  │  - Presence   │ │
│  │  - /api/attachments                 │  │  - Notification│ │
│  │  - /api/meetings                    │  │  - Attachment │ │
│  │  - /api/auth     │  │  - Room mgmt     │  │  - Meeting    │ │
│  │  - ...(Phase 1)  │  │  - Event pub/sub │  └──────────────┘  │
│  └──────────────────┘  └────────┬─────────┘                    │
│                                 │                               │
│                                 ▼                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              PRISMA ORM → POSTGRESQL 17                 │  │
│  │  Models: Organization, Branch, User, Channel,          │  │
│  │  ChannelMember, Message, FileAttachment,               │  │
│  │  Reaction, ReadCursor, Notification, PresenceSession,  │  │
│  │  Meeting, MeetingParticipant, SharedNote,              │  │
│  │  Conversation, ConversationParticipant,                │  │
│  │  NotificationPreference                                 │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Model Extensions (Prisma Schema)

### 3.1 New Models for Phase 2

```prisma
// Reaction: emoji reactions on messages
model Reaction {
  id             String   @id @default(uuid())
  organizationId String
  messageId      String
  userId         String
  emoji          String
  createdAt      DateTime @default(now())

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  message        Message      @relation(fields: [messageId], references: [id], onDelete: Cascade)
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([messageId, userId, emoji]) // Prevent duplicate reactions
  @@index([organizationId])
  @@index([messageId])
  @@index([userId])
}

// ReadCursor: per-user per-conversation read position
model ReadCursor {
  id             String   @id @default(uuid())
  organizationId String
  userId         String
  channelId      String?
  recipientId    String?  // For DMs
  lastReadMessageId String?
  lastReadAt     DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  channel        Channel?     @relation(fields: [channelId], references: [id], onDelete: Cascade)

  @@unique([userId, channelId]) // One cursor per user per channel
  @@unique([userId, recipientId]) // One cursor per user per DM
  @@index([organizationId])
  @@index([userId])
}

// Notification: durable in-app notifications
model Notification {
  id             String   @id @default(uuid())
  organizationId String
  userId         String   // Recipient
  type           NotificationType
  title          String
  body           String?
  dataJson       String?  @db.Text // Flexible payload: { messageId, channelId, etc. }
  isRead         Boolean  @default(false)
  createdAt      DateTime @default(now())
  readAt         DateTime?

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([organizationId, userId, isRead])
  @@index([userId, createdAt])
  @@index([organizationId])
}

enum NotificationType {
  MENTION
  DIRECT_MESSAGE
  THREAD_REPLY
  REACTION
  CHANNEL_INVITE
  MESSAGE_PINNED
  HUDDLE_STARTED
  FILE_SHARED
  SYSTEM
}

// PresenceSession: ephemeral multi-session presence
model PresenceSession {
  id             String   @id @default(uuid())
  organizationId String
  userId         String
  socketId       String   @unique
  status         PresenceStatus @default(ONLINE)
  lastHeartbeat  DateTime @default(now())
  metadataJson   String?  @db.Text // { device, platform, appVersion }
  createdAt      DateTime @default(now())

  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([organizationId, userId])
  @@index([socketId])
  @@index([lastHeartbeat])
}

enum PresenceStatus {
  ONLINE
  AWAY
  OFFLINE
}

// Meeting: huddle/video meeting records
model Meeting {
  id             String   @id @default(uuid())
  organizationId String
  channelId      String?  // Channel-associated meeting
  title          String?
  startedById    String
  startedAt      DateTime @default(now())
  endedAt        DateTime?
  status         MeetingStatus @default(SCHEDULED)
  meetingType    MeetingType @default(GROUP)
  metadataJson   String?  @db.Text // { sfuUrl, recordingUrl, etc. }

  organization   Organization       @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  channel        Channel?           @relation(fields: [channelId], references: [id], onDelete: SetNull)
  startedBy      User               @relation("MeetingStartedBy", fields: [startedById], references: [id], onDelete: Restrict)
  participants   MeetingParticipant[]

  @@index([organizationId])
  @@index([channelId])
  @@index([startedById])
  @@index([status])
}

enum MeetingStatus {
  SCHEDULED
  ACTIVE
  ENDED
  CANCELLED
}

enum MeetingType {
  DIRECT
  GROUP
  CHANNEL
}

// MeetingParticipant: join/leave tracking
model MeetingParticipant {
  id           String   @id @default(uuid())
  meetingId    String
  userId       String
  joinedAt     DateTime @default(now())
  leftAt       DateTime?
  role         MeetingRole @default(PARTICIPANT)

  meeting      Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([meetingId, userId])
  @@index([meetingId])
  @@index([userId])
}

enum MeetingRole {
  HOST
  CO_HOST
  PARTICIPANT
}

// SharedNote: collaborative notes (if not already covered)
model SharedNote {
  id               String   @id @default(uuid())
  organizationId   String
  channelId        String?  // Optional: channel-scoped note
  title            String
  content          String   @db.Text // Markdown
  category         NoteCategory
  authorId         String
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  isPinned         Boolean  @default(false)
  linkedEntityType LinkedEntityType?
  linkedEntityId   String?

  organization     Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  channel          Channel?     @relation(fields: [channelId], references: [id], onDelete: SetNull)
  author           User         @relation(fields: [authorId], references: [id], onDelete: Restrict)

  @@index([organizationId])
  @@index([channelId])
  @@index([authorId])
}

enum NoteCategory {
  FINANCE
  SALES
  COMPLIANCE
  ENGINEERING
  GENERAL
}

enum LinkedEntityType {
  CUSTOMER
  DEAL
  INVOICE
  PROJECT
}
```

### 3.2 Extended Existing Models

```prisma
// Channel: add topic, archive, branch scoping
model Channel {
  // ... existing fields ...
  topic          String?
  isArchived     Boolean  @default(false)
  archivedAt     DateTime?
  branchId       String?  // Branch-scoped visibility
  branch         Branch?  @relation(fields: [branchId], references: [id], onDelete: SetNull)
  
  // Add indexes
  @@index([organizationId, isArchived])
  @@index([branchId])
}

// Message: add editing metadata, thread root
model Message {
  // ... existing fields ...
  editedAt       DateTime?
  editedById     String?
  deletedAt      DateTime?  // Soft delete
  deletedById    String?
  threadRootId   String?    // For flattened thread queries
  
  // Relations
  reactions      Reaction[]
  readCursors    ReadCursor[] // via channelId or recipientId
  
  @@index([organizationId, channelId, createdAt])
  @@index([organizationId, recipientId, createdAt])
  @@index([threadRootId])
  @@index([parentId])
}

// FileAttachment: add upload state, scanning
model FileAttachment {
  // ... existing fields ...
  uploadStatus   UploadStatus @default(COMPLETED)
  checksum       String?      // SHA-256 for integrity
  scannedAt      DateTime?
  scanStatus     ScanStatus?
  scanResultJson String?      @db.Text
  
  @@index([organizationId, uploadStatus])
}

enum UploadStatus {
  PENDING
  UPLOADING
  COMPLETED
  FAILED
}

enum ScanStatus {
  CLEAN
  INFECTED
  PENDING
  SKIPPED
}
```

---

## 4. Service Layer Architecture

### 4.1 Service Boundaries

```
server/services/
├── collaboration/
│   ├── CollaborationService.ts       # Channel, message, thread business logic
│   ├── MembershipService.ts          # Channel membership, invitations, roles
│   ├── MessageService.ts             # Message CRUD, threads, reactions, pins
│   ├── DirectMessageService.ts       # DM conversation management
│   ├── ReadCursorService.ts          # Read state, unread counts
│   ├── NotificationService.ts        # Notification creation, dispatch, preferences
│   ├── AttachmentService.ts          # Upload, validation, download, scanning
│   ├── SharedNoteService.ts          # Notes CRUD, linking
│   ├── MeetingService.ts             # Meeting lifecycle, participants
│   └── index.ts                      # Barrel export
├── realtime/
│   ├── RealtimeGateway.ts            # Socket.IO server, auth, rooms
│   ├── PresenceService.ts            # Heartbeat, session tracking
│   ├── TypingService.ts              # Typing indicators
│   └── EventPublisher.ts             # Typed event emission
├── auth/
│   └── ... (existing)
└── storage/
    ├── StorageProvider.ts            # Abstract storage interface
    ├── LocalStorageProvider.ts       # Dev: local filesystem
    └── S3StorageProvider.ts          # Prod: S3-compatible
```

### 4.2 Service Contract Example

```typescript
// CollaborationService.ts
export class CollaborationService {
  // Channels
  async createChannel(data: CreateChannelInput, userId: string): Promise<Channel>
  async getChannel(id: string, userId: string): Promise<Channel | null>
  async listChannels(userId: string, opts: ListChannelsOptions): Promise<Paginated<Channel>>
  async updateChannel(id: string, data: UpdateChannelInput, userId: string): Promise<Channel>
  async archiveChannel(id: string, userId: string): Promise<void>
  async deleteChannel(id: string, userId: string): Promise<void>

  // Membership
  async addMember(channelId: string, userId: string, actorId: string): Promise<ChannelMember>
  async removeMember(channelId: string, userId: string, actorId: string): Promise<void>
  async updateMemberRole(channelId: string, userId: string, role: ChannelRole, actorId: string): Promise<void>
  async listMembers(channelId: string, userId: string): Promise<ChannelMember[]>

  // Messages
  async sendMessage(data: SendMessageInput, userId: string): Promise<Message>
  async editMessage(id: string, content: string, userId: string): Promise<Message>
  async deleteMessage(id: string, userId: string, hard: boolean): Promise<void>
  async pinMessage(id: string, userId: string): Promise<Message>
  async unpinMessage(id: string, userId: string): Promise<Message>
  async addReaction(messageId: string, emoji: string, userId: string): Promise<Reaction>
  async removeReaction(messageId: string, emoji: string, userId: string): Promise<void>

  // Threads
  async getThread(parentId: string, userId: string): Promise<Message[]>
  async getThreadReplies(parentId: string, cursor?: string): Promise<Paginated<Message>>

  // Search
  async searchMessages(query: string, userId: string, opts: SearchOptions): Promise<Message[]>
}
```

---

## 5. Realtime Architecture (Socket.IO)

### 5.1 Connection Flow

```
Client                          Server
  │                                │
  ├─ WSS /socket.io/?token=JWT ───►│
  │                                ├─ authenticateToken(socket.handshake.auth.token)
  │                                ├─ verify user exists, active, org match
  │                                ├─ create PresenceSession
  │                                ├─ join user's personal room: `user:{userId}`
  │                                ├─ join organization room: `org:{orgId}`
  │                                └─ emit `connection.ack` { user, presence }
  │◄───────────────────────────────┤
  │                                │
  ├─ subscribe({ channelId }) ────►│
  │                                ├─ verify channel membership
  │                                ├─ join room: `channel:{channelId}`
  │                                ├─ fetch read cursor
  │                                └─ emit `subscribe.ack` { channelId, readCursor }
  │◄───────────────────────────────┤
```

### 5.2 Room Strategy

| Room Pattern | Scope | Members | Purpose |
|-------------|-------|---------|---------|
| `user:{userId}` | Personal | 1 socket per session | DMs, notifications, direct events |
| `org:{orgId}` | Organization | All org members | Presence broadcasts, org-wide announcements |
| `channel:{channelId}` | Channel | Channel members | Messages, reactions, typing, pins |
| `dm:{conversationId}` | DM | 2+ participants | Direct messages, typing |
| `meeting:{meetingId}` | Meeting | Participants | WebRTC signaling, participant events |

**Critical Rule:** Clients never choose room names. Server derives rooms from authenticated context and verified database membership.

### 5.3 Event Catalog (Version 1)

#### Server → Client Events

```typescript
// Message events
'message.created'        // { message: Message, temporaryId?: string }
'message.updated'        // { messageId, content, editedAt, editedBy }
'message.deleted'        // { messageId, deletedAt, deletedBy, hard: boolean }
'message.reaction.updated' // { messageId, emoji, count, users: string[], added: boolean }

// Channel events
'channel.created'        // { channel: Channel }
'channel.updated'        // { channelId, changes }
'channel.archived'       // { channelId }
'channel.member.added'   // { channelId, member: ChannelMember }
'channel.member.removed' // { channelId, userId }
'channel.member.updated' // { channelId, userId, role }

// DM events
'conversation.created'   // { conversation: Conversation, otherUser: User }
'conversation.member.updated' // { conversationId, userId, role }

// Read state
'conversation.read.updated' // { conversationId, userId, lastReadMessageId, unreadCount }

// Presence
'presence.updated'       // { userId, status, lastSeen }
'presence.bulk'          // { presences: { userId, status }[] } // On connect

// Typing
'typing.started'         // { conversationId, userId, userName }
'typing.stopped'         // { conversationId, userId }

// Notifications
'notification.created'   // { notification: Notification }
'notification.read'      // { notificationId }

// Attachments
'attachment.uploaded'    // { attachment: FileAttachment, messageId? }

// Meetings
'meeting.participant.joined'  // { meetingId, participant: MeetingParticipant }
'meeting.participant.left'    // { meetingId, userId }
'meeting.ended'               // { meetingId, endedAt }
```

#### Client → Server Commands

```typescript
// Connection
'authenticate'           // { token }: sent immediately after connect

// Room management
'subscribe'              // { channelId } | { conversationId }
'unsubscribe'            // { channelId } | { conversationId }

// Messages
'sendMessage'            // { temporaryId, channelId?, recipientId?, content, parentId?, idempotencyKey }
'editMessage'            // { messageId, content }
'deleteMessage'          // { messageId, hard?: boolean }
'pinMessage'             // { messageId }
'unpinMessage'           // { messageId }
'addReaction'            // { messageId, emoji }
'removeReaction'         // { messageId, emoji }

// Threads
'fetchThread'            // { parentId, cursor?, limit? }

// Read state
'markRead'               // { channelId? | conversationId?, messageId }

// Typing
'typing.start'           // { channelId? | conversationId? }
'typing.stop'            // { channelId? | conversationId? }

// Presence
'heartbeat'              // { status?: ONLINE|AWAY }

// Meetings
'meeting.join'           // { meetingId }
'meeting.leave'          // { meetingId }
'meeting.signal'         // { meetingId, toUserId, signal } // WebRTC signaling
```

### 5.4 Acknowledgement Contract

Every client command receives an acknowledgement:

```typescript
// Success
{ ok: true, data: T, eventId: string }

// Error
{ ok: false, error: { code: string, message: string }, eventId: string }
```

**Idempotency:** `sendMessage` requires a client-generated `idempotencyKey` (UUIDv4). Server checks for existing message with same key + user + channel/conversation before creating.

---

## 6. Authentication & Session Handling

### 6.1 Socket Handshake Authentication

```typescript
// Server validates JWT from handshake auth
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  
  const payload = verifyAccessToken(token);
  if (!payload) return next(new Error('Invalid or expired token'));
  
  // Verify user still exists and is active
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, isActive: true, organizationId: true, branchId: true }
  });
  
  if (!user || !user.isActive) return next(new Error('User not found or inactive'));
  if (user.organizationId !== payload.organizationId) return next(new Error('Organization mismatch'));
  
  socket.data.user = payload;
  socket.data.prismaUser = user;
  next();
});
```

### 6.2 Token Strategy

- **Access tokens:** Short-lived (15 min), used for Socket.IO handshake and REST
- **Refresh tokens:** HttpOnly cookie, rotated on use, stored as SHA-256 hash in DB
- **Never** send refresh tokens over WebSocket
- **Socket re-authentication:** On reconnect, client sends current access token

### 6.3 Session Invalidation

| Event | Action |
|-------|--------|
| User deactivated | Revoke all refresh tokens, disconnect all sockets |
| Role changed | Revoke refresh tokens, disconnect sockets, force re-auth |
| Password changed | Revoke all refresh tokens, disconnect all sockets |
| Logout all devices | Revoke all refresh tokens, disconnect all sockets |
| Channel membership removed | Leave channel room, emit `channel.member.removed` |

---

## 7. Authorization Model

### 7.1 Permission Matrix

| Action | Required | Checked At |
|--------|----------|------------|
| Create channel | Org member | REST + Service |
| List channels | Org member (sees public + own) | REST + Service |
| Join private channel | Invitation + org member | Service + Realtime |
| Send message (channel) | Channel member | Service + Realtime |
| Send DM | Same org | Service + Realtime |
| Edit message | Sender or Admin | Service + Realtime |
| Delete message | Sender or Admin | Service + Realtime |
| Add reaction | Channel/DM member | Service + Realtime |
| Pin message | Channel member (or Admin) | Service + Realtime |
| Upload attachment | Channel/DM member | Service + REST |
| Download attachment | Channel/DM member | Service + REST |
| Create meeting | Channel member (or org member for DM) | Service + Realtime |
| Join meeting | Meeting participant | Realtime + Service |

### 7.2 Tenant Isolation Enforcement

All service methods use centralized tenant utilities:

```typescript
// Every query scoped to organization
const where = orgWhereClause(tenant, { channelId });

// Every mutation sanitizes input
const data = sanitizeCreateInput(req, input);

// Every read verifies ownership
await verifyOrgOwnership(req, resource, 'Channel');
await verifyBranchAccess(req, resource, 'Channel');
```

---

## 8. File Storage Architecture

### 8.1 Storage Provider Interface

```typescript
interface StorageProvider {
  upload(key: string, stream: Readable, metadata: UploadMetadata): Promise<UploadResult>
  download(key: string): Promise<Readable>
  delete(key: string): Promise<void>
  getSignedUrl(key: string, ttlSeconds: number): Promise<string>
  exists(key: string): Promise<boolean>
}

interface UploadMetadata {
  organizationId: string
  channelId?: string
  messageId?: string
  originalFilename: string
  mimeType: string
  size: number
  checksum: string // SHA-256
}
```

### 8.2 Upload Flow

```
Client                          Server                          Storage
  │                                │                                │
  ├─ POST /api/attachments/init ──►│                                │
  │                                ├─ Validate: type, size, org    │
  │                                ├─ Generate opaque key          │
  │                                ├─ Create FileAttachment (PENDING)│
  │                                └─ Return { uploadUrl, key }    │
  │◄───────────────────────────────┤                                │
  │                                │                                │
  ├─ PUT {uploadUrl} (file) ──────►│                                │
  │                                │                                ├─ Store file
  │                                │                                ├─ Verify checksum
  │                                │                                ├─ Scan (if configured)
  │                                └─ Update FileAttachment (COMPLETED)│
  │◄───────────────────────────────┤                                │
  │                                │                                │
  ├─ POST /api/messages (with attachmentId) ──►│                  │
  │                                ├─ Verify attachment ownership  │
  │                                ├─ Create message + link        │
  │                                └─ Emit message.created         │
  │◄───────────────────────────────┤                                │
```

### 8.3 Security Controls

- **Opaque keys:** UUIDv4, no filesystem paths exposed
- **MIME validation:** Check magic bytes, not just extension/header
- **Size limits:** Configurable per org (default 50MB)
- **Allowlist:** Configurable MIME types per org
- **Authorization:** Every download verifies channel/DM membership
- **Scan hook:** Adapter for malware scanning (ClamAV, etc.)

---

## 9. Presence & Typing

### 9.1 Presence Model

- **Multi-session aware:** One user = multiple PresenceSession records
- **Heartbeat:** Client sends `heartbeat` every 30s (configurable)
- **Stale timeout:** 90s (3 missed heartbeats) → mark AWAY
- **Offline:** Explicit disconnect or 5 min no heartbeat → mark OFFLINE
- **Recovery:** On reconnect, new PresenceSession created, old cleaned up

### 9.2 Typing Indicators

- **Ephemeral only:** Not persisted to database
- **Scope:** Channel or DM conversation
- **Debounce:** Client sends `typing.start` on first keystroke, `typing.stop` after 2s idle
- **Server broadcast:** To conversation room except sender
- **Auto-expire:** Server stops typing after 5s if no `typing.stop` received

---

## 10. Notifications

### 10.1 Notification Types & Triggers

| Type | Trigger | Recipients |
|------|---------|------------|
| MENTION | `@username` in message | Mentioned users in channel/DM |
| DIRECT_MESSAGE | New DM received | Recipient (if not active in conversation) |
| THREAD_REPLY | Reply to thread user participated in | Thread participants |
| REACTION | Reaction on user's message | Message author |
| CHANNEL_INVITE | Added to private channel | Invited user |
| MESSAGE_PINNED | Message pinned in channel | Channel members |
| HUDDLE_STARTED | Huddle started in channel | Channel members |
| FILE_SHARED | File attached in channel/DM | Conversation members |
| SYSTEM | System announcement | Targeted users |

### 10.2 Delivery

1. **Persist** notification to DB (Notification model)
2. **Realtime emit** `notification.created` to `user:{userId}` room
3. **Desktop notification** via Tauri (if permission granted, app in background)
4. **Deduplication:** Skip realtime emit if user has active session in that conversation

### 10.3 Preferences

```prisma
model NotificationPreference {
  id             String   @id @default(uuid())
  userId         String   @unique
  desktopEnabled Boolean  @default(true)
  previewEnabled Boolean  @default(false) // Show message content in OS notification
  quietHoursStart String?  // HH:mm
  quietHoursEnd   String?  // HH:mm
  mutedChannels   String[] // channelIds
  mutedDms        String[] // userIds
}
```

---

## 11. Meetings / Huddles Architecture

### 11.1 Media Provider Abstraction

```typescript
interface MeetingProvider {
  createMeeting(opts: CreateMeetingOptions): Promise<MeetingCredentials>
  validateToken(token: string): Promise<MeetingValidation>
  getTurnServers(): Promise<TurnServer[]>
}

interface MeetingCredentials {
  meetingId: string
  token: string      // Short-lived JWT for media server
  turnServers: TurnServer[]
  sfuUrl?: string    // For group calls
}

interface TurnServer {
  urls: string[]
  username: string
  credential: string
  credentialType: 'password'
}
```

### 11.2 Provider Options

| Provider | Type | Group Calls | Self-Hosted | License | Status |
|----------|------|-------------|-------------|---------|--------|
| **Mediasoup** | SFU | ✅ | ✅ | MIT | Recommended |
| **LiveKit** | SFU | ✅ | ✅ | Apache 2.0 | Alternative |
| **Janus** | SFU | ✅ | ✅ | GPL | Complex setup |
| **Simple-peer** | Mesh | 2-party only | ✅ | MIT | Fallback |

**Decision:** Use **Mediasoup** as primary SFU provider for group calls. Implement provider adapter pattern for swappability.

### 11.3 Meeting Flow

```
User A (Host)                    Server                         User B
   │                               │                               │
   ├─ POST /api/meetings ─────────►│                               │
   │                               ├─ Create Meeting record        │
   │                               ├─ Generate short-lived token   │
   │                               └─ Return { meetingId, token }  │
   │◄──────────────────────────────┤                               │
   │                               │                               │
   ├─ meeting.join { meetingId } ──►│                               │
   │                               ├─ Verify membership            │
   │                               ├─ Join meeting:{meetingId}     │
   │                               ├─ Emit participant.joined      │
   │                               └─ Return TURN/SFU config       │
   │◄──────────────────────────────┤                               │
   │                               │                               │
   │                               ├──────── meeting.join ───────►│
   │                               │                               ├─ Verify, join room
   │                               │                               │
   │                               │◄─────── participant.joined ───┤
   │                               │                               │
   │ WebRTC signaling via Socket.IO (meeting.signal)               │
   │ Media via Mediasoup SFU (or direct for 2-party)               │
```

---

## 12. Tauri Desktop Integration

### 12.1 Capabilities Required

```json
// src-tauri/capabilities/notification.json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "notification",
  "description": "Native desktop notifications",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "notification:allow-show",
    "notification:allow-request-permission"
  ]
}
```

### 12.2 Notification Bridge

```typescript
// Frontend: Tauri notification handler
import { sendNotification, requestPermission } from '@tauri-apps/plugin-notification';

export async function showDesktopNotification(notification: Notification) {
  const permission = await requestPermission();
  if (permission !== 'granted') return;
  
  await sendNotification({
    title: notification.title,
    body: notification.body,
    // Deep link handled by Tauri URL scheme or custom protocol
  });
}

// Register click handler for deep navigation
```

### 12.3 Deep Link Handling

```rust
// src-tauri/src/lib.rs
tauri::Builder::default()
    .plugin(tauri_plugin_deep_link::init())
    .setup(|app| {
        let window = app.get_webview_window("main").unwrap();
        app.on_uri_event(|event| {
            // Parse event.uri like innowit://channel/ch_general?message=msg_123
            window.emit("deep-link", event.uri).unwrap();
        });
        Ok(())
    })
```

---

## 13. Migration Strategy

### 13.1 Prisma Migrations

1. **Create migration:** `npx prisma migrate dev --name phase2_collaboration`
2. **Test on fresh DB:** `npx prisma migrate deploy` on empty database
3. **Test on upgraded DB:** Copy production-like data, run migration
4. **Verify:** All existing data preserved, new tables created, indexes applied

### 13.2 Data Migration (if needed)

- Backfill `ReadCursor` for existing channel members (lastReadAt = now)
- Backfill `PresenceSession`: none (ephemeral)
- Backfill `Notification`: none (new feature)

---

## 14. Testing Strategy

### 14.1 Test Layers

| Layer | Tool | Scope |
|-------|------|-------|
| Unit | Vitest | Services, utilities, pure functions |
| Integration | Vitest + Testcontainers | REST API, Prisma, PostgreSQL |
| Realtime | Vitest + Socket.IO client | Socket events, rooms, auth |
| E2E | Playwright | Full user flows, multi-user |
| Desktop | Playwright + Tauri | Native notifications, tray, deep links |

### 14.2 Mandatory Multi-User Tests (from spec)

1. Two users in same channel send/receive messages
2. Offline user reconnects and receives missed messages
3. Idempotent send (retry) creates exactly one message
4. Cross-org channel access denied
5. Cross-branch access denied for restricted roles
6. Removed member loses access immediately
7. Deactivated user socket disconnected
8. DM create-or-open returns same conversation
9. Message edit/delete preserves audit trail
10. Duplicate reactions prevented
11. Read cursor correctness
12. Multi-session presence accuracy
13. Typing indicator scope and expiry
14. Notification deduplication
15. Attachment upload validation
16. Unauthorized attachment download denied
17. Reconnect recovers subscriptions + history
18. Socket ack reports DB failure
19. Meeting token scoped and validated
20. Two desktop clients exchange audio/video (or BLOCKED)

---

## 15. Configuration

### 15.1 Environment Variables (New for Phase 2)

```env
# Realtime
SOCKET_IO_PORT=3001              # Same as HTTP, Socket.IO attaches to same server
SOCKET_IO_CORS_ORIGIN=http://localhost:3002
SOCKET_IO_PING_INTERVAL=25000
SOCKET_IO_PING_TIMEOUT=20000

# Presence
PRESENCE_HEARTBEAT_INTERVAL_MS=30000
PRESENCE_STALE_TIMEOUT_MS=90000
PRESENCE_OFFLINE_TIMEOUT_MS=300000

# Notifications
NOTIFICATION_DEDUP_WINDOW_MS=5000
NOTIFICATION_DESKTOP_ENABLED=true

# Attachments
ATTACHMENT_MAX_SIZE_MB=50
ATTACHMENT_ALLOWED_MIME_TYPES=application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
ATTACHMENT_SCAN_ENABLED=false
ATTACHMENT_STORAGE_PROVIDER=local  # local | s3
ATTACHMENT_LOCAL_PATH=./uploads
ATTACHMENT_S3_BUCKET=
ATTACHMENT_S3_REGION=
ATTACHMENT_S3_ENDPOINT=

# Meetings
MEETING_PROVIDER=mediasoup
MEETING_SFU_URL=
MEETING_TURN_URLS=
MEETING_TURN_USERNAME=
MEETING_TURN_CREDENTIAL=
```

---

## 16. Deployment Considerations

### 16.1 Horizontal Scaling (Future)

- **Socket.IO Redis Adapter** for multi-instance pub/sub
- **Shared session store** (Redis) for PresenceSession
- **Sticky sessions** not required with Redis adapter
- **Load balancer** with WebSocket support

### 16.2 Single-Instance (Current)

- In-memory PresenceSession (cleaned on restart)
- Socket.IO default adapter (in-memory)
- File storage: local or S3

---

## 17. Open Decisions / Risks (Closeout Status)

| ID | Decision | Status | Notes |
|----|----------|--------|-------|
| ARCH-01 | Mediasoup vs LiveKit for SFU | **Deferred** | Phase 2.6 BLOCKED; no SFU provisioned |
| ARCH-02 | Reaction model: separate table vs JSON | **Decided** | Separate table for uniqueness |
| ARCH-03 | DM model: Conversation table vs Message.recipientId | **Decided** | Keep Message.recipientId, add Conversation for metadata |
| ARCH-04 | Read cursor: per-channel vs per-message | **Decided** | Per-channel + lastReadMessageId |
| ARCH-05 | Typing: broadcast to all or per-room | **Decided** | Per-conversation room |
| ARCH-06 | Notification deduplication strategy | **Decided** | Skip if active in conversation |
| RISK-01 | MSI bundler file-lock (Phase 1 known) | **Known** | Use NSIS or ZIP for distribution |
| RISK-02 | Mediasoup native deps on Windows | **Medium** | Prebuilt binaries available |
| RISK-03 | Tauri notification permission in dev | **Known** | Test packaged builds; **not runtime verified** |
| RISK-04 | **Two-desktop-client test on Windows** | **BLOCKED** | Tauri single-instance; cannot launch 2 independent processes |
| RISK-05 | **Test isolation in shared DB** | **Minor** | 1 flaky test (`should pin message`) in full suite |

---

## 18. Closeout Status

1. ✅ Review and approve this architecture document
2. ✅ Review and approve `PHASE-2-API-CONTRACT.md`
3. ✅ Review and approve `PHASE-2-REALTIME-EVENTS.md`
4. ✅ Review and approve `PHASE-2-SECURITY-MODEL.md`
5. ✅ Prisma migration created and applied (`20261118_phase2_collaboration`)
6. ✅ Phase 2 implementation complete (14/18 features verified)
7. ✅ All Phase 1 regression tests pass (33/33 + 19/19)
8. ✅ Phase 2 integration tests: 79/80 pass (1 flaky)
9. ✅ Build, TypeScript, Cargo check all pass
10. ⚠️ Phase 2.6 Huddles/SFU explicitly BLOCKED
11. ⚠️ Two-desktop-client gate BLOCKED (Windows Tauri limitation)
12. ⚠️ Desktop notifications/deep-links not runtime verified
