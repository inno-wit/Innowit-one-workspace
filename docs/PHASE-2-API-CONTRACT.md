# PHASE 2 API CONTRACT: INNOWIT ONE COLLABORATION ENGINE

**Version:** 2.0 (As-Built)  
**Date:** 2026-11-18  
**Status:** As-Built (Closeout Verified)  
**Base URL:** `/api`  
**Authentication:** Bearer token (access token) in Authorization header  
**Closeout Commit:** `930091af2abbd7cd4d8e3939f1db87b99e77c993`

---

## 1. Conventions

### 1.1 Response Envelope

```typescript
// Success
{
  "data": T,
  "pagination"?: { page: number, limit: number, total: number, totalPages: number }
}

// Error
{
  "error": string,
  "code": string,
  "details"?: Record<string, any>
}
```

### 1.2 HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK |
| 201 | Created |
| 400 | Validation Error (VALIDATION_ERROR) |
| 401 | Unauthorized (UNAUTHORIZED, INVALID_TOKEN, USER_INACTIVE) |
| 403 | Forbidden (FORBIDDEN, ORG_MISMATCH, BRANCH_MISMATCH) |
| 404 | Not Found (NOT_FOUND) |
| 409 | Conflict (ALREADY_MEMBER, DUPLICATE_REACTION) |
| 422 | Unprocessable (business rule violation) |
| 429 | Rate Limited (RATE_LIMITED) |
| 500 | Internal Error (INTERNAL_ERROR) |

### 1.3 Pagination

Cursor-based for messages, offset-based for lists:

```typescript
// Offset (channels, members, files)
?page=1&limit=20

// Cursor (messages)
?cursor=msg_abc123&limit=50&direction=before
```

### 1.4 Idempotency

Mutating endpoints accept `Idempotency-Key` header (UUIDv4). Server stores key + hash of request body for 24h. Duplicate key + same body = returns original response.

---

## 2. Channels

### 2.1 List Channels

**GET** `/channels`

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| page | integer | 1 | Page number |
| limit | integer | 20 | Items per page (max 100) |
| search | string | - | Filter by name/description |
| archived | boolean | false | Include archived |
| branchId | uuid | - | Filter by branch scope |

**Response:**
```json
{
  "data": [
    {
      "id": "ch_general",
      "name": "general",
      "description": "Company-wide announcements",
      "topic": "Phase 2 deployment",
      "isPrivate": false,
      "isArchived": false,
      "branchId": null,
      "memberCount": 12,
      "unreadCount": 0,
      "createdById": "usr_super_01",
      "createdAt": "2026-10-01T00:00:00.000Z",
      "isMember": true
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 6, "totalPages": 1 }
}
```

### 2.2 Get Channel

**GET** `/channels/:id`

**Response:**
```json
{
  "data": {
    "id": "ch_general",
    "name": "general",
    "description": "Company-wide announcements",
    "topic": "Phase 2 deployment",
    "isPrivate": false,
    "isArchived": false,
    "branchId": null,
    "memberCount": 12,
    "createdById": "usr_super_01",
    "createdAt": "2026-10-01T00:00:00.000Z",
    "members": [
      { "id": "cm_1", "userId": "usr_super_01", "joinedAt": "2026-10-01T00:00:00.000Z", "user": { "id": "usr_super_01", "fullName": "Kimani Mwangi", "email": "kimani@innowit.com", "avatarUrl": null } }
    ],
    "_count": { "messages": 142 }
  }
}
```

### 2.3 Create Channel

**POST** `/channels`

**Request Body:**
```json
{
  "name": "project-alpha",
  "description": "Project Alpha coordination",
  "topic": "Sprint 3 · Lead: Alex Kibet",
  "isPrivate": false,
  "branchId": "branch_01"
}
```

**Validation:**
- `name`: required, 1-100 chars, kebab-case enforced server-side
- `description`: optional, max 500 chars
- `topic`: optional, max 200 chars
- `isPrivate`: boolean, default false
- `branchId`: optional UUID, must belong to user's org

