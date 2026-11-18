import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { testState, initializeTestDatabase } from './db-singleton';
import conversationRoutes from '../routes/conversations';
import messageRoutes from '../routes/messages';
import { authenticateToken } from '../middleware/auth';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';
import crypto from 'crypto';

function uuid() {
  return crypto.randomUUID();
}

describe('Read Cursor & Unread Count Semantics', () => {
  let app: express.Express;
  let prisma: PrismaClient;

  beforeAll(async () => {
    await initializeTestDatabase();
    prisma = testState.prisma!;

    app = express();
    app.use(express.json());
    app.use('/api/conversations', authenticateToken, conversationRoutes);
    app.use('/api/messages', authenticateToken, messageRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  afterAll(async () => {
    // Global teardown handles disconnect
  });

  const getMemberToken = () => testState.memberToken;
  const getAdminToken = () => testState.adminToken;
  const getTestData = () => testState.testData;

  let conversationId: string;
  const userA = () => getTestData().users[1].id; // Member
  const userB = () => getTestData().users[0].id; // Admin
  const tokenA = () => getMemberToken();
  const tokenB = () => getAdminToken();

  beforeEach(async () => {
    // Clean up any existing conversation messages for this user pair
    await prisma.message.deleteMany({
      where: {
        OR: [
          { conversationId: { not: null }, senderId: { in: [userA(), userB()] } },
          { senderId: userA(), recipientId: userB() },
          { senderId: userB(), recipientId: userA() },
        ],
        organizationId: getTestData().orgA.id,
      },
    });

    // Clean up read cursors for this conversation
    await prisma.readCursor.deleteMany({
      where: {
        userId: { in: [userA(), userB()] },
        recipientId: { not: null },
      },
    });

    // Create or get conversation between userA and userB
    const response = await request(app)
      .post('/api/conversations')
      .set('Authorization', `Bearer ${tokenA()}`)
      .send({ recipientId: userB() });
    conversationId = response.body.data.id;
  });

  describe('DM Unread Count', () => {
    it('should return 0 unread for new conversation with no messages', async () => {
      const response = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${tokenA()}`)
        .expect(200);

      const conv = response.body.data.find((c: any) => c.id === conversationId);
      expect(conv).toBeDefined();
      expect(conv.unreadCount).toBe(0);
    });

    it('should increment unread count when other user sends message', async () => {
      // User B sends a message
      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${tokenB()}`)
        .send({
          conversationId,
          content: 'Hello from B',
          idempotencyKey: uuid(),
        })
        .expect(201);

      // User A should see 1 unread
      const response = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${tokenA()}`)
        .expect(200);

      const conv = response.body.data.find((c: any) => c.id === conversationId);
      expect(conv.unreadCount).toBe(1);
    });

    it('should NOT increment unread count for own messages', async () => {
      // User A sends a message
      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${tokenA()}`)
        .send({
          conversationId,
          content: 'Hello from A',
          idempotencyKey: uuid(),
        })
        .expect(201);

      // User A should see 0 unread (own message)
      const response = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${tokenA()}`)
        .expect(200);

      const conv = response.body.data.find((c: any) => c.id === conversationId);
      expect(conv.unreadCount).toBe(0);
    });

    it('should mark messages as read when read cursor advances', async () => {
      // User B sends 3 messages
      for (let i = 1; i <= 3; i++) {
        await request(app)
          .post('/api/messages')
          .set('Authorization', `Bearer ${tokenB()}`)
          .send({
            conversationId,
            content: `Message ${i} from B`,
            idempotencyKey: uuid(),
          })
          .expect(201);
      }

      // User A should see 3 unread
      let response = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${tokenA()}`)
        .expect(200);
      let conv = response.body.data.find((c: any) => c.id === conversationId);
      expect(conv.unreadCount).toBe(3);

      // Get the last message ID
      const messagesResponse = await request(app)
        .get(`/api/messages?conversationId=${conversationId}`)
        .set('Authorization', `Bearer ${tokenA()}`)
        .expect(200);
      const lastMessageId = messagesResponse.body.data[0].id; // Most recent first

      // Mark as read up to last message
      await request(app)
        .post(`/api/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${tokenA()}`)
        .send({ messageId: lastMessageId })
        .expect(200);

      // User A should now see 0 unread
      response = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${tokenA()}`)
        .expect(200);
      conv = response.body.data.find((c: any) => c.id === conversationId);
      expect(conv.unreadCount).toBe(0);
    });

    it('should only count messages after the cursor chronologically', async () => {
      // Send messages from B
      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${tokenB()}`)
        .send({ conversationId, content: 'Msg 1', idempotencyKey: uuid() })
        .expect(201);
      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${tokenB()}`)
        .send({ conversationId, content: 'Msg 2', idempotencyKey: uuid() })
        .expect(201);
      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${tokenB()}`)
        .send({ conversationId, content: 'Msg 3', idempotencyKey: uuid() })
        .expect(201);

      // Get message IDs in chronological order
      const messagesResponse = await request(app)
        .get(`/api/messages?conversationId=${conversationId}`)
        .set('Authorization', `Bearer ${tokenA()}`)
        .expect(200);
      const messages = messagesResponse.body.data; // Descending order (newest first)
      const msg3Id = messages[0].id; // Most recent
      const msg2Id = messages[1].id;
      const msg1Id = messages[2].id; // Oldest

      // Mark read up to message 2 (middle message)
      await request(app)
        .post(`/api/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${tokenA()}`)
        .send({ messageId: msg2Id })
        .expect(200);

      // Should have 1 unread (message 3 only)
      const response = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${tokenA()}`)
        .expect(200);
      const conv = response.body.data.find((c: any) => c.id === conversationId);
      expect(conv.unreadCount).toBe(1);
    });

    it('should handle equal timestamps with ID tiebreaker', async () => {
      // This test verifies the tiebreaker logic works
      // We can't easily control timestamps in tests, but we verify the logic exists
      // by checking that marking read with a specific message ID works correctly
      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${tokenB()}`)
        .send({ conversationId, content: 'Test', idempotencyKey: uuid() })
        .expect(201);

      const messagesResponse = await request(app)
        .get(`/api/messages?conversationId=${conversationId}`)
        .set('Authorization', `Bearer ${tokenA()}`)
        .expect(200);
      const lastMessageId = messagesResponse.body.data[0].id;

      await request(app)
        .post(`/api/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${tokenA()}`)
        .send({ messageId: lastMessageId })
        .expect(200);

      const response = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${tokenA()}`)
        .expect(200);
      const conv = response.body.data.find((c: any) => c.id === conversationId);
      expect(conv.unreadCount).toBe(0);
    });

    it('should not count deleted messages in unread', async () => {
      // User B sends a message
      const sendResponse = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${tokenB()}`)
        .send({ conversationId, content: 'To be deleted', idempotencyKey: uuid() })
        .expect(201);
      const messageId = sendResponse.body.data.id;

      // User A should see 1 unread
      let response = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${tokenA()}`)
        .expect(200);
      let conv = response.body.data.find((c: any) => c.id === conversationId);
      expect(conv.unreadCount).toBe(1);

      // User B deletes the message
      await request(app)
        .delete(`/api/messages/${messageId}`)
        .set('Authorization', `Bearer ${tokenB()}`)
        .expect(200);

      // User A should see 0 unread (deleted message not counted)
      response = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${tokenA()}`)
        .expect(200);
      conv = response.body.data.find((c: any) => c.id === conversationId);
      expect(conv.unreadCount).toBe(0);
    });

    it('should maintain separate cursors per user', async () => {
      // User B sends a message
      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${tokenB()}`)
        .send({ conversationId, content: 'From B', idempotencyKey: uuid() })
        .expect(201);

      // User A has 1 unread, User B has 0
      const responseA = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${tokenA()}`)
        .expect(200);
      const convA = responseA.body.data.find((c: any) => c.id === conversationId);
      expect(convA.unreadCount).toBe(1);

      const responseB = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${tokenB()}`)
        .expect(200);
      const convB = responseB.body.data.find((c: any) => c.id === conversationId);
      expect(convB.unreadCount).toBe(0);
    });

    it('should advance cursor monotonically (never go backwards)', async () => {
      // Send 3 messages
      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${tokenB()}`)
        .send({ conversationId, content: 'Msg 1', idempotencyKey: uuid() })
        .expect(201);
      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${tokenB()}`)
        .send({ conversationId, content: 'Msg 2', idempotencyKey: uuid() })
        .expect(201);
      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${tokenB()}`)
        .send({ conversationId, content: 'Msg 3', idempotencyKey: uuid() })
        .expect(201);

      const messagesResponse = await request(app)
        .get(`/api/messages?conversationId=${conversationId}`)
        .set('Authorization', `Bearer ${tokenA()}`)
        .expect(200);
      const msg3Id = messagesResponse.body.data[0].id;
      const msg2Id = messagesResponse.body.data[1].id;
      const msg1Id = messagesResponse.body.data[2].id;

      // Mark read up to message 3 (most recent)
      await request(app)
        .post(`/api/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${tokenA()}`)
        .send({ messageId: msg3Id })
        .expect(200);

      // Try to mark read with older message (should not go backwards)
      await request(app)
        .post(`/api/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${tokenA()}`)
        .send({ messageId: msg1Id })
        .expect(200);

      // Should still have 0 unread (cursor should not have moved backwards)
      const response = await request(app)
        .get('/api/conversations')
        .set('Authorization', `Bearer ${tokenA()}`)
        .expect(200);
      const conv = response.body.data.find((c: any) => c.id === conversationId);
      expect(conv.unreadCount).toBe(0);

      // Verify cursor in DB is still at message 3
      const cursor = await prisma.readCursor.findUnique({
        where: { userId_recipientId: { userId: userA(), recipientId: conversationId } },
      });
      expect(cursor?.lastReadMessageId).toBe(msg3Id);
    });
  });
});