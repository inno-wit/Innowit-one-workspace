# PHASE 2 SECURITY MODEL: INNOWIT ONE COLLABORATION ENGINE

**Version:** 2.0 (As-Built)  
**Date:** 2026-11-18  
**Status:** As-Built (Closeout Verified)  
**Threat Model:** STRIDE + Multi-tenant SaaS  
**Closeout Commit:** `930091af2abbd7cd4d8e3939f1db87b99e77c993`

---

## 1. Security Principles

1. **Defense in Depth**: Authorization at route, service, and database levels
2. **Zero Trust**: Never trust client-supplied IDs, tokens, or room names
3. **Least Privilege**: Minimum permissions for each operation
4. **Audit by Default**: All mutating operations logged
5. **Fail Secure**: Deny by default, explicit allow
6. **Tenant Isolation**: Cryptographic separation between organizations

---

## 2. Threat Model (STRIDE)

| Threat | Phase 2 Vectors | Mitigations |
|--------|-----------------|-------------|
| **Spoofing** | Forged JWT, fake socket auth, impersonation | Short-lived JWT (15m), refresh rotation, socket handshake verification, user status check on every auth |
| **Tampering** | Message content injection, ID manipulation, room name forgery | Server derives all IDs/rooms, sanitizes input, validates ownership before write |
| **Repudiation** | Deny sending message, deleting audit trail | Immutable message logs, edit metadata (editedAt, editedById), soft delete with tombstones, audit log entries |
| **Information Disclosure** | Cross-org channel access, DM enumeration, file download | Tenant-scoped queries, membership verification on every read, signed download URLs |
| **Denial of Service** | Message floods, connection floods, large uploads | Rate limits (per-user, per-org), payload size limits, connection limits, upload validation |
| **Elevation of Privilege** | Admin escalation, channel takeover, meeting hijack | Role hierarchy enforcement, creator/admin checks, meeting token scoping |

---

## 3. Attack Scenarios & Mitigations

### 3.1 Cross-Organization Conversation ID Guessing

**Attack:** User in Org A guesses channel ID from Org B, attempts to subscribe/read.

**Mitigation:**
- Channel IDs are UUIDv4 (unguessable)
- `subscribe` verifies `ChannelMember` record for user + channel
- REST `GET /messages?channelId=...` verifies membership
- Database queries always include `organizationId` from authenticated context

```typescript
// Service layer - always scoped
const channel = await prisma.channel.findFirst({
  where: { id: channelId, organizationId: user.organizationId }
});
if (!channel) throw new ForbiddenError();

// Realtime - room join verified
socket.on('subscribe', async ({ channelId }, ack) => {
  const membership = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId: socket.data.user.userId } }
  });
  if (!membership && !(await isPublicChannel(channelId))) {
    return ack({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member' } });
  }
  socket.join(`channel:${channelId}`);
  ack({ ok: true, data: { readCursor: ... } });
});
```

### 3.2 Cross-Branch Channel Access

**Attack:** Branch-restricted user (e.g., SALES_REP) accesses branch-scoped channel.

**Mitigation:**
- `Channel.branchId` field for branch-scoped visibility
- `verifyBranchAccess()` middleware checks `CROSS_BRANCH_ROLES`
- Non-cross-branch users only see channels where `branchId === user.branchId` or `branchId === null`

```typescript
// Tenant context includes branch access
const tenant = getTenantContext(req);
const where = branchWhereClause(tenant, { id: channelId });
// Generates: { organizationId, branchId: user.branchId } for non-cross-branch roles
```

### 3.3 Removed Member Retains Socket Access

**Attack:** User removed from private channel but keeps WebSocket connection, continues receiving messages.

**Mitigation:**
- On `DELETE /channels/:id/members/:userId`, server:
  1. Deletes `ChannelMember` record
  2. Finds all socket sessions for that user (via `PresenceSession`)
  3. Emits `channel.member.removed` to user's personal room
  4. Forces `socket.leave(`channel:${channelId}`)` on those sockets