**Response:** 201 Created
```json
{
  "data": {
    "id": "ch_project_alpha",
    "name": "project-alpha",
    "description": "Project Alpha coordination",
    "topic": "Sprint 3 · Lead: Alex Kibet",
    "isPrivate": false,
    "isArchived": false,
    "branchId": "branch_01",
    "memberCount": 1,
    "createdById": "usr_super_01",
    "createdAt": "2026-11-18T10:30:00.000Z"
  }
}
```

### 2.4 Update Channel

**PUT** `/channels/:id`

**Authorization:** Creator, SUPER_ADMIN, or ADMIN

**Request Body:** (all optional)
```json
{
  "name": "project-alpha-v2",
  "description": "Updated description",
  "topic": "Sprint 4 · Lead: Alex Kibet",
  "isPrivate": true,
  "branchId": "branch_02"
}
```

### 2.5 Archive Channel

**POST** `/channels/:id/archive`

**Authorization:** Creator, SUPER_ADMIN, or ADMIN

**Response:** 200 OK
```json
{ "data": { "id": "ch_general", "isArchived": true, "archivedAt": "2026-11-18T10:30:00.000Z" } }
```

### 2.6 Unarchive Channel

**POST** `/channels/:id/unarchive`

### 2.7 Delete Channel

**DELETE** `/channels/:id`

**Authorization:** SUPER_ADMIN or ADMIN only

**Behavior:** Soft delete (sets `deletedAt`), retains messages for audit. Hard delete not exposed via API.

---

## 3. Channel Membership

### 3.1 List Members

**GET** `/channels/:id/members`

**Response:**
```json
{
  "data": [
    {
      "id": "cm_1",
      "channelId": "ch_general",
      "userId": "usr_super_01",
      "joinedAt": "2026-10-01T00:00:00.000Z",
      "user": { "id": "usr_super_01", "fullName": "Kimani Mwangi", "email": "kimani@innowit.com", "avatarUrl": null, "role": "SUPER_ADMIN" }
    }
  ]
}
```

### 3.2 Add Member

**POST** `/channels/:id/members`

**Authorization:** 
- Public channel: any org member
- Private channel: creator, SUPER_ADMIN, ADMIN

**Request Body:**
```json
{ "userId": "usr_sales_rep_07" }
```

**Response:** 201 Created
```json
{
  "data": {
    "id": "cm_new",
    "channelId": "ch_general",
    "userId": "usr_sales_rep_07",
    "joinedAt": "2026-11-18T10:30:00.000Z",
    "user": { "id": "usr_sales_rep_07", "fullName": "Kevin Mutiso", "email": "kevin@innowit.com", "avatarUrl": null, "role": "SALES_REP" }
  }
}
```

### 3.3 Remove Member

**DELETE** `/channels/:id/members/:userId`

**Authorization:**
- Self: any member can remove themselves
- Others: creator, SUPER_ADMIN, ADMIN

**Response:** 200 OK
```json
{ "message": "Member removed successfully" }
```

---

## 4. Direct Messages (Conversations)

### 4.1 List Conversations

**GET** `/conversations`

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| page | integer | 1 | Page number |
| limit | integer | 20 | Items per page |

**Response:**
```json
{
  "data": [
    {
      "id": "conv_usr_super_01_usr_sales_rep_07",
      "type": "direct",
      "participants": [
        { "id": "usr_super_01", "fullName": "Kimani Mwangi", "avatarUrl": null, "presence": "ONLINE" },
        { "id": "usr_sales_rep_07", "fullName": "Kevin Mutiso", "avatarUrl": null, "presence": "ONLINE" }
      ],
      "lastMessage": { "id": "msg_123", "content": "Thanks for the update", "senderId": "usr_sales_rep_07", "createdAt": "2026-11-18T10:25:00.000Z" },
      "unreadCount": 2,
      "updatedAt": "2026-11-18T10:25:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 5, "totalPages": 1 }
}
```

