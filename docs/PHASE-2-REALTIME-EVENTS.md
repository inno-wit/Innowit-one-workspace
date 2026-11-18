# PHASE 2 REALTIME EVENTS: INNOWIT ONE COLLABORATION ENGINE

**Version:** 2.0 (As-Built)  
**Date:** 2026-11-18  
**Status:** As-Built (Closeout Verified)  
**Transport:** Socket.IO v4.x  
**Protocol:** WebSocket (WSS in production) with HTTP long-polling fallback  
**Closeout Commit:** `930091af2abbd7cd4d8e3939f1db87b99e77c993`

---

## 1. Connection & Authentication

### 1.1 Connection URL

```
wss://api.innowit.one/socket.io/?token=<access_token>&transport=websocket
```

### 1.2 Handshake

```javascript
// Client
const socket = io('https://api.innowit.one', {
  auth: { token: accessToken },
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000
});

// Server validates token in middleware (see PHASE-2-ARCHITECTURE.md §6.1)
```

### 1.3 Connection Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `connect` | Client→Server | Socket connected (before auth) |
| `authenticate` | Client→Server | **Required first event** after connect |
| `authenticated` | Server→Client | Auth success, includes user + initial presence |
| `authentication_failed` | Server→Client | Auth failed, includes error code |
| `disconnect` | Both | Connection lost |
| `connect_error` | Client | Connection failed |
| `reconnect` | Client | Reconnected after disconnect |
| `reconnect_attempt` | Client | Attempting reconnect |
| `reconnect_failed` | Client | Max reconnect attempts reached |

### 1.4 Authenticate Payload

```typescript
// Client → Server
socket.emit('authenticate', { token: 'eyJhbGciOiJIUzI1NiIs...' });

// Server → Client (success)
socket.on('authenticated', (data) => {
  // data = {
  //   user: { userId, organizationId, branchId, role, email, fullName },
  //   presence: { userId, status: 'ONLINE', sessions: 2 },
  //   unreadCounts: { channels: {}, conversations: {}, total: 5, mentions: 1 },
  //   serverTime: '2026-11-18T10:30:00.000Z'
  // }
});

// Server → Client (failure)
socket.on('authentication_failed', (error) => {
  // error = { code: 'INVALID_TOKEN', message: 'Token expired' }
  // Client should refresh token and retry, or redirect to login
});
```

---

## 2. Room Management

### 2.1 Room Naming Convention

| Room Pattern | Scope | Auto-joined | Manual Join |
|-------------|-------|-------------|-------------|
| `user:{userId}` | Personal | ✅ On auth | No |
| `org:{orgId}` | Organization | ✅ On auth | No |
| `channel:{channelId}` | Channel | ❌ | `subscribe` |
| `dm:{conversationId}` | Direct Message | ❌ | `subscribe` |
| `meeting:{meetingId}` | Meeting | ❌ | `meeting.join` |

### 2.2 Subscribe to Channel

```typescript
// Client → Server
socket.emit('subscribe', { channelId: 'ch_general' }, (ack) => {
  // ack = { ok: true, data: { channelId, readCursor, members }, eventId }
  // or { ok: false, error: { code: 'FORBIDDEN', message: 'Not a member' } }
});

// Server validates membership, joins room, returns read cursor
```

### 2.3 Subscribe to DM

```typescript
// Client → Server
socket.emit('subscribe', { conversationId: 'conv_usr_1_usr_2' }, (ack) => {
  // ack = { ok: true, data: { conversationId, readCursor, participants }, eventId }
});
```

### 2.4 Unsubscribe

```typescript
// Client → Server
socket.emit('unsubscribe', { channelId: 'ch_general' }, (ack) => {
  // ack = { ok: true, eventId }
});

// Server leaves room, stops sending events for that channel
```

### 2.5 Room Membership Rules

- **Server derives room names**: clients never construct room names
- **Authorization verified** before joining any room
- **Auto-leave** on disconnect, membership removal, deactivation
- **Max rooms per connection:** 50 channels + 20 DMs + 5 meetings

---