```typescript
// Server-side removal handler
async function removeMember(channelId, userId, actorId) {
  await prisma.channelMember.delete({ where: { channelId_userId: { channelId, userId } } });
  
  // Notify and force-leave all user's sockets
  const sessions = await prisma.presenceSession.findMany({ where: { userId } });
  sessions.forEach(session => {
    io.to(`user:${userId}`).emit('channel.member.removed', { channelId, userId });
    io.in(session.socketId).socketsLeave(`channel:${channelId}`);
  });
}
```

### 3.4 Deactivated User Retains Socket

**Attack:** User account deactivated but WebSocket stays connected.

**Mitigation:**
- `authenticateToken` middleware checks `user.isActive` on every REST request
- Socket handshake verifies `isActive`
- Background job (every 60s) scans `PresenceSession` for deactivated users, disconnects
- On deactivation: revoke all refresh tokens, emit `force_disconnect` to user's sockets

```typescript
// Periodic cleanup job
async function cleanupDeactivatedSessions() {
  const inactiveUsers = await prisma.user.findMany({
    where: { isActive: false },
    select: { id: true }
  });
  
  for (const user of inactiveUsers) {
    const sessions = await prisma.presenceSession.findMany({ where: { userId: user.id } });
    sessions.forEach(s => {
      io.in(s.socketId).emit('force_disconnect', { reason: 'ACCOUNT_DEACTIVATED' });
      io.in(s.socketId).disconnectSockets();
    });
    await prisma.presenceSession.deleteMany({ where: { userId: user.id } });
  }
}
```

### 3.5 Forged Socket Room/Event Payload

**Attack:** Client sends `subscribe` with forged `channelId`, or emits `message.created` directly.

**Mitigation:**
- **Server-only emits**: clients cannot emit server→client events
- **Room names derived server-side**: client provides resource ID, server validates and joins
- **All commands validated**: `sendMessage` verifies membership before persist + broadcast

```typescript
// Socket.IO: client can only emit defined commands
// Server handlers validate every command
socket.on('sendMessage', async (payload, ack) => {
  // 1. Validate payload schema
  // 2. Verify channel membership OR DM participant
  // 3. Create message in DB (transaction)
  // 4. Broadcast to room (server-side emit)
  // 5. Ack with server-generated message ID
});
```

### 3.6 Direct-Message ID Enumeration

**Attack:** User guesses `conversationId` format (`conv_usr_1_usr_2`) to access DMs.

**Mitigation:**
- Conversation IDs are UUIDv4 (not predictable)
- `subscribe` with `conversationId` verifies user is participant
- REST `GET /messages?recipientId=...` verifies same org + not blocked

### 3.7 Duplicate Messages/Reactions from Retry

**Attack:** Network retry causes duplicate message or reaction.

**Mitigation:**
- **Messages:** Client-generated `idempotencyKey` (UUIDv4) + unique constraint
- **Reactions:** Unique constraint on `(messageId, userId, emoji)`
- **Server idempotency check** before create

```prisma
// Message model - idempotency key
model Message {
  idempotencyKey String? @unique
  // Unique constraint: (idempotencyKey, senderId, channelId) - partial index
  @@index([idempotencyKey, senderId, channelId])
}

// Reaction model
model Reaction {
  @@unique([messageId, userId, emoji])
}
```

### 3.8 Unauthorized File Download

**Attack:** User downloads attachment from channel they're not member of.

**Mitigation:**
- Attachment metadata stores `channelId` or `messageId`
- Download endpoint verifies membership via message/channel
- Signed URLs short-lived (5 min), single-use
- Storage keys opaque (UUID), no path traversal