### 4.2 Create or Open DM

**POST** `/conversations`

**Request Body:**
```json
{ "recipientId": "usr_sales_rep_07" }
```

**Behavior:** Returns existing conversation if one exists between the two users. Creates new if not.

**Response:** 200 OK (existing) or 201 Created (new)
```json
{
  "data": {
    "id": "conv_usr_super_01_usr_sales_rep_07",
    "type": "direct",
    "participants": [...],
    "createdAt": "2026-11-18T10:30:00.000Z"
  }
}
```

### 4.3 Group DM (Future)

**POST** `/conversations/group`

**Request Body:**
```json
{ "name": "Project Leads", "participantIds": ["usr_1", "usr_2", "usr_3"] }
```

**Status:** Defined in contract, implementation deferred to Phase 2.x

---

## 5. Messages

### 5.1 List Messages (Channel)

**GET** `/messages?channelId=ch_general`

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| channelId | uuid | required* | Channel ID |
| recipientId | uuid | required* | DM recipient ID |
| cursor | string | - | Message ID for pagination |
| limit | integer | 50 | Max messages (max 100) |
| direction | enum | before | `before` or `after` |

*Exactly one of `channelId` or `recipientId` required.

**Response:**
```json
{
  "data": [
    {
      "id": "msg_123",
      "channelId": "ch_general",
      "senderId": "usr_super_01",
      "recipientId": null,
      "parentId": null,
      "content": "Welcome to the channel!",
      "isPinned": true,
      "createdAt": "2026-11-18T09:15:00.000Z",
      "updatedAt": null,
      "editedAt": null,
      "editedById": null,
      "deletedAt": null,
      "sender": { "id": "usr_super_01", "fullName": "Kimani Mwangi", "email": "kimani@innowit.com", "avatarUrl": null },
      "channel": { "id": "ch_general", "name": "general" },
      "parent": null,
      "reactions": [
        { "emoji": "🚀", "count": 4, "users": ["usr_exec_03", "usr_accountant_05", "usr_admin_02", "usr_sales_rep_07"], "currentUserReacted": false }
      ],
      "attachments": [],
      "replyCount": 2,
      "lastReplyAt": "2026-11-18T10:20:00.000Z",
      "threadRootId": null
    }
  ],
  "pagination": { "cursor": "msg_120", "limit": 50, "hasMore": true }
}
```

### 5.2 List Messages (DM)

**GET** `/messages?recipientId=usr_sales_rep_07`

Same response structure, `channelId` is null, `recipientId` populated.

### 5.3 Get Single Message

**GET** `/messages/:id`

**Response:** Full message with thread replies included.

### 5.4 Send Message (Channel)

**POST** `/messages`

**Request Body:**
```json
{
  "channelId": "ch_general",
  "content": "Hello team!",
  "parentId": "msg_123",  // Optional: thread reply
  "idempotencyKey": "uuid-v4-client-generated"
}
```

**Validation:**
- Exactly one of `channelId` or `recipientId` required
- `content`: required, 1-10000 chars
- `parentId`: optional, must be in same channel/conversation
- `idempotencyKey`: required, UUIDv4

**Response:** 201 Created
```json
{
  "data": {
    "id": "msg_new",
    "channelId": "ch_general",
    "senderId": "usr_super_01",
    "content": "Hello team!",
    "createdAt": "2026-11-18T10:30:00.000Z",
    "sender": { "id": "usr_super_01", "fullName": "Kimani Mwangi", ... }
  }
}
```

**Idempotency:** If same `idempotencyKey` + `senderId` + `channelId` exists, returns existing message (200 OK).

### 5.5 Send Message (DM)

**POST** `/messages`

```json
{
  "recipientId": "usr_sales_rep_07",
  "content": "Direct message",
  "idempotencyKey": "uuid-v4"
}
```

