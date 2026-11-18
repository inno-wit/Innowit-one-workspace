# PHASE 2 BACKLOG: INNOWIT ONE COLLABORATION ENGINE

**Version:** 2.0 (Closeout Updated)  
**Date:** 2026-11-18  
**Status:** Closeout Updated: Reflects actual Phase 2 delivery status

---

## 0. Phase 2 Closeout Status Summary

| Feature Area | Status | Notes |
|---|---|---|
| Channels (CRUD, membership, archive, realtime) | ✅ Delivered | 24/24 tests pass (1 flaky in suite) |
| Direct Messages (create-or-open, history, group DMs) | ✅ Delivered | Conversation model + deterministic create-or-open |
| Messages (send, edit, delete, idempotency, threads) | ✅ Delivered | Idempotency key + soft delete + threadRootId |
| Reactions (unique constraint, idempotent, realtime) | ✅ Delivered | @@unique([messageId, userId, emoji]) |
| Pins (permission-checked, realtime) | ✅ Delivered | Channel member or Admin |
| Attachments (signed URLs, checksum, magic bytes) | ✅ Delivered | 7/7 tests pass |
| Notifications (in-app, preferences, dedup, triggers) | ✅ Delivered | 8/8 tests pass |
| Presence (multi-session, heartbeat, stale cleanup) | ✅ Delivered | PresenceSession model |
| Typing Indicators (ephemeral, 5s expiry, scoped) | ✅ Delivered | Ephemeral, conversation-scoped |
| Read Cursors (per-channel + per-DM, unread counts) | ✅ Delivered | ReadCursor model |
| Shared Notes (CRUD, linking) | ⚠️ Partial | CRUD implemented, realtime deferred |
| Search | ❌ Deferred | Phase 3 |
| **Meetings/Huddles (Media/SFU)** | 🚫 **BLOCKED** | **No SFU infrastructure provisioned** |
| Desktop Notifications (Tauri) | ⚠️ Source Only | Not runtime-verified on packaged binary |
| Deep Links (Tauri) | ⚠️ Source Only | Not runtime-verified on packaged binary |

---

## 1. Deferred Features (Out of Phase 2 Scope)

| ID | Feature | Reason | Target Phase |
|----|---------|--------|--------------|
| BACK-01 | End-to-end encryption for DMs | Requires key management UX, key rotation | Phase 3 |
| BACK-02 | Customer-managed keys (BYOK) | Enterprise tier feature | Phase 3 |
| BACK-03 | Message retention policy UI | Admin configuration needed | Phase 3 |
| BACK-04 | SIEM integration (Splunk/Datadog) | Structured logs ready, needs connector | Phase 3 |
| BACK-05 | Advanced search (filters, date ranges, file type) | Current: basic text search only | Phase 3 |
| BACK-06 | Message threading UI improvements | Collapse/expand, thread list view | Phase 3 |
| BACK-07 | Channel categories/folders | Organization feature | Phase 3 |
| BACK-08 | Guest access / shared channels | Cross-org collaboration | Phase 4 |
| BACK-09 | Bot/integration framework | Webhook + slash commands | Phase 4 |
| BACK-10 | Video recording for meetings | Requires SFU recording support | Phase 4 |
| BACK-11 | Live transcription/captions | AI service integration | Phase 4 |
| BACK-12 | Whiteboard/canvas collaboration | Separate product area | Phase 4 |

---

## 1.5 Phase 2.6 Huddles / SFU: Explicitly BLOCKED Backlog Item

**Item:** BACK-26: Production Huddles / Real-Time Media (SFU)
**Status:** 🚫 **BLOCKED**: No real media infrastructure provisioned
**Priority:** High (core collaboration feature)
**Owner:** Infrastructure / Platform Team

### Prerequisites (must be completed before unblocking):