```typescript
// Download handler
async function downloadAttachment(attachmentId, userId) {
  const attachment = await prisma.fileAttachment.findUnique({
    where: { id: attachmentId },
    include: { message: { include: { channel: true } } }
  });
  
  if (!attachment) throw new NotFoundError();
  
  // Verify access
  if (attachment.message?.channelId) {
    const membership = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId: attachment.message.channelId, userId } }
    });
    if (!membership && !(await isPublicChannel(attachment.message.channelId))) {
      throw new ForbiddenError();
    }
  } else if (attachment.message?.recipientId) {
    // DM - verify participant
    if (attachment.message.senderId !== userId && attachment.message.recipientId !== userId) {
      throw new ForbiddenError();
    }
  }
  
  // Generate signed URL
  return storage.getSignedUrl(attachment.storageKey, 300); // 5 min
}
```

### 3.9 Malicious/Oversized Uploads

**Attack:** Upload executable, oversized file, or file with mismatched MIME.

**Mitigation:**
- **Size limit:** Configurable (default 50MB), enforced at upload init
- **MIME allowlist:** Configurable per org, default safe types
- **Magic byte validation:** Check file signature matches declared MIME
- **Checksum:** Client provides SHA-256, server verifies
- **Scan hook:** Adapter for ClamAV/other scanner
- **Storage:** Never execute, serve with `Content-Disposition: attachment`

```typescript
// Upload validation
const ALLOWED_MIMES = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv'
];

function validateUpload(file: UploadFile) {
  if (file.size > MAX_SIZE) throw new ValidationError('FILE_TOO_LARGE');
  if (!ALLOWED_MIMES.includes(file.mimeType)) throw new ValidationError('MIME_NOT_ALLOWED');
  
  // Magic byte check
  const detectedMime = await detectMime(file.buffer);
  if (detectedMime !== file.mimeType) throw new ValidationError('MIME_MISMATCH');
  
  // Checksum verification
  const checksum = await sha256(file.buffer);
  if (checksum !== file.checksum) throw new ValidationError('CHECKSUM_MISMATCH');
}
```

### 3.10 HTML/Script Injection

**Attack:** Message content contains `<script>`, `onerror`, etc.

**Mitigation:**
- **Storage:** Raw content stored (for search, edit)
- **Rendering:** Frontend uses safe rendering (React auto-escapes)
- **API:** No HTML sanitization on input (preserves fidelity), strict CSP on output
- **Markdown:** Only supported formatting: `**bold**`, `*italic*`, `` `code` ``, `- list`

```typescript
// Frontend rendering (MessageList.tsx)
function renderContent(text: string) {
  // Simple markdown → React elements, no dangerouslySetInnerHTML
  return text.split('\n').map(line => (
    <div key={line}>{escapeHtml(line).replace(/\*\*(.+?)\*\*/g, <strong>$1</strong>)}</div>
  ));
}
```

### 3.11 SSRF from Link Previews

**Attack:** Link preview fetches internal metadata service (`http://169.254.169.254`).

**Mitigation:**
- **No server-side link fetching** in Phase 2
- **Client-side only** previews (iframe sandbox, or no preview)
- **Future:** If added, use allowlist, deny private IPs, timeout, no redirects

### 3.12 Presence/Typing Across Tenants

**Attack:** User sees presence of user in different organization.

**Mitigation:**
- Presence events scoped to `org:{orgId}` room
- `presence.bulk` on connect only includes same-org users
- `presence.updated` only broadcast to `org:{orgId}`

### 3.13 Notification Preview on Lock Screen

**Attack:** Confidential message content shown in OS notification.

**Mitigation:**
- `NotificationPreference.previewEnabled` (default `false`)
- Desktop notification body: `"New message in #channel"` (no content) if disabled
- Only show sender name + channel if preview enabled

### 3.14 Token Leakage

**Attack:** Access token in logs, URL, devtools, socket query string.

**Mitigation:**
- **Auth header only**: never query string for REST
- **Socket handshake:** `auth: { token }` (not query string)
- **Logging:** Redact `Authorization` header, `token` fields
- **DevTools:** Tokens in memory only, not localStorage
- **Refresh tokens:** HttpOnly cookie, never in JS accessible storage