## 3. Event Catalog v1

### 3.1 Server → Client Events

#### 3.1.1 Message Events

```typescript
// message.created
{
  event: 'message.created',
  payload: {
    message: Message,           // Full message object
    temporaryId?: string        // Client's temporary ID for optimistic UI reconciliation
  },
  eventId: 'evt_abc123',
  timestamp: '2026-11-18T10:30:00.000Z'
}

// message.updated
{
  event: 'message.updated',
  payload: {
    messageId: 'msg_123',
    content: 'Updated content',
    editedAt: '2026-11-18T10:35:00.000Z',
    editedById: 'usr_super_01',
    editedByName: 'Kimani Mwangi'
  },
  eventId: 'evt_abc124',
  timestamp: '2026-11-18T10:35:00.000Z'
}

// message.deleted
{
  event: 'message.deleted',
  payload: {
    messageId: 'msg_123',
    deletedAt: '2026-11-18T10:40:00.000Z',
    deletedById: 'usr_super_01',
    hard: false  // true = hard delete (admin only)
  },
  eventId: 'evt_abc125',
  timestamp: '2026-11-18T10:40:00.000Z'
}

// message.reaction.updated
{
  event: 'message.reaction.updated',
  payload: {
    messageId: 'msg_123',
    emoji: '🚀',
    count: 5,
    users: ['usr_super_01', 'usr_exec_03', ...],
    added: true,  // false = removed
    actorId: 'usr_sales_rep_07'
  },
  eventId: 'evt_abc126',
  timestamp: '2026-11-18T10:45:00.000Z'
}
```

#### 3.1.2 Channel Events

```typescript
// channel.created
{ event: 'channel.created', payload: { channel: Channel }, eventId, timestamp }

// channel.updated
{ event: 'channel.updated', payload: { channelId, changes: Partial<Channel> }, eventId, timestamp }

// channel.archived
{ event: 'channel.archived', payload: { channelId, archivedAt }, eventId, timestamp }

// channel.member.added
{
  event: 'channel.member.added',
  payload: { channelId, member: ChannelMember & { user: User } },
  eventId, timestamp
}

// channel.member.removed
{
  event: 'channel.member.removed',
  payload: { channelId, userId, removedById, removedByName },
  eventId, timestamp
}

// channel.member.updated
{
  event: 'channel.member.updated',
  payload: { channelId, userId, role: ChannelRole },
  eventId, timestamp
}
```

#### 3.1.3 Conversation (DM) Events

```typescript
// conversation.created
{ event: 'conversation.created', payload: { conversation: Conversation, otherUser: User }, eventId, timestamp }

// conversation.member.updated
{ event: 'conversation.member.updated', payload: { conversationId, userId, role }, eventId, timestamp }
```

#### 3.1.4 Read State Events

```typescript
// conversation.read.updated
{
  event: 'conversation.read.updated',
  payload: {
    conversationId: 'ch_general',  // or dm conversationId
    userId: 'usr_super_01',
    lastReadMessageId: 'msg_123',
    unreadCount: 0
  },
  eventId, timestamp
}
```

#### 3.1.5 Presence Events

```typescript
// presence.updated (single user)
{
  event: 'presence.updated',
  payload: {
    userId: 'usr_super_01',
    status: 'ONLINE',  // ONLINE | AWAY | OFFLINE
    lastSeen: '2026-11-18T10:30:00.000Z',  // null if ONLINE
    sessions: 2
  },
  eventId, timestamp
}

// presence.bulk (on connect)
{
  event: 'presence.bulk',
  payload: {
    presences: [
      { userId: 'usr_1', status: 'ONLINE', lastSeen: null, sessions: 1 },
      { userId: 'usr_2', status: 'AWAY', lastSeen: '2026-11-18T10:25:00.000Z', sessions: 1 }
    ]
  },
  eventId, timestamp
}
```

#### 3.1.6 Typing Events

