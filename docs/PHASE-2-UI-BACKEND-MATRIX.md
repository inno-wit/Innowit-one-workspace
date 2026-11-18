# PHASE 2 UI-TO-BACKEND SOURCE-OF-TRUTH MATRIX

**Generated:** 2026-11-18  
**Scope:** Every collaboration screen/feature mapped to canonical backend paths

---

## Matrix Legend

| Column | Meaning |
|---|---|
| **Screen/Feature** | User-facing route, component, or capability |
| **Route** | Frontend URL path |
| **Data Displayed** | What the user sees |
| **Canonical Source** | Single source of truth (PostgreSQL table/view) |
| **Read Path** | REST endpoint or service method |
| **Write Path** | REST endpoint or service method |
| **Realtime Events** | Socket.IO events for live updates |
| **Auth Boundary** | Who can access (role/membership) |
| **Persistence** | Survives app restart? Survives second-client change? |
| **Test Evidence** | Integration test coverage |
| **Gap** | Known issue or missing coverage |

---

## 1. Channels

### 1.1 Channel List
| Attribute | Value |
|---|---|
| **Screen** | Channel List Sidebar + Channel List View |
| **Route** | `/collaboration/channels` |
| **Data Displayed** | Channel name, description, member count, unread badge, archive status, private/public icon |
| **Canonical Source** | `Channel` + `ChannelMember` (join) |
| **Read Path** | `GET /api/channels` → `CollaborationService.listChannels()` |
| **Write Path** | `POST /api/channels` → `CollaborationService.createChannel()` |
| **Realtime** | `channel.created`, `channel.updated`, `channel.archived`, `channel.member.added/removed` |
| **Auth** | Org member; sees public channels + own private channels |
| **Persistence** | ✅ Full PostgreSQL; survives restart; second client sees same list |
| **Tests** | `channels.integration.test.ts` (24 tests) |
| **Gap** | None |

### 1.2 Channel Detail View
| Attribute | Value |
|---|---|
| **Screen** | Channel Messages View |
| **Route** | `/collaboration/channels/:id` |
| **Data Displayed** | Messages, thread replies, reactions, pins, typing indicator, member avatars |
| **Canonical Source** | `Message` (channelId) + `Reaction` + `ChannelMember` |
| **Read Path** | `GET /api/messages?channelId=:id` → `CollaborationService.listMessages()` |
| **Write Path** | `POST /api/messages` (send), `PUT/DELETE /api/messages/:id` (edit/delete), `POST /reactions`, `POST/DELETE /pin` |
| **Realtime** | `message.created`, `message.updated`, `message.deleted`, `message.reaction.updated`, `typing.started/stopped` |
| **Auth** | Channel member (or public channel) |
| **Persistence** | ✅ Full PostgreSQL; survives restart; second client sees same messages |
| **Tests** | `messages.integration.test.ts` (23 tests) |
| **Gap** | None |

### 1.3 Channel Membership Management
| Attribute | Value |
|---|---|
| **Screen** | Channel Settings Modal → Members Tab |
| **Route** | `/collaboration/channels/:id/settings` |
| **Data Displayed** | Member list, roles, join date, remove button |
| **Canonical Source** | `ChannelMember` + `User` |
| **Read Path** | `GET /api/channels/:id/members` → `CollaborationService.listMembers()` |
| **Write Path** | `POST /api/channels/:id/members` (add), `DELETE /api/channels/:id/members/:userId` (remove), `PUT /role` |
| **Realtime** | `channel.member.added`, `channel.member.removed`, `channel.member.updated` |
| **Auth** | Creator/Admin can add/remove; members can self-remove |
| **Persistence** | ✅ PostgreSQL; immediate revocation on removal |
| **Tests** | `channels.integration.test.ts` (6 membership tests) |
| **Gap** | Invitation flow for private channels (UI only) |