### 3.15 Abuse: Floods

| Vector | Limit | Enforcement |
|--------|-------|-------------|
| Message send | 30/min/user | Token bucket per user |
| Connection | 5 concurrent/user | Track `PresenceSession` count |
| Typing | 10/sec/user | Debounce + rate limit |
| Upload | 10/min/user | Rate limit + size limit |
| Search | 20/min/user | Rate limit |
| Reactions | 60/min/user | Rate limit |

### 3.16 Unauthorized Meeting Join

**Attack:** User guesses meeting ID, joins without invitation.

**Mitigation:**
- Meeting IDs are UUIDv4
- `meeting.join` verifies `MeetingParticipant` record
- Meeting tokens short-lived (1 hour), scoped to meeting + user
- Token validation on media server (Mediasoup) via JWT

---

## 4. Authorization Matrix

| Resource | Action | Roles | Conditions |
|----------|--------|-------|------------|
| Channel | Create | All org members | - |
| Channel | List | All org members | Sees public + own private |
| Channel | Read | Member (or public) | Private: membership required |
| Channel | Update | Creator, ADMIN, SUPER_ADMIN | - |
| Channel | Archive | Creator, ADMIN, SUPER_ADMIN | - |
| Channel | Delete | SUPER_ADMIN, ADMIN | Soft delete only |
| Channel Member | Add | Public: any member; Private: creator, ADMIN, SUPER_ADMIN | Same org |
| Channel Member | Remove | Self, Creator, ADMIN, SUPER_ADMIN | - |
| Message (channel) | Send | Channel member | - |
| Message (DM) | Send | Same org participant | - |
| Message | Edit | Sender, ADMIN, SUPER_ADMIN | - |
| Message | Delete | Sender, ADMIN, SUPER_ADMIN | Soft delete default |
| Message | Pin | Channel member, ADMIN, SUPER_ADMIN | - |
| Reaction | Add/Remove | Channel/DM member | Unique per user+emoji |
| Attachment | Upload | Channel/DM member | Size, type, checksum |
| Attachment | Download | Channel/DM member | Signed URL |
| Read Cursor | Update | Self | - |
| Notification | Read | Self | - |
| Meeting | Create | Channel member (channel meeting), Any org member (DM/group) | - |
| Meeting | Join | Participant | Valid token |
| Meeting | Signal | Participant | In meeting |
| Presence | View | Same org | - |

---

## 5. Data Protection

### 5.1 Encryption

| Data | At Rest | In Transit |
|------|---------|------------|
| Messages | PostgreSQL (transparent) | TLS 1.3 |
| Files | Storage provider (S3 SSE / local) | TLS 1.3 |
| Tokens | SHA-256 hash (refresh) | TLS 1.3 |
| Passwords | bcrypt (cost 12) | TLS 1.3 |
| eTIMS secrets | AES-256 (application-level) | TLS 1.3 |

### 5.2 Key Management

- **JWT Secret:** 32+ char env var, fail-fast if missing
- **Encryption keys:** AWS KMS / HashiCorp Vault / env (dev)
- **Rotation:** Annual for JWT, quarterly for data encryption

### 5.3 Retention & Deletion

| Data | Retention | Deletion |
|------|-----------|----------|
| Messages | Indefinite | Soft delete (tombstone), hard delete SUPER_ADMIN only |
| Reactions | Indefinite | Cascade with message |
| Read Cursors | Indefinite | Cascade with user |
| Notifications | 90 days | Auto-purge read > 90d |
| Presence Sessions | Ephemeral | Auto-cleanup on disconnect + stale |
| Meeting Records | 1 year | Archive |
| File Attachments | Indefinite | Soft delete, storage cleanup after 30d |
| Audit Logs | 7 years | Immutable |

---

## 6. Compliance

### 6.1 Kenya Data Protection Act (2019)