### 5.6 Edit Message

**PUT** `/messages/:id`

**Authorization:** Sender, SUPER_ADMIN, ADMIN

**Request Body:**
```json
{ "content": "Updated content" }
```

**Response:**
```json
{
  "data": {
    "id": "msg_123",
    "content": "Updated content",
    "editedAt": "2026-11-18T10:35:00.000Z",
    "editedById": "usr_super_01",
    "updatedAt": "2026-11-18T10:35:00.000Z"
  }
}
```

### 5.7 Delete Message

**DELETE** `/messages/:id?hard=false`

**Authorization:** Sender, SUPER_ADMIN, ADMIN

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| hard | boolean | false | If true, hard delete (admin only). Default: soft delete (tombstone). |

**Behavior:** 
- Soft delete: sets `deletedAt`, `deletedById`, content replaced with `[Deleted]`
- Hard delete: removes row (SUPER_ADMIN only, audit-restricted)

### 5.8 Pin Message

**POST** `/messages/:id/pin`

**Authorization:** Channel member (or ADMIN/SUPER_ADMIN)

### 5.9 Unpin Message

**DELETE** `/messages/:id/pin`

### 5.10 Get Thread Replies

**GET** `/messages/:id/thread`

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| cursor | string | - | Reply ID for pagination |
| limit | integer | 50 | Max replies |

**Response:**
```json
{
  "data": [
    { "id": "rep_1", "messageId": "msg_123", "senderId": "usr_exec_03", "content": "Reply 1", "createdAt": "..." }
  ],
  "pagination": { "cursor": "rep_10", "limit": 50, "hasMore": false }
}
```

### 5.11 Search Messages

**GET** `/messages/search?q=query`

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| q | string | required | Search query (min 2 chars) |
| channelId | uuid | - | Limit to channel |
| limit | integer | 20 | Max results |

**Response:** Array of messages with `highlight` field showing matched snippets.

---

## 6. Reactions

### 6.1 Add Reaction

**POST** `/messages/:id/reactions`

**Request Body:**
```json
{ "emoji": "🚀" }
```

**Response:** 201 Created
```json
{
  "data": { "messageId": "msg_123", "emoji": "🚀", "count": 5, "users": ["usr_1", "usr_2", ...], "currentUserReacted": true }
}
```

**Constraint:** Unique per (messageId, userId, emoji). Duplicate = 409 ALREADY_EXISTS.

### 6.2 Remove Reaction

**DELETE** `/messages/:id/reactions/:emoji`

**Response:** 200 OK
```json
{ "data": { "messageId": "msg_123", "emoji": "🚀", "count": 4, "currentUserReacted": false } }
```

### 6.3 List Reactions

**GET** `/messages/:id/reactions`

**Response:** Array of reaction summaries.

---

## 7. Read State & Unread Counts

### 7.1 Mark Channel Read

**POST** `/channels/:id/read`

**Request Body:**
```json
{ "messageId": "msg_123" }  // Last read message
```

**Behavior:** Creates/updates ReadCursor for user + channel.

### 7.2 Mark DM Read

**POST** `/conversations/:id/read`

**Request Body:**
```json
{ "messageId": "msg_123" }
```

### 7.3 Get Unread Counts

**GET** `/unread-counts`

**Response:**
```json
{
  "data": {
    "channels": { "ch_general": 5, "ch_finance_ops": 2 },
    "conversations": { "conv_usr_super_01_usr_sales_rep_07": 3 },
    "total": 10,
    "mentions": 2
  }
}
```

### 7.4 Get Read Cursor

**GET** `/channels/:id/read-cursor`

**Response:**
```json
{ "data": { "channelId": "ch_general", "lastReadMessageId": "msg_120", "lastReadAt": "2026-11-18T09:30:00.000Z" } }
```

---

## 8. Notifications

### 8.1 List Notifications