| Prereq ID | Requirement | Description | Status |
|---|---|---|---|
| PR-01 | SFU Deployment | Deploy Mediasoup (recommended) or LiveKit cluster | ❌ Not started |
| PR-02 | TURN Server | Configure coturn or managed TURN for NAT traversal | ❌ Not started |
| PR-03 | TLS/WSS Certificates | Valid certs for media signaling (WSS) and DTLS-SRTP | ❌ Not started |
| PR-04 | Credentials/Token Issuance | Short-lived JWT for media server auth | ❌ Not started |
| PR-05 | Network/Firewall | UDP ports for ICE/STUN/TURN, TCP for signaling | ❌ Not started |
| PR-06 | Media Permissions | Tauri microphone/camera permissions handling | ❌ Not started |
| PR-07 | Group Call Tests | Integration tests for 3+ participant calls | ❌ Not started |
| PR-07 | Screen Share Tests | Integration tests for screen sharing | ❌ Not started |
| PR-08 | Reconnection Handling | Media reconnection on network flap | ❌ Not started |
| PR-09 | Operational Monitoring | Metrics: bitrate, packet loss, latency, participant count | ❌ Not started |

### Notes:
- The meeting models (`Meeting`, `MeetingParticipant`), REST API (`/api/meetings`), and Socket.IO room (`meeting:{meetingId}`) are **already implemented**.
- WebRTC signaling via `meeting.signal` event is **implemented**.
- Only the **media plane (SFU/TURN)** is missing.
- Per closeout audit: **Do not simulate success**. UI must show "Not Configured" state for huddle media controls.

---

## 2. Technical Debt

| ID | Debt Item | Impact | Effort | Target |
|------|-----------|--------|--------|--------|
| DEBT-01 | Frontend CollaborationView still uses localStorage | High: dual state sources | Medium | Sprint 1 |
| DEBT-02 | No API client retry logic with exponential backoff | Medium | Low | Sprint 1 |
| DEBT-03 | Socket.IO client no offline message queue | High: messages lost offline | Medium | Sprint 2 |
| DEBT-04 | No request deduplication for REST calls | Medium | Low | Sprint 2 |
| DEBT-05 | TypeScript errors in legacy routes (pre-existing) | Low: doesn't affect new code | Low | Ongoing |
| DEBT-06 | No OpenAPI/Swagger spec generation | Medium: API consumers need it | Medium | Sprint 2 |
| DEBT-07 | Tauri notification permission not requested on startup | Medium | Low | Sprint 1 |
| DEBT-08 | Deep link protocol not registered | Low | Low | Sprint 2 |
| DEBT-09 | No structured error codes enum on frontend | Medium | Low | Sprint 2 |
| DEBT-10 | Meeting simulation mode mixed with real code | Medium: confusing | Medium | Sprint 2 |

---

## 3. Known Bugs / Issues

| ID | Bug | Severity | Status | Notes |
|----|-----|----------|--------|-------|
| BUG-01 | MSI bundler file lock (OS error 32) | Medium | Known | Use NSIS or ZIP |
| BUG-02 | TypeScript errors in Phase 1 routes | Low | Known | Pre-existing, not blocking |
| BUG-03 | Socket.IO client no reconnection UI feedback | Medium | Open | Add toast on reconnect |
| BUG-04 | Optimistic message not cleaned up on send failure | Medium | Open | Remove from UI after timeout |
| BUG-05 | Typing indicator doesn't clear on tab blur | Low | Open | Add window focus/blur handlers |
| BUG-06 | Unread count badge not updating in sidebar | Medium | Open | Hook needs to sync with socket |
| BUG-07 | Channel list not refreshing after create via REST | Medium | Open | Socket event should handle |
| BUG-08 | File upload progress not shown | Low | Open | Need progress event from storage |
| BUG-09 | Notification sound not implemented | Low | Open | Add optional sound setting |
| BUG-10 | Presence shows "Live" even when tab backgrounded | Medium | Open | Use Page Visibility API |

---

## 4. Improvements / Enhancements