```typescript
// typing.started
{
  event: 'typing.started',
  payload: {
    conversationId: 'ch_general',  // or dm conversationId
    userId: 'usr_super_01',
    userName: 'Kimani Mwangi'
  },
  eventId, timestamp
}

// typing.stopped
{
  event: 'typing.stopped',
  payload: {
    conversationId: 'ch_general',
    userId: 'usr_super_01'
  },
  eventId, timestamp
}
```

#### 3.1.7 Notification Events

```typescript
// notification.created
{
  event: 'notification.created',
  payload: {
    notification: Notification  // Full notification object
  },
  eventId, timestamp
}

// notification.read
{
  event: 'notification.read',
  payload: { notificationId: 'notif_123' },
  eventId, timestamp
}
```

#### 3.1.8 Attachment Events

```typescript
// attachment.uploaded
{
  event: 'attachment.uploaded',
  payload: {
    attachment: FileAttachment,
    messageId: 'msg_123'  // If attached to message
  },
  eventId, timestamp
}
```

#### 3.1.9 Meeting Events

```typescript
// meeting.participant.joined
{
  event: 'meeting.participant.joined',
  payload: {
    meetingId: 'mtg_123',
    participant: MeetingParticipant & { user: User }
  },
  eventId, timestamp
}

// meeting.participant.left
{
  event: 'meeting.participant.left',
  payload: { meetingId, userId, leftAt },
  eventId, timestamp
}

// meeting.ended
{
  event: 'meeting.ended',
  payload: { meetingId, endedAt, endedById },
  eventId, timestamp
}
```

---

### 3.2 Client → Server Commands

#### 3.2.1 Message Commands

```typescript
// sendMessage
socket.emit('sendMessage', {
  temporaryId: 'temp_abc123',  // For optimistic UI reconciliation
  channelId: 'ch_general',     // XOR with recipientId
  recipientId: 'usr_2',        // XOR with channelId
  content: 'Hello!',
  parentId: 'msg_123',         // Optional: thread reply
  idempotencyKey: 'uuid-v4'    // Required
}, (ack) => {
  // ack = { ok: true, data: { messageId, createdAt }, eventId }
  // or { ok: false, error: { code, message }, eventId }
});

// editMessage
socket.emit('editMessage', { messageId: 'msg_123', content: 'Updated' }, (ack) => { ... });

// deleteMessage
socket.emit('deleteMessage', { messageId: 'msg_123', hard: false }, (ack) => { ... });

// pinMessage
socket.emit('pinMessage', { messageId: 'msg_123' }, (ack) => { ... });

// unpinMessage
socket.emit('unpinMessage', { messageId: 'msg_123' }, (ack) => { ... });

// addReaction
socket.emit('addReaction', { messageId: 'msg_123', emoji: '🚀' }, (ack) => { ... });

// removeReaction
socket.emit('removeReaction', { messageId: 'msg_123', emoji: '🚀' }, (ack) => { ... });
```

#### 3.2.2 Thread Commands

```typescript
// fetchThread (for lazy loading)
socket.emit('fetchThread', { parentId: 'msg_123', cursor: 'rep_10', limit: 50 }, (ack) => {
  // ack = { ok: true, data: { replies: Message[], hasMore: boolean, nextCursor }, eventId }
});
```

#### 3.2.3 Read State Commands

```typescript
// markRead
socket.emit('markRead', { channelId: 'ch_general', messageId: 'msg_123' }, (ack) => { ... });
// or for DM
socket.emit('markRead', { conversationId: 'conv_usr_1_usr_2', messageId: 'msg_123' }, (ack) => { ... });
```

#### 3.2.4 Typing Commands

```typescript
// typing.start
socket.emit('typing.start', { channelId: 'ch_general' });
// or DM
socket.emit('typing.start', { conversationId: 'conv_usr_1_usr_2' });

// typing.stop
socket.emit('typing.stop', { channelId: 'ch_general' });
// Server also auto-stops after 5s timeout if no typing.stop received
```

#### 3.2.5 Presence Commands

```typescript
// heartbeat (sent every 30s by client)
socket.emit('heartbeat', { status: 'ONLINE' });  // or 'AWAY'

// Server responds with ack
// { ok: true, eventId, serverTime: '2026-11-18T10:30:00.000Z' }
```

