# PHASE 2 OPERATIONS: INNOWIT ONE COLLABORATION ENGINE

**Version:** 2.0 (As-Built)  
**Date:** 2026-11-18  
**Status:** As-Built (Closeout Verified)  
**Closeout Commit:** `930091af2abbd7cd4d8e3939f1db87b99e77c993`

---

## 1. Environment Variables

### 1.1 Required (New for Phase 2)

```env
# Realtime / Socket.IO
SOCKET_IO_PORT=3001                    # Same as HTTP port, Socket.IO attaches to same server
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
ATTACHMENT_ALLOWED_MIME_TYPES=application/pdf,image/png,image/jpeg,image/gif,image/webp,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/csv
ATTACHMENT_SCAN_ENABLED=false
ATTACHMENT_STORAGE_PROVIDER=local          # local | s3
ATTACHMENT_LOCAL_PATH=./uploads
ATTACHMENT_S3_BUCKET=
ATTACHMENT_S3_REGION=
ATTACHMENT_S3_ENDPOINT=

# Meetings / Huddles
MEETING_PROVIDER=mediasoup
MEETING_SFU_URL=
MEETING_TURN_URLS=
MEETING_TURN_USERNAME=
MEETING_TURN_CREDENTIAL=
```

### 1.2 Existing (Phase 1)

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/innowit_one
JWT_SECRET=<32+ char random string>          # FAIL-FAST if missing
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d
PORT=3001
HOST=localhost
FRONTEND_URL=http://localhost:3002
NODE_ENV=development
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

---

## 2. Database Operations

### 2.1 Migration Commands

```bash
# Development: create new migration
npx prisma migrate dev --name <migration_name>

# Production/CI: deploy migrations
npx prisma migrate deploy

# Generate Prisma Client (after schema changes)
npx prisma generate

# Reset database (DANGEROUS - dev only)
npx prisma migrate reset --force

# View migration status
npx prisma migrate status
```

### 2.2 Seeding

```bash
# Run seed (idempotent)
npx prisma db seed

# Or via npm
npm run db:seed
```

### 2.3 Backup/Restore

```bash
# Backup
pg_dump -h localhost -U postgres innowit_one > backup_$(date +%Y%m%d).sql

# Restore
psql -h localhost -U postgres -d innowit_one < backup_20261118.sql
```

---

## 3. Server Operations

### 3.1 Development

```bash
# Start API server with hot reload
npm run server:dev

# Start frontend dev server
npm run dev

# Start both (concurrently)
npm run dev & npm run server:dev
```

### 3.2 Production Build

```bash
# Build frontend
npm run build

# Build server
npm run server:build

# Start production server
npm run server:start
```

### 3.3 Tauri Desktop Build

```bash
# Development
npm run tauri:dev

# Production build (creates .msi/.exe in src-tauri/target/release/bundle/)
npm run tauri:build
```

**Note:** MSI bundler on Windows has known file-lock issue (OS error 32). Use NSIS installer or ZIP distribution as workaround.

### 3.4 Process Management

```bash
# PM2 (recommended for production)
pm2 start dist/server/index.js --name innowit-api
pm2 save
pm2 startup

# Systemd (Linux)
sudo systemctl enable innowit-api
sudo systemctl start innowit-api
```

---

## 4. Realtime (Socket.IO) Operations

### 4.1 Single Instance (Current)

- Socket.IO runs in-memory on same port as HTTP (3001)
- Presence sessions stored in PostgreSQL with TTL cleanup
- No external dependencies

### 4.2 Horizontal Scaling (Future)

```bash
# Redis adapter for multi-instance
npm install @socket.io/redis-adapter ioredis
```

```typescript
// In RealtimeGateway initialization
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'ioredis';

const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();

io.adapter(createAdapter(pubClient, subClient));
```

**Requirements:**
- Redis 7+ cluster
- Sticky sessions NOT required
- Shared session store for PresenceSession (Redis with TTL)

---

## 5. File Storage Operations

### 5.1 Local Storage (Development)

```bash
# Create uploads directory
mkdir -p ./uploads

# Set permissions
chmod 755 ./uploads
```

**Path:** `./uploads/attachments/{orgId}/{uuid}`

### 5.2 S3-Compatible Storage (Production)

```env
ATTACHMENT_STORAGE_PROVIDER=s3
ATTACHMENT_S3_BUCKET=innowit-attachments
ATTACHMENT_S3_REGION=us-east-1
ATTACHMENT_S3_ENDPOINT=https://s3.amazonaws.com  # Or MinIO/R2 endpoint
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

**Bucket Policy:** Private, no public access. Server generates presigned URLs.

### 5.3 Cleanup Jobs

```bash
# Delete soft-deleted attachments older than 30 days
# Run via cron daily
0 2 * * * /usr/bin/node /path/to/cleanup-attachments.js
```

---

## 6. Meetings / Huddles Infrastructure

### 6.1 Mediasoup SFU (Recommended)

```bash
# Install Mediasoup worker
npm install mediasoup

# Or use Docker
docker run -d --name mediasoup \
  -p 40000-40100:40000-40100/udp \
  -p 4443:4443/tcp \
  -v /path/to/certs:/certs \
  medialib/mediasoup:latest