| ID | Enhancement | Priority | Effort | Description |
|----|-------------|----------|--------|-------------|
| ENH-01 | Keyboard shortcuts (Ctrl+K, Ctrl+/, etc.) | High | Medium | Already have CommandPalette, add more |
| ENH-02 | Markdown rendering in messages | High | Medium | Use remark/rehype safely |
| ENH-03 | Code blocks with syntax highlighting | Medium | Medium | Prism.js or shiki |
| ENH-04 | Link previews (client-side only) | Medium | Medium | iframe sandbox, no server fetch |
| ENH-05 | Emoji picker with search/categories | Medium | Low | Replace hardcoded palette |
| ENH-06 | Message edit history view | Medium | Medium | Show edit trail on hover |
| ENH-07 | Jump to message (permalink) | Medium | Low | URL fragment #msg-{id} |
| ENH-08 | Pin multiple messages | Medium | Low | Array of pinned message IDs |
| ENH-09 | Channel description edit inline | Low | Low | Click to edit |
| ENH-10 | Drag-and-drop file upload | High | Medium | Drop zone in composer |
| ENH-11 | Image paste from clipboard | High | Medium | Paste event handler |
| ENH-12 | @mention autocomplete | High | Medium | User search in composer |
| ENH-13 | Slash commands (/remind, /poll) | Medium | High | Command parser |
| ENH-14 | Thread subscription/unsubscribe | Medium | Low | Notify on new replies |
| ENH-15 | Message search highlights | Medium | Low | Mark.js for highlighting |

---

## 5. Infrastructure / DevOps

| ID | Task | Priority | Effort | Notes |
|----|------|----------|--------|-------|
| INFRA-01 | CI/CD pipeline for Tauri builds | High | High | GitHub Actions + code signing |
| INFRA-02 | Automated dependency updates (Dependabot) | High | Low | Enable in GitHub |
| INFRA-03 | Staging environment deployment | High | Medium | Separate DB, same code |
| INFRA-04 | Load testing script (k6/artillery) | Medium | Medium | 1000 concurrent sockets |
| INFRA-05 | Database connection pooling (PgBouncer) | Medium | Medium | For production scale |
| INFRA-06 | CDN for static assets | Low | Low | Vite + Cloudflare/CloudFront |
| INFRA-07 | Error tracking (Sentry) | High | Medium | Frontend + backend |
| INFRA-08 | APM (Datadog/New Relic) | Medium | Medium | Traces + metrics |
| INFRA-09 | Log aggregation (Loki/ELK) | Medium | Medium | Structured JSON logs ready |
| INFRA-10 | Backup verification script | High | Low | Monthly restore test |

---

## 6. Security Hardening

| ID | Task | Priority | Effort | Notes |
|----|------|----------|--------|-------|
| SEC-01 | CSP header configuration | High | Medium | Nonce-based for inline scripts |
| SEC-02 | Rate limiting per-user per-endpoint | High | Low | Already have global, need granular |
| SEC-03 | File upload antivirus scan (ClamAV) | Medium | Medium | Async, quarantine on detect |
| SEC-04 | Password strength meter on frontend | Medium | Low | zxcvbn library |
| SEC-05 | 2FA/TOTP support | High | High | Authenticator app + backup codes |
| SEC-06 | Session device management UI | Medium | Medium | View/revoke active sessions |
| SEC-07 | Audit log export (GDPR/DSAR) | Medium | Low | JSON/CSV export |
| SEC-08 | Penetration test scheduling | High | External | Annual third-party |

---

## 7. Accessibility (a11y)

| ID | Task | Priority | Effort | WCAG |
|----|------|----------|--------|------|
| A11Y-01 | Focus management in modals/drawers | High | Medium | 2.4.3 |
| A11Y-02 | ARIA labels on all interactive elements | High | Medium | 4.1.2 |
| A11Y-03 | Color contrast ratios | High | Low | 1.4.3 |
| A11Y-04 | Keyboard navigation for all features | High | Medium | 2.1.1 |
| A11Y-05 | Screen reader announcements for realtime events | High | Medium | 4.1.3 |
| A11Y-06 | Reduced motion support | Medium | Low | 2.3.3 |
| A11Y-07 | High contrast mode | Low | Low | 1.4.6 |

---

## 8. Internationalization (i18n)

