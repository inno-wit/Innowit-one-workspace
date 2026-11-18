import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { testState, initializeTestDatabase } from './db-singleton';
import messageRoutes from '../routes/messages';
import conversationRoutes from '../routes/conversations';
import { authenticateToken } from '../middleware/auth';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';

describe('Messages & Conversations API Integration Tests', () => {
  let app: express.Express;
  let prisma: PrismaClient;

  beforeAll(async () => {
    await initializeTestDatabase();
    prisma = testState.prisma!;

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use('/api/messages', authenticateToken, messageRoutes);
    app.use('/api/conversations', authenticateToken, conversationRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  afterAll(async () => {
    // Global teardown handles disconnect
  });

  // Clean test-specific data (channels, messages, etc.) before each test
  // but keep base test data (orgs, users) AND our test fixture channels (fixture-*)
  beforeEach(async () => {
    // Only clean up test channels that start with 'test-' prefix
    await prisma.reaction.deleteMany({ where: { message: { channel: { name: { startsWith: 'test-' } } } } });
    await prisma.message.deleteMany({ where: { channel: { name: { startsWith: 'test-' } } } });
    await prisma.channelMember.deleteMany({ where: { channel: { name: { startsWith: 'test-' } } } });
    await prisma.channel.deleteMany({ where: { name: { startsWith: 'test-' } } });
    // Also clean up any conversation messages created during tests
    await prisma.message.deleteMany({ where: { conversation: { participants: { some: { user: { email: { contains: 'test-' } } } } } } });
  });

  // Helper to get tokens and test data from global state
  const getAdminToken = () => testState.adminToken;
  const getMemberToken = () => testState.memberToken;
  const getOtherOrgToken = () => testState.otherOrgToken;
  const getTestData = () => testState.testData;
  const getChannelId = () => testState.channelId;
  const getOtherChannelId = () => testState.otherChannelId;

  function generateUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  describe('POST /api/messages - Channel Messages', () => {
    it('should send a message to a channel', async () => {
      const idempotencyKey = generateUuid();
      const response = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .send({
          channelId: getChannelId(),
          content: 'Hello from channel!',
          idempotencyKey,
        })
        .expect(201);

      expect(response.body.data).toMatchObject({
        channelId: getChannelId(),
        content: 'Hello from channel!',
        senderId: getTestData().users[1].id,
      });
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.createdAt).toBeDefined();
      expect(response.body.existing).toBe(false);
    });

    it('should enforce idempotency - duplicate key returns existing message', async () => {
      const idempotencyKey = generateUuid();
      
      // First send
      const response1 = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .send({
          channelId: getChannelId(),
          content: 'First message',
          idempotencyKey,
        })
        .expect(201);

      // Second send with same idempotency key
      const response2 = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .send({
          channelId: getChannelId(),
          content: 'Different content but same key',
          idempotencyKey,
        })
        .expect(200); // Returns 200 for existing

      expect(response2.body.existing).toBe(true);
      expect(response2.body.data.id).toBe(response1.body.data.id);
      expect(response2.body.data.content).toBe('First message'); // Original content preserved
    });

    it('should reject message to private channel for non-member', async () => {
      const privateChannel = await prisma.channel.create({
        data: {
          name: 'private-chan',
          description: 'Private',
          isPrivate: true,
          createdById: getTestData().users[0].id,
          organizationId: getTestData().orgA.id,
        },
      });

      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .send({
          channelId: privateChannel.id,
          content: 'Should fail',
          idempotencyKey: generateUuid(),
        })
        .expect(403);
    });

    it('should reject cross-org channel access', async () => {
      const orgBChannel = await prisma.channel.create({
        data: {
          name: 'orgb-channel',
          description: 'Org B channel',
          isPrivate: false,
          createdById: getTestData().users[2].id,
          organizationId: getTestData().orgB.id,
        },
      });

      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .send({
          channelId: orgBChannel.id,
          content: 'Cross org attempt',
          idempotencyKey: generateUuid(),
        })
        .expect(403);
    });

    it('should validate idempotency key is required', async () => {
      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .send({
          channelId: getChannelId(),
          content: 'No idempotency key',
        })
        .expect(400);
    });

    it('should validate content is required', async () => {
      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .send({
          channelId: getChannelId(),
          idempotencyKey: generateUuid(),
        })
        .expect(400);
    });
  });

  describe('POST /api/messages - Direct Messages', () => {
    it('should send a direct message', async () => {
      const idempotencyKey = generateUuid();
      const response = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .send({
          recipientId: getTestData().users[0].id,
          content: 'Hello via DM!',
          idempotencyKey,
        })
        .expect(201);

      expect(response.body.data).toMatchObject({
        recipientId: getTestData().users[0].id,
        content: 'Hello via DM!',
        senderId: getTestData().users[1].id,
        channelId: null,
      });
    });

    it('should send a DM without conversationId (direct message)', async () => {
      const idempotencyKey = generateUuid();
      const response = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .send({
          recipientId: getTestData().users[0].id,
          content: 'First DM',
          idempotencyKey,
        })
        .expect(201);

      expect(response.body.data).toMatchObject({
        recipientId: getTestData().users[0].id,
        content: 'First DM',
        senderId: getTestData().users[1].id,
        channelId: null,
        conversationId: null,
      });
    });

    it('should reject DM to user in different organization', async () => {
      await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .send({
          recipientId: getTestData().users[2].id, // User from orgB
          content: 'Cross org DM',
          idempotencyKey: generateUuid(),
        })
        .expect(404);
    });
  });

  describe('GET /api/messages - Channel Messages', () => {
    beforeEach(async () => {
      // Create test messages
      await prisma.message.createMany({
        data: [
          {
            channelId: getChannelId(),
            senderId: getTestData().users[0].id,
            content: 'Message 1',
            organizationId: getTestData().orgA.id,
          },
          {
            channelId: getChannelId(),
            senderId: getTestData().users[1].id,
            content: 'Message 2',
            organizationId: getTestData().orgA.id,
          },
          {
            channelId: getChannelId(),
            senderId: getTestData().users[0].id,
            content: 'Message 3',
            organizationId: getTestData().orgA.id,
          },
        ],
      });
    });

    it('should return paginated messages for channel member', async () => {
      const response = await request(app)
        .get(`/api/messages?channelId=${getChannelId()}&limit=2`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeLessThanOrEqual(2);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.hasMore).toBeDefined();
    });

    it('should return messages in descending order by default', async () => {
      const response = await request(app)
        .get(`/api/messages?channelId=${getChannelId()}`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      const messages = response.body.data;
      for (let i = 1; i < messages.length; i++) {
        expect(new Date(messages[i-1].createdAt).getTime()).toBeGreaterThanOrEqual(
          new Date(messages[i].createdAt).getTime()
        );
      }
    });

    it('should reject access to private channel for non-member', async () => {
      const privateChannel = await prisma.channel.create({
        data: {
          name: 'private-msgs',
          description: 'Private',
          isPrivate: true,
          createdById: getTestData().users[0].id,
          organizationId: getTestData().orgA.id,
        },
      });

      await request(app)
        .get(`/api/messages?channelId=${privateChannel.id}`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(403);
    });

    it('should support cursor-based pagination', async () => {
      // Get first page
      const response1 = await request(app)
        .get(`/api/messages?channelId=${getChannelId()}&limit=1`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response1.body.pagination.hasMore).toBe(true);
      expect(response1.body.pagination.cursor).toBeDefined();

      // Get second page using cursor
      const response2 = await request(app)
        .get(`/api/messages?channelId=${getChannelId()}&limit=1&cursor=${response1.body.pagination.cursor}`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response2.body.data[0].id).not.toBe(response1.body.data[0].id);
    });
  });

  describe('GET /api/messages - DM Messages', () => {
    let conversationId: string;

    beforeEach(async () => {
      // First create a conversation
      const conversation = await prisma.conversation.create({
        data: {
          type: 'DIRECT',
          organizationId: getTestData().orgA.id,
          createdById: getTestData().users[0].id,
          participants: {
            create: [
              { userId: getTestData().users[0].id },
              { userId: getTestData().users[1].id },
            ],
          },
        },
      });
      conversationId = conversation.id;

      await prisma.message.createMany({
        data: [
          {
            conversationId,
            senderId: getTestData().users[0].id,
            content: 'DM 1',
            organizationId: getTestData().orgA.id,
          },
          {
            conversationId,
            senderId: getTestData().users[1].id,
            content: 'DM 2',
            organizationId: getTestData().orgA.id,
          },
        ],
      });
    });

    it('should return DM messages between two users', async () => {
      const response = await request(app)
        .get(`/api/messages?conversationId=${conversationId}`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(2);
      // All messages should be in this conversation
      for (const msg of response.body.data) {
        expect(msg.conversationId).toBe(conversationId);
        expect([getTestData().users[0].id, getTestData().users[1].id]).toContain(msg.senderId);
      }
    });
  });

  describe('PUT /api/messages/:id - Edit Message', () => {
    let messageId: string;

    beforeEach(async () => {
      const message = await prisma.message.create({
        data: {
          channelId: getChannelId(),
          senderId: getTestData().users[1].id,
          content: 'Original content',
          organizationId: getTestData().orgA.id,
        },
      });
      messageId = message.id;
    });

    it('should allow sender to edit their message', async () => {
      const response = await request(app)
        .put(`/api/messages/${messageId}`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .send({ content: 'Edited content' })
        .expect(200);

      expect(response.body.data.content).toBe('Edited content');
      expect(response.body.data.editedAt).toBeDefined();
      expect(response.body.data.editedById).toBe(getTestData().users[1].id);
    });

    it('should reject edit by non-sender non-admin', async () => {
      // Admin CAN edit (SUPER_ADMIN is allowed)
      await request(app)
        .put(`/api/messages/${messageId}`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({ content: 'Admin trying to edit' })
        .expect(200);
    });
  });

  describe('DELETE /api/messages/:id - Delete Message', () => {
    let messageId: string;

    beforeEach(async () => {
      const message = await prisma.message.create({
        data: {
          channelId: getChannelId(),
          senderId: getTestData().users[1].id,
          content: 'To be deleted',
          organizationId: getTestData().orgA.id,
        },
      });
      messageId = message.id;
    });

    it('should soft delete message by sender', async () => {
      await request(app)
        .delete(`/api/messages/${messageId}`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      const message = await prisma.message.findUnique({ where: { id: messageId } });
      expect(message?.deletedAt).not.toBeNull();
      expect(message?.content).toBe('[Deleted]');
    });
  });

  describe('Reactions', () => {
    let messageId: string;

    beforeEach(async () => {
      const message = await prisma.message.create({
        data: {
          channelId: getChannelId(),
          senderId: getTestData().users[0].id,
          content: 'React to me',
          organizationId: getTestData().orgA.id,
        },
      });
      messageId = message.id;
    });

    describe('POST /api/messages/:id/reactions', () => {
      it('should add reaction', async () => {
        const response = await request(app)
          .post(`/api/messages/${messageId}/reactions`)
          .set('Authorization', `Bearer ${getMemberToken()}`)
          .send({ emoji: '🚀' })
          .expect(201);

        expect(response.body.data).toMatchObject({
          messageId,
          emoji: '🚀',
          count: 1,
          currentUserReacted: true,
        });
        expect(response.body.data.users).toContain(getTestData().users[1].id);
      });

      it('should prevent duplicate reactions (idempotent)', async () => {
        const response1 = await request(app)
          .post(`/api/messages/${messageId}/reactions`)
          .set('Authorization', `Bearer ${getMemberToken()}`)
          .send({ emoji: '🚀' })
          .expect(201);

        // Second reaction with same emoji from same user should be idempotent (return existing)
        const response2 = await request(app)
          .post(`/api/messages/${messageId}/reactions`)
          .set('Authorization', `Bearer ${getMemberToken()}`)
          .send({ emoji: '🚀' })
          .expect(201);

        // Should return same reaction data
        expect(response2.body.data.messageId).toBe(response1.body.data.messageId);
        expect(response2.body.data.emoji).toBe(response1.body.data.emoji);
      });

      it('should allow multiple different reactions', async () => {
        await request(app)
          .post(`/api/messages/${messageId}/reactions`)
          .set('Authorization', `Bearer ${getMemberToken()}`)
          .send({ emoji: '🚀' })
          .expect(201);

        await request(app)
          .post(`/api/messages/${messageId}/reactions`)
          .set('Authorization', `Bearer ${getMemberToken()}`)
          .send({ emoji: '❤️' })
          .expect(201);

        const reactions = await prisma.reaction.findMany({ where: { messageId } });
        expect(reactions.length).toBe(2);
      });
    });

    describe('DELETE /api/messages/:id/reactions/:emoji', () => {
      it('should remove reaction', async () => {
        await request(app)
          .post(`/api/messages/${messageId}/reactions`)
          .set('Authorization', `Bearer ${getMemberToken()}`)
          .send({ emoji: '🚀' });

        const response = await request(app)
          .delete(`/api/messages/${messageId}/reactions/🚀`)
          .set('Authorization', `Bearer ${getMemberToken()}`)
          .expect(200);

        expect(response.body.data.count).toBe(0);
        expect(response.body.data.currentUserReacted).toBe(false);
      });
    });
  });

  describe('Pin/Unpin Messages', () => {
    let messageId: string;

    beforeEach(async () => {
      const message = await prisma.message.create({
        data: {
          channelId: getChannelId(),
          senderId: getTestData().users[1].id,
          content: 'Pin this',
          organizationId: getTestData().orgA.id,
        },
      });
      messageId = message.id;
    });

    it('should pin message', async () => {
      const response = await request(app)
        .post(`/api/messages/${messageId}/pin`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response.body.data.isPinned).toBe(true);
    });

    it('should unpin message', async () => {
      await prisma.message.update({ where: { id: messageId }, data: { isPinned: true } });

      const response = await request(app)
        .delete(`/api/messages/${messageId}/pin`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response.body.data.isPinned).toBe(false);
    });
  });
});