### 1.4 Channel Archive/Delete
| Attribute | Value |
|---|---|
| **Screen** | Channel Settings Modal → Danger Zone |
| **Route** | `/collaboration/channels/:id/settings` |
| **Data Displayed** | Archive button, Delete button (creator/admin) |
| **Canonical Source** | `Channel.isArchived`, `Channel.archivedAt` |
| **Read Path** | `GET /api/channels/:id` |
| **Write Path** | `POST /api/channels/:id/archive`, `DELETE /api/channels/:id` |
| **Realtime** | `channel.archived` |
| **Auth** | Creator or Admin |
| **Persistence** | ✅ Soft archive (isArchived flag); hard delete removes record |
| **Tests** | `channels.integration.test.ts` (2 archive tests) |
| **Gap** | None |

---

## 2. Direct Messages (DMs)

### 2.1 DM Conversation List
| Attribute | Value |
|---|---|
| **Screen** | DM Sidebar + DM List View |
| **Route** | `/collaboration/dms` |
| **Data Displayed** | Other participant name/avatar, last message preview, unread count, timestamp |
| **Canonical Source** | `Conversation` (type=DIRECT) + `ConversationParticipant` + `Message` (last) + `ReadCursor` |
| **Read Path** | `GET /api/conversations` → `conversations.ts` route (lines 26-127) |
| **Write Path** | `POST /api/conversations` (create-or-open) |
| **Realtime** | `conversation.created`, `message.created` (updates last message) |
| **Auth** | Org member; sees only own conversations |
| **Persistence** | ✅ PostgreSQL; survives restart; second client sees same list |
| **Tests** | `messages.integration.test.ts` (DM tests) |
| **Gap** | Group DM list not separated in UI |

### 2.2 DM Conversation View
| Attribute | Value |
|---|---|
| **Screen** | DM Messages View |
| **Route** | `/collaboration/dms/:id` |
| **Data Displayed** | Messages, thread replies, reactions, pins, typing indicator |
| **Canonical Source** | `Message` (conversationId) + `Reaction` + `ConversationParticipant` |
| **Read Path** | `GET /api/messages?conversationId=:id` → `CollaborationService.listMessages()` |
| **Write Path** | `POST /api/messages` (with conversationId or recipientId) |
| **Realtime** | `message.created`, `message.updated`, `message.deleted`, `message.reaction.updated`, `typing.started/stopped` |
| **Auth** | Conversation participant |
| **Persistence** | ✅ PostgreSQL; survives restart; second client sees same messages |
| **Tests** | `messages.integration.test.ts` (DM tests) |
| **Gap** | None |

### 2.3 DM Create-or-Open
| Attribute | Value |
|---|---|
| **Screen** | New DM Dialog (from sidebar + button) |
| **Route** | `/collaboration/dms/new` → `POST /api/conversations` |
| **Data Displayed** | User picker (org members), create button |
| **Canonical Source** | `Conversation` + `ConversationParticipant` |
| **Read Path** | `GET /api/conversations` (check existing) |
| **Write Path** | `POST /api/conversations` → deterministic create-or-open |
| **Realtime** | `conversation.created` (to both participants) |
| **Auth** | Org member; cannot DM self; cross-org blocked |
| **Persistence** | ✅ Stable conversation ID; idempotent |
| **Tests** | `messages.integration.test.ts` (create-or-open tests) |
| **Gap** | None |

---

## 3. Messages & Threads

### 3.1 Message Send (Channel & DM)
| Attribute | Value |
|---|---|
| **Screen** | Message Composer (footer of channel/DM view) |
| **Route** | `POST /api/messages` |
| **Data Displayed** | Composer input, send button, attachment button |
| **Canonical Source** | `Message` |
| **Read Path** |: |
| **Write Path** | `POST /api/messages` → `CollaborationService.sendMessage()` (idempotent) |
| **Realtime** | `message.created` (with temporaryId for optimistic UI) |
| **Auth** | Channel member / DM participant |
| **Persistence** | ✅ PostgreSQL; idempotency key prevents duplicates |
| **Tests** | `messages.integration.test.ts` (6 channel + 3 DM send tests) |
| **Gap** | Optimistic UI reconciliation on reconnect |