| ID | Task | Priority | Effort | Notes |
|----|------|----------|--------|-------|
| I18N-01 | Extract all strings to translation files | Medium | High | react-i18next |
| I18N-02 | Date/number formatting per locale | Medium | Medium | Intl API |
| I18N-03 | RTL language support | Low | High | CSS logical properties |
| I18N-04 | Kenyan English / Swahili locales | High | Medium | Primary market |

---

## 8. Performance Optimization

| ID | Task | Priority | Effort | Target |
|----|------|----------|--------|--------|
| PERF-01 | Virtualize message list (react-window) | High | Medium | 1000+ messages |
| PERF-02 | Lazy load channel list | Medium | Low | IntersectionObserver |
| PERF-03 | Memoize message components | High | Low | React.memo |
| PERF-04 | Bundle size analysis | Medium | Low | < 500KB gzipped |
| PERF-05 | Socket.IO message batching | Medium | Medium | High throughput |
| PERF-06 | Database query optimization | High | Medium | Indexes, query plans |
| PERF-07 | CDN for attachment downloads | Medium | Low | S3 + CloudFront |

---

## 9. Sprint Planning (Proposed)

### Sprint 1 (Week 1-2): Core Real-time + Frontend Integration
- [ ] Replace CollaborationView with CollaborationViewRealTime
- [ ] Connect channel list to REST API + socket events
- [ ] Implement message send/edit/delete via socket
- [ ] Add typing indicators
- [ ] Fix optimistic message cleanup
- [ ] Request notification permission on mount

### Sprint 2 (Week 3-4): Presence + Read State + Notifications
- [ ] Multi-session presence with heartbeat
- [ ] Read cursors + unread counts
- [ ] In-app notification center
- [ ] Desktop notifications (Tauri)
- [ ] Deep link handling

### Sprint 3 (Week 5-6): Attachments + Search + Meetings (Sim)
- [ ] File upload with validation
- [ ] Message search
- [ ] Meeting simulation mode polish
- [ ] Mediasoup dev environment setup (if possible)

### Sprint 4 (Week 7-8): Testing + Desktop + Exit Audit
- [ ] Integration tests for REST + Socket.IO
- [ ] Tauri build + notification test
- [ ] Phase 1 regression full suite
- [ ] PHASE-2-EXIT-AUDIT.md
- [ ] Documentation finalization

---

## 10. Acceptance Criteria for Phase 2 Exit

| Criteria | Status | Evidence Required |
|----------|--------|-------------------|
| Two users on separate desktops exchange messages in real-time | 🔄 | Video/screenshot |
| Offline user receives missed messages on reconnect | 🔄 | Test log |
| Idempotent send (retry) creates exactly one message | 🔄 | Test log |
| Cross-org channel access denied | 🔄 | Test log |
| Cross-branch access denied for restricted roles | 🔄 | Test log |
| Removed member loses real-time access immediately | 🔄 | Test log |
| Deactivated user socket disconnected | 🔄 | Test log |
| DM create-or-open returns same conversation | 🔄 | Test log |
| Message edit/delete preserves audit trail | 🔄 | Test log |
| Duplicate reactions prevented | 🔄 | Test log |
| Read cursor correctness | 🔄 | Test log |
| Multi-session presence accuracy | 🔄 | Test log |
| Typing indicator scope + expiry | 🔄 | Test log |
| Notification deduplication | 🔄 | Test log |
| Attachment upload validation | 🔄 | Test log |
| Unauthorized attachment download denied | 🔄 | Test log |
| Reconnect recovers subscriptions + history | 🔄 | Test log |
| Socket ack reports DB failure | 🔄 | Test log |
| Meeting token scoped + validated | 🚫 BLOCKED | N/A |
| Two desktops exchange audio/video | 🚫 BLOCKED | N/A |
| All Phase 1 regression tests pass | ✅ | Test report |
| Frontend build passes | ✅ | Build log |
| Backend lint/type check passes | ✅ | Lint log |
| Tauri desktop builds | ⏳ | Build artifact |

---

*This backlog is reviewed and reprioritized at the start of each sprint. Items marked 🚫 BLOCKED require external dependencies and cannot be completed in Phase 2.*