**GET** `/notifications`

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| page | integer | 1 | Page |
| limit | integer | 20 | Per page |
| unreadOnly | boolean | false | Filter unread |

**Response:**
```json
{
  "data": [
    {
      "id": "notif_123",
      "type": "MENTION",
      "title": "You were mentioned in #general",
      "body": "Kimani Mwangi: @Sarah Chebet please review",
      "data": { "channelId": "ch_general", "messageId": "msg_123" },
      "isRead": false,
      "createdAt": "2026-11-18T10:30:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 15, "totalPages": 1 }
}
```

### 8.2 Mark Notification Read

**POST** `/notifications/:id/read`

### 8.3 Mark All Read

**POST** `/notifications/read-all`

### 8.4 Notification Preferences

**GET** `/notifications/preferences`

**Response:**
```json
{
  "data": {
    "desktopEnabled": true,
    "previewEnabled": false,
    "quietHoursStart": "22:00",
    "quietHoursEnd": "07:00",
    "mutedChannels": ["ch_random"],
    "mutedUsers": []
  }
}
```

**PUT** `/notifications/preferences`

**Request Body:** Same as response.

---

## 9. File Attachments

### 9.1 Initialize Upload

**POST** `/attachments/init`

**Request Body:**
```json
{
  "fileName": "document.pdf",
  "mimeType": "application/pdf",
  "size": 1024000,
  "checksum": "sha256-hex-string",
  "channelId": "ch_general",  // Optional: associate with channel
  "messageId": "msg_123"      // Optional: associate with message
}
```

**Validation:**
- MIME type in allowlist
- Size <= max (default 50MB)
- Checksum: SHA-256 hex string (client computes)

**Response:** 201 Created
```json
{
  "data": {
    "id": "att_123",
    "uploadUrl": "https://storage.example.com/upload/att_123?token=...",
    "key": "att_123",
    "expiresAt": "2026-11-18T11:30:00.000Z"
  }
}
```

### 9.2 Complete Upload

**POST** `/attachments/:id/complete`

**Behavior:** Server verifies checksum, scans file, updates status to COMPLETED.

### 9.3 Get Attachment Metadata

**GET** `/attachments/:id`

**Response:**
```json
{
  "data": {
    "id": "att_123",
    "fileName": "document.pdf",
    "fileSize": 1024000,
    "mimeType": "application/pdf",
    "category": "DOCUMENT",
    "uploadStatus": "COMPLETED",
    "checksum": "sha256...",
    "scannedAt": "2026-11-18T10:31:00.000Z",
    "scanStatus": "CLEAN",
    "uploadedBy": "usr_super_01",
    "uploadedAt": "2026-11-18T10:30:00.000Z",
    "channelId": "ch_general",
    "messageId": "msg_123"
  }
}
```

### 9.4 Download Attachment

**GET** `/attachments/:id/download`

**Response:** 302 Redirect to signed URL (short-lived, 5 min) or streamed response.

**Authorization:** Must be member of associated channel or DM participant.

### 9.5 Delete Attachment

**DELETE** `/attachments/:id`

**Authorization:** Uploader, channel admin, SUPER_ADMIN, ADMIN.

**Behavior:** Soft delete (marks deleted, removes file from storage after retention period).

---

## 10. Shared Notes

### 10.1 List Notes

**GET** `/notes`

**Query Parameters:** `channelId`, `category`, `search`, `page`, `limit`

### 10.2 Get Note

**GET** `/notes/:id`

### 10.3 Create Note

**POST** `/notes`

**Request Body:**
```json
{
  "title": "Project Alpha SLA",
  "content": "# SLA Details\n...",
  "category": "SALES",
  "channelId": "ch_sales_nairobi",
  "linkedEntityType": "CUSTOMER",
  "linkedEntityId": "cust_safaricom"
}
```

### 10.4 Update Note

**PUT** `/notes/:id`

### 10.5 Delete Note

**DELETE** `/notes/:id`

