import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { testState, initializeTestDatabase } from './db-singleton';
import conversationRoutes from '../routes/conversations';
import { authenticateToken } from '../middleware/auth';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';

describe('DM Create-or-Open Concurrency Tests', () => {
  let app: express.Express;
  let prisma: PrismaClient;

  beforeAll(async () => {
    await initializeTestDatabase();
    prisma = testState.prisma!;

    app = express();
    app.use(express.json());
    app.use('/api/conversations', authenticateToken, conversationRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  afterAll(async () => {
    // Global teardown handles disconnect
  });

  const getMemberToken = () => testState.memberToken;
  const getAdminToken = () => testState.adminToken;
  const getTestData = () => testState.testData;

  describe('POST /api/conversations - Concurrent Create-or-Open', () => {
    it('should return same conversation ID for sequential create-or-open calls', async () => {
      const recipientId = getTestData().users[0].id; // Admin user
      const senderToken = getMemberToken(); // Member user

      // First call - may return 201 (new) or 200 (existing from fixture)
      const response1 = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ recipientId })
        .expect(res => expect([200, 201]).toContain(res.status));

      const conversationId1 = response1.body.data.id;
      expect(conversationId1).toBeDefined();

      // Second call - should return existing conversation
      const response2 = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ recipientId })
        .expect(200); // Returns 200 for existing

      expect(response2.body.data.id).toBe(conversationId1);

      // Verify exactly one conversation for this participant pair in DB
      const [userA, userB] = [getTestData().users[1].id, recipientId].sort();
      const directKey = `${getTestData().orgA.id}:${userA}:${userB}`;
      const conversations = await prisma.conversation.findMany({
        where: { directKey },
      });
      expect(conversations.length).toBe(1);
    });

    it('should handle 10 concurrent requests for same participant pair', async () => {
      const recipientId = getTestData().users[0].id; // Admin user
      const senderToken = getMemberToken(); // Member user

      const concurrency = 10;
      const promises = Array(concurrency).fill(null).map(() =>
        request(app)
          .post('/api/conversations')
          .set('Authorization', `Bearer ${senderToken}`)
          .send({ recipientId })
      );

      const responses = await Promise.all(promises);

      // All should succeed (201 for first, 200 for rest) - accept either
      const statusCodes = responses.map(r => r.status);
      expect(statusCodes.every(s => s === 201 || s === 200)).toBe(true);

      // All should return the same conversation ID
      const conversationIds = responses.map(r => r.body.data.id);
      const uniqueIds = new Set(conversationIds);
      expect(uniqueIds.size).toBe(1);

      // Verify exactly one conversation in DB for this pair
      const [userA, userB] = [getTestData().users[1].id, recipientId].sort();
      const directKey = `${getTestData().orgA.id}:${userA}:${userB}`;
      const conversations = await prisma.conversation.findMany({ where: { directKey } });
      expect(conversations.length).toBe(1);

      // Verify only 2 participants in the conversation
      const participants = await prisma.conversationParticipant.findMany({
        where: { conversationId: conversationIds[0] },
      });
      expect(participants.length).toBe(2);
    });

    it('should not create duplicate conversations for same pair in different order (A->B vs B->A)', async () => {
      const userA = getTestData().users[1].id; // Member
      const userB = getTestData().users[0].id; // Admin
      const tokenA = getMemberToken();
      const tokenB = getAdminToken();

      // User A creates conversation with User B
      const response1 = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ recipientId: userB })
        .expect(res => expect([200, 201]).toContain(res.status));

      const conversationId1 = response1.body.data.id;

      // User B creates conversation with User A (reverse order)
      const response2 = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ recipientId: userA })
        .expect(200); // Should return existing

      expect(response2.body.data.id).toBe(conversationId1);

      // Verify only one conversation in DB for this pair
      const [sortedA, sortedB] = [userA, userB].sort();
      const directKey = `${getTestData().orgA.id}:${sortedA}:${sortedB}`;
      const conversations = await prisma.conversation.findMany({ where: { directKey } });
      expect(conversations.length).toBe(1);
    });

    it('should isolate conversations by organization (same users in different orgs = different conversations)', async () => {
      // This test would require users in different orgs with same IDs, which isn't possible
      // Instead, verify that cross-org DM is rejected
      const recipientId = getTestData().users[2].id; // User from orgB
      const senderToken = getMemberToken(); // User from orgA

      await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({ recipientId })
        .expect(404);
    });

    it('should create separate conversations for different participant pairs', async () => {
      const userA = getTestData().users[1].id; // Member
      const userB = getTestData().users[0].id; // Admin
      const userC = getTestData().users[3].id; // Finance
      const tokenA = getMemberToken();

      // A creates DM with B (may already exist from fixture)
      const response1 = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ recipientId: userB })
        .expect(res => expect([200, 201]).toContain(res.status));
      const convId1 = response1.body.data.id;

      // A creates DM with C (may already exist from fixture)
      const response2 = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ recipientId: userC })
        .expect(res => expect([200, 201]).toContain(res.status));
      const convId2 = response2.body.data.id;

      expect(convId1).not.toBe(convId2);

      // Verify both conversations exist with different directKeys
      const directKey1 = `${getTestData().orgA.id}:${[userA, userB].sort().join(':')}`;
      const directKey2 = `${getTestData().orgA.id}:${[userA, userC].sort().join(':')}`;
      const conv1 = await prisma.conversation.findUnique({ where: { directKey: directKey1 } });
      const conv2 = await prisma.conversation.findUnique({ where: { directKey: directKey2 } });
      expect(conv1).toBeDefined();
      expect(conv2).toBeDefined();
      expect(conv1?.id).not.toBe(conv2?.id);
    });

    it('should enforce directKey uniqueness at database level', async () => {
      // Verify the unique index exists and works
      const userA = getTestData().users[1].id;
      const userB = getTestData().users[0].id;
      const directKey = `${getTestData().orgA.id}:${[userA, userB].sort().join(':')}`;

      // Check directKey is populated
      const conv = await prisma.conversation.findFirst({
        where: { directKey },
      });
      expect(conv).toBeDefined();
      expect(conv?.directKey).toBe(directKey);

      // Attempt to create another conversation with same directKey should fail
      await expect(
        prisma.conversation.create({
          data: {
            type: 'DIRECT',
            organizationId: getTestData().orgA.id,
            createdById: userA,
            directKey,
            participants: {
              create: [
                { userId: userA, role: 'MEMBER' },
                { userId: userB, role: 'MEMBER' },
              ],
            },
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('DM Membership and Authorization', () => {
    it('should reject DM to self', async () => {
      const userId = getTestData().users[1].id;
      const token = getMemberToken();

      await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({ recipientId: userId })
        .expect(400);
    });

    it('should verify conversation participant membership on GET', async () => {
      // Use existing conversation between member and admin
      const response = await request(app)
        .post('/api/conversations')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .send({ recipientId: getTestData().users[0].id })
        .expect(res => expect([200, 201]).toContain(res.status));

      const conversationId = response.body.data.id;

      // Member (participant) can access
      await request(app)
        .get(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      // Admin (participant) can access
      await request(app)
        .get(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .expect(200);

      // Other org user cannot access
      await request(app)
        .get(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${testState.otherOrgToken}`)
        .expect(403);
    });
  });
});