```

**Configuration:**
```env
MEETING_PROVIDER=mediasoup
MEETING_SFU_URL=wss://sfu.example.com
MEETING_TURN_URLS=turn:turn.example.com:3478
MEETING_TURN_USERNAME=turnuser
MEETING_TURN_CREDENTIAL=turnpass
```

### 6.2 TURN Server (Required for NAT traversal)

```bash
# coturn Docker
docker run -d --name coturn \
  -p 3478:3478/udp -p 3478:3478/tcp \
  -p 5349:5349/udp -p 5349:5349/tcp \
  -e TURN_USERNAME=turnuser \
  -e TURN_PASSWORD=turnpass \
  -e REALM=example.com \
  coturn/coturn:latest
```

### 6.3 Development Mode (No Infrastructure)

```env
MEETING_PROVIDER=mock
MEETING_SFU_URL=
```

**Behavior:** Meeting UI works in simulation mode. No real audio/video. WebRTC signaling mocked via Socket.IO.

---

## 7. Notifications

### 7.1 Tauri Desktop Notifications

```rust
// In src-tauri/src/lib.rs
.plugin(tauri_plugin_notification::init())
```

**Capabilities Required (src-tauri/capabilities/notification.json):**
```json
{
  "identifier": "notification",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "notification:allow-show",
    "notification:allow-request-permission"
  ]
}
```

### 7.2 Permission Flow

1. App requests permission on first notification
2. User grants/denies in OS dialog
3. Preference stored in `NotificationPreference.desktopEnabled`
4. If denied, in-app notification center still works

---

## 8. Monitoring & Logging

### 8.1 Health Checks

```bash
# API health
curl http://localhost:3001/health

# API readiness (DB connection)
curl http://localhost:3001/ready
```

### 8.2 Key Metrics to Monitor

| Metric | Alert Threshold |
|--------|-----------------|
| API response time (p95) | > 500ms |
| Socket.IO connections | > 80% of limit |
| DB connection pool usage | > 80% |
| Disk usage (uploads) | > 80% |
| Failed migration | Any |
| Error rate (5xx) | > 1% |

### 8.3 Structured Logging

All logs are JSON structured (development: pretty, production: JSON).

```json
{
  "timestamp": "2026-11-18T10:30:00.000Z",
  "level": "info",
  "service": "innowit-api",
  "traceId": "abc123",
  "message": "POST /api/messages 201 45ms",
  "userId": "usr_123",
  "organizationId": "org_456"
}
```

---

## 9. Security Operations

### 9.1 Key Rotation

```bash
# Rotate JWT secret (requires all users to re-login)
# 1. Generate new secret
openssl rand -base64 48

# 2. Update JWT_SECRET in env
# 3. Restart API server
# 4. All refresh tokens invalidated automatically
```

### 9.2 Certificate Management

- TLS certificates for API (Let's Encrypt or internal CA)
- TURN server certificates
- Mediasoup DTLS certificates (auto-generated)

### 9.3 Audit Log Retention

- Default: 7 years (compliance)
- Configure in `AuditLog` model if needed

---

## 10. Disaster Recovery

### 10.1 RTO/RPO Targets

| Scenario | RTO | RPO |
|----------|-----|-----|
| Database failure | 15 min | 1 min (WAL) |
| API server failure | 5 min | 0 |
| File storage failure | 30 min | 24 hr (daily backup) |
| Full region outage | 4 hr | 24 hr |

### 10.2 Recovery Procedures

1. **Database:** Restore from latest pg_dump + WAL replay
2. **API:** Redeploy from container image / PM2 restart
3. **Files:** Restore from S3 versioning or local backup
4. **Full Region:** Failover to secondary region (not yet configured)

---

## 11. CI/CD Pipeline

```yaml
# .github/workflows/ci.yml (example)
stages:
  - lint: npm run lint
  - test: npm run test
  - build-frontend: npm run build
  - build-server: npm run server:build
  - test-integration: npm run test:integration
  - build-tauri: npm run tauri:build
  - deploy-staging: (manual approval)
  - deploy-production: (manual approval)
```

---

## 12. Troubleshooting

### 12.1 Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Socket.IO connection fails | CORS origin mismatch | Check `FRONTEND_URL` and `SOCKET_IO_CORS_ORIGIN` |
| Migration fails on deploy | Failed migration in DB | `npx prisma migrate resolve --rolled-back <name>` |
| File upload fails | Storage path permissions | `chmod 755 ./uploads` |
| Tauri build fails (MSI) | Windows file lock | Use NSIS: `tauri build --target nsis` |
| Notification not showing | Permission denied | Check OS settings, `NotificationPreference.desktopEnabled` |

### 12.2 Debug Commands

```bash
# Check Socket.IO connections
curl http://localhost:3001/socket.io/socket.io.js

# View active DB connections
psql -c "SELECT * FROM pg_stat_activity WHERE datname='innowit_one';"

# Check migration status
npx prisma migrate status

# View recent logs
tail -f logs/app.log | jq .
```

---

## 13. Version Compatibility Matrix

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | 22.x LTS | Required for Prisma 5.22 |
| PostgreSQL | 17 | Required for UUID v7, JSONB |
| Prisma | 5.22.0 | |
| Socket.IO | 4.7.x | |
| Tauri | 2.12.5 | |
| Rust | 1.84+ | MSVC toolchain on Windows |
| Mediasoup | 3.14+ | If meetings enabled |
| Redis | 7.2+ | For horizontal scaling |

---

## 14. Support Contacts

| Area | Contact |
|------|---------|
| Infrastructure | DevOps Team |
| Backend API | Backend Team |
| Frontend | Frontend Team |
| Desktop (Tauri) | Desktop Team |
| Security | Security Team |
| Database | DBA Team |