#### 3.2.6 Meeting Commands

```typescript
// meeting.join
socket.emit('meeting.join', { meetingId: 'mtg_123' }, (ack) => {
  // ack = { ok: true, data: { meeting, participants, credentials }, eventId }
});

// meeting.leave
socket.emit('meeting.leave', { meetingId: 'mtg_123' }, (ack) => { ... });

// meeting.signal (WebRTC signaling)
socket.emit('meeting.signal', { meetingId: 'mtg_123', toUserId: 'usr_2', signal: { type: 'offer', sdp: '...' } }, (ack) => { ... });
// Server forwards to recipient's user:{userId} room
```

---

## 4. Acknowledgement Contract

Every command receives an acknowledgement callback:

```typescript
// Success
{ ok: true, data: T, eventId: string, serverTime: string }

// Error
{ ok: false, error: { code: string, message: string }, eventId: string }
```

### 4.1 Error Codes (Realtime)

| Code | Description |
|------|-------------|
| UNAUTHENTICATED | Not authenticated or token expired |
| FORBIDDEN | Not authorized for this action |
| NOT_FOUND | Resource not found |
| VALIDATION_ERROR | Payload validation failed |
| ALREADY_EXISTS | Duplicate (reaction, membership) |
| IDEMPOTENCY_CONFLICT | Idempotency key mismatch |
| RATE_LIMITED | Too many commands |
| SERVER_ERROR | Internal server error |
| MEETING_FULL | Meeting at capacity |
| MEETING_ENDED | Meeting already ended |

---

## 5. Idempotency & Reliability

### 5.1 Message Idempotency

- Client generates UUIDv4 `idempotencyKey` for each `sendMessage`
- Server checks: `Message.findUnique({ where: { idempotencyKey_userId_channelId: { ... } } })`
- If exists: returns existing message (200 OK with `ok: true`, `data.existing: true`)
- If not: creates message, stores key, returns new message

### 5.2 Duplicate Detection

| Operation | Duplicate Key |
|-----------|---------------|
| sendMessage | `idempotencyKey` + `senderId` + `channelId`/`recipientId` |
| addReaction | Unique constraint on (messageId, userId, emoji) |
| subscribe | Server tracks joined rooms, ignores duplicate join |

### 5.3 Reconnect Synchronization

On reconnect (`reconnect` event):

```typescript
// Client automatically re-sends authenticate
// Server responds with authenticated + presence.bulk

// Client should:
// 1. Re-subscribe to all previously joined channels/DMs
// 2. For each, fetch messages since last read cursor
// 3. Reconcile optimistic messages (match temporaryId)

socket.on('reconnect', () => {
  // Re-authenticate
  socket.emit('authenticate', { token: getAccessToken() });
});

socket.on('authenticated', (data) => {
  // Re-subscribe
  subscribedChannels.forEach(ch => socket.emit('subscribe', { channelId: ch }));
  subscribedDMs.forEach(dm => socket.emit('subscribe', { conversationId: dm }));
  
  // Fetch missed messages
  subscribedChannels.forEach(ch => {
    const cursor = readCursors[ch];
    if (cursor) fetchMessagesSince(ch, cursor.lastReadMessageId);
  });
});
```

### 5.4 Message Ordering

- Server assigns monotonically increasing `sequenceNumber` per channel/conversation
- Events include `sequenceNumber` for client-side ordering
- Client buffers out-of-order events, flushes in sequence

---

## 6. Connection Lifecycle

### 6.1 States

```
DISCONNECTED
    │
    ▼ (connect)
CONNECTING
    │
    ▼ (authenticate + success)
AUTHENTICATED ──────────────────┐
    │                            │
    ▼ (disconnect/error)         │ (reconnect)
DISCONNECTED                     │
    │                            │
    ▼ (reconnect)                │
RECONNECTING                     │
    │                            │
    ▼ (authenticate + success)   │
AUTHENTICATED ◄──────────────────┘
```

### 6.2 Heartbeat & Timeouts