### 10.6 Pin/Unpin Note

**POST** `/notes/:id/pin` | **DELETE** `/notes/:id/pin`

---

## 11. Meetings / Huddles

### 11.1 Create Meeting

**POST** `/meetings`

**Request Body:**
```json
{
  "channelId": "ch_general",  // Optional: channel meeting
  "title": "Sprint Planning",
  "meetingType": "CHANNEL",   // CHANNEL | DIRECT | GROUP
  "participantIds": ["usr_1", "usr_2"]  // For DIRECT/GROUP
}
```

**Response:** 201 Created
```json
{
  "data": {
    "id": "mtg_123",
    "channelId": "ch_general",
    "title": "Sprint Planning",
    "status": "ACTIVE",
    "startedAt": "2026-11-18T10:30:00.000Z",
    "credentials": {
      "meetingId": "mtg_123",
      "token": "short-lived-jwt",
      "turnServers": [{ "urls": ["turn:..."], "username": "...", "credential": "..." }],
      "sfuUrl": "wss://sfu.example.com"
    }
  }
}
```

### 11.2 Join Meeting

**POST** `/meetings/:id/join`

**Response:** Meeting credentials + participant list.

### 11.3 Leave Meeting

**POST** `/meetings/:id/leave`

### 11.4 End Meeting

**POST** `/meetings/:id/end`

**Authorization:** Host, co-host, SUPER_ADMIN, ADMIN.

### 11.5 Get Meeting

**GET** `/meetings/:id`

### 11.6 List Meetings

**GET** `/meetings?channelId=ch_general&status=ACTIVE`

---

## 12. Presence

### 12.1 Get Presence (Bulk)

**GET** `/presence?userIds=usr_1,usr_2,usr_3`

**Response:**
```json
{
  "data": [
    { "userId": "usr_1", "status": "ONLINE", "lastSeen": null, "sessions": 2 },
    { "userId": "usr_2", "status": "AWAY", "lastSeen": "2026-11-18T10:25:00.000Z", "sessions": 1 },
    { "userId": "usr_3", "status": "OFFLINE", "lastSeen": "2026-11-18T09:00:00.000Z", "sessions": 0 }
  ]
}
```

### 12.2 Get Own Presence Sessions

**GET** `/presence/sessions`

**Response:** Array of active sessions for current user.

---

## 13. Error Codes Reference

| Code | HTTP | Description |
|------|------|-------------|
| VALIDATION_ERROR | 400 | Request body failed schema validation |
| UNAUTHORIZED | 401 | Missing or invalid access token |
| INVALID_TOKEN | 401 | Token malformed, expired, or signature invalid |
| USER_INACTIVE | 401 | User account deactivated |
| ORG_MISMATCH | 403 | Token org ≠ user's current org |
| BRANCH_MISMATCH | 403 | Token branch ≠ user's current branch |
| FORBIDDEN | 403 | Insufficient permissions for action |
| NOT_FOUND | 404 | Resource not found or access denied |
| ALREADY_MEMBER | 409 | User already member of channel |
| DUPLICATE_REACTION | 409 | User already reacted with this emoji |
| IDEMPOTENCY_CONFLICT | 409 | Idempotency key used with different payload |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Unexpected server error |

---

## 14. Rate Limits

| Endpoint Category | Limit | Window |
|-------------------|-------|--------|
| Authentication | 10 req | 1 min |
| Channel/Message reads | 100 req | 1 min |
| Message sends | 30 req | 1 min |
| Attachment uploads | 10 req | 1 min |
| Search | 20 req | 1 min |
| Meeting operations | 10 req | 1 min |
| WebSocket connections | 5 concurrent | per user |

---

## 15. Versioning

- **v1** (current): `/api/...` paths as documented
- Future versions: `/api/v2/...` with header `Accept: application/vnd.innowit.v2+json`
- Breaking changes only in new versions
- Deprecation: 6 months notice via `Deprecation` header