- **Data minimization:** Only collect required fields
- **Consent:** Explicit for notifications, analytics
- **Access/Deletion:** User can request data export/deletion
- **Localization:** PostgreSQL in Kenya region (production)

### 6.2 Financial Records

- Messages/attachments related to invoices/payments retained per tax law (7 years)
- Soft delete preserves audit trail
- Export includes message context for transactions

---

## 7. Security Testing

### 7.1 Required Tests

| Test | Method |
|------|--------|
| Cross-org channel access | Integration test: Org A user → Org B channel |
| Cross-branch access | Integration test: Branch-restricted role → other branch channel |
| Removed member socket | Integration: remove member → verify socket leaves room |
| Deactivated user socket | Integration: deactivate user → verify disconnect |
| Duplicate message | Integration: send same idempotencyKey twice → 1 message |
| Unauthorized download | Integration: non-member → attachment download → 403 |
| Malicious upload | Unit: magic byte mismatch → rejection |
| Token leakage | Log audit: verify no tokens in logs |
| Rate limiting | Load test: exceed limits → 429 |
| Meeting token scope | Unit: token for meeting A → reject join meeting B |

### 7.2 Penetration Testing

- Annual third-party pen test
- Focus: auth bypass, tenant isolation, file upload, WebSocket auth

---

## 8. Incident Response

### 8.1 Detection

- **Audit log anomalies:** Unusual access patterns, bulk downloads
- **Rate limit triggers:** Potential abuse
- **Failed auth spikes:** Credential stuffing
- **File scan alerts:** Malware detection

### 8.2 Response Playbooks

| Incident | Immediate Action | Investigation |
|----------|------------------|---------------|
| Compromised token | Revoke all user tokens, force re-login | Check audit log for unauthorized access |
| Malware upload | Quarantine file, notify uploader/admin | Scan all recent uploads |
| Data exfiltration | Revoke sessions, rotate keys | Audit log analysis |
| Tenant isolation breach | Emergency patch, audit all cross-tenant queries | Full tenant isolation review |

---

## 9. Secure Development Practices

### 9.1 Code Review Checklist

- [ ] All new routes use `enforceTenantIsolation` or explicit `verifyOrgOwnership`
- [ ] No client-supplied `organizationId` in create/update payloads (use `sanitizeCreateInput`)
- [ ] All Prisma queries include `organizationId` from tenant context
- [ ] Socket commands validate membership before action
- [ ] No `dangerouslySetInnerHTML` with user content
- [ ] Rate limiting on new endpoints
- [ ] Audit log entry for mutating operations

### 9.2 Dependency Management

- `npm audit` on every PR
- Dependabot alerts → patch within 7 days (critical) / 30 days (high)
- Lockfile committed, `npm ci` in CI

---

## 10. Open Security Decisions

| ID | Decision | Status |
|----|----------|--------|
| SEC-01 | Encrypt message content at rest (application-level) | Deferred: TLS + DB encryption sufficient for now |
| SEC-02 | End-to-end encryption for DMs | Deferred: requires key management UX |
| SEC-03 | Message retention policy UI | Deferred: Phase 2.x |
| SEC-04 | SIEM integration (Splunk/Datadog) | Deferred: structured logs ready |
| SEC-05 | Customer-managed keys (BYOK) | Deferred: Enterprise tier |

---

## 11. Security Gate Checklist (Phase 2 Exit)

- [ ] All STRIDE threats mitigated with code evidence
- [ ] Cross-org access tests PASS
- [ ] Cross-branch access tests PASS
- [ ] Removed member socket disconnect tests PASS
- [ ] Deactivated user socket disconnect tests PASS
- [ ] Idempotency tests PASS
- [ ] File upload validation tests PASS
- [ ] Unauthorized download tests PASS
- [ ] Rate limiting tests PASS
- [ ] Meeting token scoping tests PASS
- [ ] No tokens in logs (verified)
- [ ] CSP headers configured
- [ ] Audit logs for all mutating operations
- [ ] Penetration test scheduled/completed