### 3.2 Message Edit/Delete
| Attribute | Value |
|---|---|
| **Screen** | Message hover menu → Edit/Delete |
| **Route** | `PUT/DELETE /api/messages/:id` |
| **Data Displayed** | Edit: inline composer; Delete: confirmation |
| **Canonical Source** | `Message` (editedAt, editedById, deletedAt, deletedById, content='[Deleted]') |
| **Read Path** | `GET /api/messages/:id` |
| **Write Path** | `PUT /api/messages/:id` (edit), `DELETE /api/messages/:id` (soft delete) |
| **Realtime** | `message.updated`, `message.deleted` |
| **Auth** | Sender or Admin |
| **Persistence** | ✅ Soft delete (tombstone); edit history via editedAt/editedById |
| **Tests** | `messages.integration.test.ts` (2 edit + 1 delete tests) |
| **Gap** | Hard delete (Admin only) not exposed in UI |

### 3.3 Thread Replies
| Attribute | Value |
|---|---|
| **Screen** | Thread side panel (click reply count) |
| **Route** | `GET /api/messages?parentId=:id` |
| **Data Displayed** | Parent message + chronological replies |
| **Canonical Source** | `Message` (parentId, threadRootId) |
| **Read Path** | `GET /api/messages?parentId=:id` or `CollaborationService.getThread()` |
| **Write Path** | `POST /api/messages` with `parentId` |
| **Realtime** | `message.created` (with parentId) |
| **Auth** | Channel member / DM participant |
| **Persistence** | ✅ PostgreSQL; threadRootId enables flat queries |
| **Tests** | `messages.integration.test.ts` (implicit in message tests) |
| **Gap** | Thread unread count not separately tracked |

---

## 4. Reactions & Pins

### 4.1 Reactions
| Attribute | Value |
|---|---|
| **Screen** | Message hover → emoji picker |
| **Route** | `POST/DELETE /api/messages/:id/reactions` |
| **Data Displayed** | Emoji + count + user avatars on hover |
| **Canonical Source** | `Reaction` (unique: messageId + userId + emoji) |
| **Read Path** | Included in `GET /api/messages` + `GET /api/messages/:id` |
| **Write Path** | `POST /api/messages/:id/reactions` (idempotent), `DELETE /api/messages/:id/reactions/:emoji` |
| **Realtime** | `message.reaction.updated` |
| **Auth** | Channel member / DM participant |
| **Persistence** | ✅ PostgreSQL; unique constraint prevents duplicates |
| **Tests** | `messages.integration.test.ts` (4 reaction tests) |
| **Gap** | None |

### 4.2 Pins
| Attribute | Value |
|---|---|
| **Screen** | Message hover → Pin/Unpin; Pinned messages bar |
| **Route** | `POST/DELETE /api/messages/:id/pin` |
| **Data Displayed** | Pinned badge on message; pinned messages sidebar |
| **Canonical Source** | `Message.isPinned` |
| **Read Path** | `GET /api/messages?channelId=:id` (includes isPinned) |
| **Write Path** | `POST /api/messages/:id/pin`, `DELETE /api/messages/:id/pin` |
| **Realtime** | `message.updated` (isPinned change) |
| **Auth** | Channel member (or Admin) |
| **Persistence** | ✅ PostgreSQL; survives restart |
| **Tests** | `messages.integration.test.ts` (2 pin tests) |
| **Gap** | Pinned messages list endpoint not separate |

---

## 5. Attachments