| Parameter | Value | Description |
|-----------|-------|-------------|
| `pingInterval` | 25,000ms | Server→Client ping |
| `pingTimeout` | 20,000ms | Wait for pong |
| Client heartbeat | 30,000ms | Client→Server `heartbeat` event |
| Presence stale | 90,000ms | 3 missed heartbeats → AWAY |
| Presence offline | 300,000ms | 5 min no heartbeat → OFFLINE |

### 6.3 Graceful Disconnect

```typescript
// Client
socket.on('disconnect', (reason) => {
  // reason: 'io server disconnect', 'io client disconnect', 'transport close', etc.
  if (reason === 'io server disconnect') {
    // Server forcibly disconnected (token revoked, banned)
    // Don't auto-reconnect, redirect to login
  }
});

// Server-initiated disconnect (e.g., token revoked)
socket.emit('authentication_failed', { code: 'TOKEN_REVOKED', message: 'Session revoked' });
socket.disconnect(true);
```

---

## 7. Scalability Considerations

### 7.1 Single Instance (Current)

- In-memory room management
- In-memory PresenceSession tracking
- Socket.IO default adapter

### 7.2 Horizontal Scaling (Future)

```typescript
// With Redis adapter
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();

io.adapter(createAdapter(pubClient, subClient));

// PresenceSession stored in Redis with TTL
// Rate limiting via Redis
// Session affinity NOT required
```

---

## 8. Client Implementation Guide

### 8.1 Reconnection Logic

```typescript
const socket = io(url, {
  auth: { token: getAccessToken() },
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  randomizationFactor: 0.5
});

let pendingSubscriptions = new Set();

socket.on('authenticated', (data) => {
  // Restore subscriptions
  pendingSubscriptions.forEach(sub => {
    socket.emit('subscribe', sub);
  });
  pendingSubscriptions.clear();
});

function subscribe(channelId) {
  if (socket.connected) {
    socket.emit('subscribe', { channelId });
  } else {
    pendingSubscriptions.add({ channelId });
  }
}
```

### 8.2 Optimistic UI Updates

```typescript
function sendMessage(content, channelId) {
  const temporaryId = `temp_${Date.now()}_${Math.random()}`;
  const idempotencyKey = crypto.randomUUID();
  
  // Optimistic add
  addMessageToUI({ id: temporaryId, content, status: 'sending', ... });
  
  socket.emit('sendMessage', { temporaryId, channelId, content, idempotencyKey }, (ack) => {
    if (ack.ok) {
      if (ack.data.existing) {
        // Server deduplicated, update UI with server message
        replaceOptimisticMessage(temporaryId, ack.data.message);
      } else {
        // Confirm sent
        updateMessageStatus(temporaryId, 'sent', ack.data.messageId);
      }
    } else {
      // Failed - show error, allow retry
      updateMessageStatus(temporaryId, 'failed', ack.error);
    }
  });
}
```

---

## 9. Testing Events

### 9.1 Event Schema Validation

All events validated with Zod schemas on server. Client should handle unknown events gracefully.

### 9.2 Test Scenarios

| Scenario | Events to Verify |
|----------|------------------|
| Connect + auth | `connect` → `authenticate` → `authenticated` |
| Join channel | `subscribe` ack → `channel.member.added` to others |
| Send message | `sendMessage` ack → `message.created` to room |
| Edit message | `editMessage` ack → `message.updated` to room |
| Reaction | `addReaction` ack → `message.reaction.updated` to room |
| Typing | `typing.start` → `typing.started` to others → `typing.stop` → `typing.stopped` |
| Presence | `heartbeat` → `presence.updated` to org room |
| Reconnect | `reconnect` → `authenticate` → `authenticated` → `presence.bulk` → resubscribe |
| DM | `subscribe` (conversationId) → `conversation.created` if new |

---

## 10. Versioning

- **v1** (current): Events as documented
- **Breaking changes:** New event version in payload `v: 2`
- **Deprecation:** 6 months, `Deprecation` header on REST, event `deprecated: true` in realtime
- **Client compatibility:** Server supports last 2 client versions