### 5.1 Attachment Upload
| Attribute | Value |
|---|---|
| **Screen** | Message Composer → Attach button → File picker |
| **Route** | `POST /api/attachments/init` → `PUT uploadUrl` → `POST /api/attachments/:id/complete` |
| **Data Displayed** | Upload progress, file preview, cancel button |
| **Canonical Source** | `FileAttachment` (storagePath, checksum, uploadStatus) |
| **Read Path** | `GET /api/attachments/:id` |
| **Write Path** | `POST /api/attachments/init` → `AttachmentService.initUpload()` |
| **Realtime** | `attachment.uploaded` (after complete) |
| **Auth** | Channel member / DM participant |
| **Persistence** | ✅ PostgreSQL + storage (local/S3); checksum verified |
| **Tests** | `attachments.integration.test.ts` (7 tests) |
| **Gap** | Malware scanning adapter not configured |

### 5.2 Attachment Download/Preview
| Attribute | Value |
|---|---|
| **Screen** | Message attachment preview → Download button |
| **Route** | `GET /api/attachments/:id/download` |
| **Data Displayed** | File name, size, type, preview (image/PDF) |
| **Canonical Source** | `FileAttachment` + storage |
| **Read Path** | `GET /api/attachments/:id` (metadata), `GET /api/attachments/:id/download` (stream) |
| **Write Path** |: |
| **Realtime** |: |
| **Auth** | Channel member / DM participant (verified on every download) |
| **Persistence** | ✅ Storage + PostgreSQL metadata |
| **Tests** | `attachments.integration.test.ts` (download + metadata tests) |
| **Gap** | Signed URL expiry not enforced in local provider |

---

## 6. Notifications

### 6.1 Notification Center
| Attribute | Value |
|---|---|
| **Screen** | Notification Bell → Dropdown/List |
| **Route** | `/notifications` |
| **Data Displayed** | Title, body, timestamp, read status, action link |
| **Canonical Source** | `Notification` |
| **Read Path** | `GET /api/notifications` |
| **Write Path** | `POST /api/notifications/:id/read` |
| **Realtime** | `notification.created`, `notification.read` |
| **Auth** | Recipient only |
| **Persistence** | ✅ PostgreSQL; survives restart; unread count badge |
| **Tests** | `notifications.integration.test.ts` (8 tests) |
| **Gap** | Desktop notification click deep-link not verified |

### 6.2 Notification Triggers
| Trigger | Type | Recipients | Persistence |
|---|---|---|---|
| Mention (@user) | MENTION | Mentioned users | ✅ |
| Direct Message | DIRECT_MESSAGE | Recipient (if not active) | ✅ |
| Thread Reply | THREAD_REPLY | Thread participants | ✅ |
| Reaction on own message | REACTION | Message author | ✅ |
| Channel Invite | CHANNEL_INVITE | Invited user | ✅ |
| Message Pinned | MESSAGE_PINNED | Channel members | ✅ |
| Huddle Started | HUDDLE_STARTED | Channel members | ✅ |
| File Shared | FILE_SHARED | Conversation members | ✅ |
| System | SYSTEM | Targeted users | ✅ |

---

## 7. Presence & Typing

### 7.1 Presence
| Attribute | Value |
|---|---|
| **Screen** | User avatars (sidebar, message headers, DM list) |
| **Route** | `GET /api/presence` (initial), Socket.IO |
| **Data Displayed** | Green/amber/gray dot, "Active now", "Away", "Offline" |
| **Canonical Source** | `PresenceSession` (ephemeral) |
| **Read Path** | `GET /api/presence` → `PresenceService.getPresence()` |
| **Write Path** | Socket.IO `heartbeat` (every 30s) |
| **Realtime** | `presence.updated`, `presence.bulk` (on connect) |
| **Auth** | Org member |
| **Persistence** | ❌ Ephemeral (in-memory + DB TTL); survives restart = fresh |
| **Tests** | `realtime.integration.test.ts` (presence tests) |
| **Gap** | Multi-session "online if any session active" verified |

### 7.2 Typing Indicators
| Attribute | Value |
|---|---|
| **Screen** | "user is typing..." below composer |
| **Route** | Socket.IO `typing.start` / `typing.stop` |
| **Data Displayed** | "User is typing..." (expires after 5s idle) |
| **Canonical Source** | Ephemeral (in-memory only) |
| **Read Path** |: |
| **Write Path** | Socket.IO `typing.start` / `typing.stop` |
| **Realtime** | `typing.started`, `typing.stopped` (to conversation room) |
| **Auth** | Conversation participant |
| **Persistence** | ❌ Ephemeral; not in DB |
| **Tests** | `realtime.integration.test.ts` (typing tests) |
| **Gap** | Server-side expiry (5s) enforced |

---

## 8. Meetings/Huddles (Phase 2.6: BLOCKED)

| Attribute | Value |
|---|---|
| **Screen** | Huddle button (channel header) → Meeting modal |
| **Route** | `POST /api/meetings`, `GET /api/meetings/:id`, Socket.IO `meeting.join/leave/signal` |
| **Data Displayed** | Join/Leave buttons, participant list, mute/video toggles (disabled) |
| **Canonical Source** | `Meeting` + `MeetingParticipant` |
| **Read Path** | `GET /api/meetings` (channel), `GET /api/meetings/:id` |
| **Write Path** | `POST /api/meetings` (create), Socket.IO `meeting.join` |
| **Realtime** | `meeting.participant.joined/left`, `meeting.ended`, `meeting.signal` |
| **Auth** | Channel member (channel meeting) / Org member (DM meeting) |
| **Persistence** | ✅ PostgreSQL (meeting records); media NOT implemented |
| **Tests** | Model/API tests only; media tests BLOCKED |
| **Gap** | **SFU/media infrastructure not provisioned: GATE BLOCKED** |

---

## 9. Search (Not Implemented in Phase 2)

| Attribute | Value |
|---|---|
| **Screen** | Search bar (global) |
| **Route** | `GET /api/search` |
| **Canonical Source** | `Message` + `SharedNote` + `Channel` |
| **Status** | ❌ Deferred to Phase 3 |
| **Gap** | Full-text search not in Phase 2 scope |

---

## 10. Shared Notes

| Attribute | Value |
|---|---|
| **Screen** | Notes tab (channel) / Notes list |
| **Route** | `GET/POST/PUT/DELETE /api/notes` |
| **Canonical Source** | `SharedNote` |
| **Read Path** | `GET /api/notes` |
| **Write Path** | `POST/PUT/DELETE /api/notes` |
| **Realtime** | Not implemented |
| **Auth** | Channel member (channel-scoped) / Author |
| **Persistence** | ✅ PostgreSQL |
| **Tests** | Not in Phase 2 test suite |
| **Gap** | Real-time collaboration on notes not implemented |

---

## Summary: Coverage Status

| Category | Screens | Backend Coverage | Realtime | Tests | Gaps |
|---|---|---|---|---|---|
| Channels | 4 | ✅ Complete | ✅ Full | 24/24 | None |
| DMs | 3 | ✅ Complete | ✅ Full | 23/23* | *1 flaky in suite |
| Messages | 3 | ✅ Complete | ✅ Full | Covered | Optimistic UI |
| Reactions/Pins | 2 | ✅ Complete | ✅ Full | 6/6 | None |
| Attachments | 2 | ✅ Complete | ✅ Partial | 7/7 | Scan adapter |
| Notifications | 2 | ✅ Complete | ✅ Full | 8/8 | Deep-link |
| Presence/Typing | 2 | ✅ Complete | ✅ Full | Covered | Ephemeral only |
| Huddles | 1 | ✅ Models/API | ❌ Media | 0 | **BLOCKED** |
| Search | 0 | ❌ Deferred |: | 0 | Phase 3 |
| Shared Notes | 1 | ✅ CRUD | ❌ Realtime | 0 | Phase 3 |

**Overall:** 18/20 screens fully backend-backed; 2 deferred; 1 BLOCKED.
