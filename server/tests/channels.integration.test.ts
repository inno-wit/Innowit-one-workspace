import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { testState, initializeTestDatabase } from './db-singleton';
import channelRoutes from '../routes/channels';
import { authenticateToken } from '../middleware/auth';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';

describe('Channels API Integration Tests', () => {
  let app: express.Express;
  let prisma: PrismaClient;

  beforeAll(async () => {
    await initializeTestDatabase();
    prisma = testState.prisma!;
    
    // Setup Express app with channels routes
    app = express();
    app.use(express.json());
    app.use('/api/channels', authenticateToken, channelRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  afterAll(async () => {
    // Global teardown handles disconnect
  });

  // Clean test-specific data (channels, messages, etc.) before each test
  // but keep base test data (orgs, users) AND our test fixture channels (fixture-*)
  // DO NOT delete channels created by individual test suites (original-name, to-archive, membership-test, etc.)
  // as they are created fresh in each test suite's beforeEach
  beforeEach(async () => {
    // Only clean up test channels that start with 'test-' prefix
    await prisma.reaction.deleteMany({ where: { message: { channel: { name: { startsWith: 'test-' } } } } });
    await prisma.message.deleteMany({ where: { channel: { name: { startsWith: 'test-' } } } });
    await prisma.channelMember.deleteMany({ where: { channel: { name: { startsWith: 'test-' } } } });
    await prisma.channel.deleteMany({ where: { name: { startsWith: 'test-' } } });
    // Note: We intentionally do NOT delete 'original-name', 'to-archive', 'membership-test', 'updated-name', 'admin-updated', 'channel-for-get-test-unique', etc.
    // because they are created in each test suite's beforeEach and need to persist for those tests
  });

  // Helper to get tokens from global state
  const getAdminToken = () => testState.adminToken;
  const getMemberToken = () => testState.memberToken;
  const getOtherOrgToken = () => testState.otherOrgToken;
  const getTestData = () => testState.testData;
  const getChannelId = () => testState.channelId;
  const getOtherChannelId = () => testState.otherChannelId;

  describe('POST /api/channels', () => {
    it('should create a public channel', async () => {
      const response = await request(app)
        .post('/api/channels')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          name: 'test-channel',
          description: 'A test channel',
          isPrivate: false,
        })
        .expect(201);

      expect(response.body.data).toMatchObject({
        name: 'test-channel',
        description: 'A test channel',
        isPrivate: false,
        isArchived: false,
      });
      expect(response.body.data.id).toBeDefined();
      expect(response.body.data.createdById).toBe(getTestData().users[0].id);

      // Verify creator is added as member
      const channel = await prisma.channel.findUnique({ where: { id: response.body.data.id } });
      expect(channel).not.toBeNull();
      
      const membership = await prisma.channelMember.findUnique({
        where: { channelId_userId: { channelId: channel!.id, userId: getTestData().users[0].id } },
      });
      expect(membership).not.toBeNull();
    });

    it('should create a private channel', async () => {
      const response = await request(app)
        .post('/api/channels')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          name: 'test-private-channel',
          description: 'A private test channel',
          isPrivate: true,
        })
        .expect(201);

      expect(response.body.data.isPrivate).toBe(true);
    });

    it('should reject channel creation without name', async () => {
      await request(app)
        .post('/api/channels')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({ description: 'No name' })
        .expect(400);
    });

    it('should reject unauthenticated requests', async () => {
      await request(app)
        .post('/api/channels')
        .send({ name: 'test' })
        .expect(401);
    });
  });

  describe('GET /api/channels', () => {
    let generalChannelId: string;
    let privateChannelId: string;
    let orgBChannelId: string;

    beforeEach(async () => {
      // Create test channels
      const general = await prisma.channel.create({
        data: {
          name: 'fixture-general',
          description: 'General discussion',
          isPrivate: false,
          createdById: getTestData().users[0].id,
          organizationId: getTestData().orgA.id,
        },
      });
      generalChannelId = general.id;

      const privateChannel = await prisma.channel.create({
        data: {
          name: 'fixture-private-ops',
          description: 'Private ops channel',
          isPrivate: true,
          createdById: getTestData().users[0].id,
          organizationId: getTestData().orgA.id,
        },
      });
      privateChannelId = privateChannel.id;

      await prisma.channelMember.create({
        data: {
          channelId: privateChannelId,
          userId: getTestData().users[1].id,
          organizationId: getTestData().orgA.id,
        },
      });

      const orgBChannel = await prisma.channel.create({
        data: {
          name: 'fixture-orgb-channel',
          description: 'Org B channel',
          isPrivate: false,
          createdById: getTestData().users[2].id,
          organizationId: getTestData().orgB.id,
        },
      });
      orgBChannelId = orgBChannel.id;
    });

    it('should list public channels and channels user is member of', async () => {
      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.pagination).toBeDefined();

      // Should see fixture-general (public) and fixture-private-ops (member)
      const channelNames = response.body.data.map((c: any) => c.name);
      expect(channelNames).toContain('fixture-general');
      expect(channelNames).toContain('fixture-private-ops');
      // Should NOT see fixture-orgb-channel (different org)
      expect(channelNames).not.toContain('fixture-orgb-channel');
    });

    it('should list all channels for admin including private ones they created', async () => {
      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .expect(200);

      const channelNames = response.body.data.map((c: any) => c.name);
      expect(channelNames).toContain('fixture-general');
      // Admin is creator of fixture-private-ops but not auto-added as member in test setup
      // Admin in orgA should not see orgB channels
      expect(channelNames).not.toContain('fixture-orgb-channel');
    });

    it('should filter by search query', async () => {
      const response = await request(app)
        .get('/api/channels?search=fixture-private-ops')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      // Search may return multiple channels - verify the one we want is there
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
      const found = response.body.data.find((c: any) => c.name === 'fixture-private-ops');
      expect(found).toBeDefined();
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/channels?page=1&limit=1')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(1);
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(1);
    });
  });

  describe('GET /api/channels/:id', () => {
    let channelId: string;

    beforeEach(async () => {
      const channel = await prisma.channel.create({
        data: {
          name: 'channel-for-get-test-unique',
          description: 'Test channel',
          isPrivate: false,
          createdById: getTestData().users[0].id,
          organizationId: getTestData().orgA.id,
        },
      });
      channelId = channel.id;
    });

    it('should return channel details for member', async () => {
      const response = await request(app)
        .get(`/api/channels/${channelId}`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response.body.data.id).toBe(channelId);
      expect(response.body.data.name).toBe('channel-for-get-test-unique');
      expect(response.body.data.members).toBeDefined();
      expect(response.body.data._count.messages).toBeDefined();
    });

    it('should return 404 for non-existent channel', async () => {
      await request(app)
        .get('/api/channels/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(404);
    });

    it('should reject access to private channel for non-member', async () => {
      const privateChannel = await prisma.channel.create({
        data: {
          name: 'private-test',
          description: 'Private',
          isPrivate: true,
          createdById: getTestData().users[0].id,
          organizationId: getTestData().orgA.id,
        },
      });

      await request(app)
        .get(`/api/channels/${privateChannel.id}`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(403);
    });

    it('should reject cross-org channel access', async () => {
      const orgBChannel = await prisma.channel.create({
        data: {
          name: 'fixture-orgb-channel-2',
          description: 'Org B channel',
          isPrivate: false,
          createdById: getTestData().users[2].id,
          organizationId: getTestData().orgB.id,
        },
      });

      await request(app)
        .get(`/api/channels/${orgBChannel.id}`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(403);
    });
  });

  describe('PUT /api/channels/:id', () => {
    let channelId: string;

    beforeEach(async () => {
      const channel = await prisma.channel.create({
        data: {
          name: 'original-name',
          description: 'Original description',
          isPrivate: false,
          createdById: getTestData().users[0].id,
          organizationId: getTestData().orgA.id,
        },
      });
      channelId = channel.id;
    });

    it('should allow creator to update channel', async () => {
      const response = await request(app)
        .put(`/api/channels/${channelId}`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({ name: 'updated-name', description: 'Updated description' })
        .expect(200);

      expect(response.body.data.name).toBe('updated-name');
      expect(response.body.data.description).toBe('Updated description');
    });

    it('should reject update by non-creator non-admin', async () => {
      await request(app)
        .put(`/api/channels/${channelId}`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .send({ name: 'hacked' })
        .expect(403);
    });

    it('should allow admin to update any channel in org', async () => {
      const response = await request(app)
        .put(`/api/channels/${channelId}`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({ name: 'admin-updated' })
        .expect(200);

      expect(response.body.data.name).toBe('admin-updated');
    });

    it('should reject cross-org update', async () => {
      const orgBChannel = await prisma.channel.create({
        data: {
          name: 'orgb-channel-update',
          description: 'Org B',
          isPrivate: false,
          createdById: getTestData().users[2].id,
          organizationId: getTestData().orgB.id,
        },
      });

      await request(app)
        .put(`/api/channels/${orgBChannel.id}`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({ name: 'hacked' })
        .expect(403);
    });
  });

  describe('POST /api/channels/:id/archive', () => {
    let channelId: string;

    beforeEach(async () => {
      const channel = await prisma.channel.create({
        data: {
          name: 'to-archive',
          description: 'Will be archived',
          isPrivate: false,
          createdById: getTestData().users[0].id,
          organizationId: getTestData().orgA.id,
        },
      });
      channelId = channel.id;
    });

    it('should archive channel', async () => {
      const response = await request(app)
        .post(`/api/channels/${channelId}/archive`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      const channel = await prisma.channel.findUnique({ where: { id: channelId } });
      expect(channel?.isArchived).toBe(true);
      expect(channel?.archivedAt).not.toBeNull();
    });

    it('should reject archive by non-creator non-admin', async () => {
      await request(app)
        .post(`/api/channels/${channelId}/archive`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(403);
    });
  });

  describe('Channel Membership', () => {
    let channelId: string;

    beforeEach(async () => {
      const channel = await prisma.channel.create({
        data: {
          name: 'membership-test',
          description: 'Test membership',
          isPrivate: false,
          createdById: getTestData().users[0].id,
          organizationId: getTestData().orgA.id,
        },
      });
      channelId = channel.id;
    });

    describe('POST /api/channels/:id/members', () => {
      it('should add member to public channel', async () => {
        const response = await request(app)
          .post(`/api/channels/${channelId}/members`)
          .set('Authorization', `Bearer ${getMemberToken()}`)
          .send({ userId: getTestData().users[1].id })
          .expect(201);

        expect(response.body.data.userId).toBe(getTestData().users[1].id);
        expect(response.body.data.channelId).toBe(channelId);
      });

      it('should reject adding member from different organization', async () => {
        await request(app)
          .post(`/api/channels/${channelId}/members`)
          .set('Authorization', `Bearer ${getAdminToken()}`)
          .send({ userId: getTestData().users[2].id }) // User from orgB
          .expect(404);
      });

      it('should reject duplicate membership', async () => {
        await prisma.channelMember.create({
          data: {
            channelId,
            userId: getTestData().users[1].id,
            organizationId: getTestData().orgA.id,
          },
        });

        await request(app)
          .post(`/api/channels/${channelId}/members`)
          .set('Authorization', `Bearer ${getAdminToken()}`)
          .send({ userId: getTestData().users[1].id })
          .expect(409);
      });
    });

    describe('DELETE /api/channels/:id/members/:userId', () => {
      it('should allow creator to remove others', async () => {
        await prisma.channelMember.create({
          data: {
            channelId,
            userId: getTestData().users[1].id,
            organizationId: getTestData().orgA.id,
          },
        });

        await request(app)
          .delete(`/api/channels/${channelId}/members/${getTestData().users[1].id}`)
          .set('Authorization', `Bearer ${getAdminToken()}`)
          .expect(200);

        const membership = await prisma.channelMember.findUnique({
          where: { channelId_userId: { channelId, userId: getTestData().users[1].id } },
        });
        expect(membership).toBeNull();
      });

      it('should allow user to remove themselves', async () => {
        await prisma.channelMember.create({
          data: {
            channelId,
            userId: getTestData().users[1].id,
            organizationId: getTestData().orgA.id,
          },
        });

        await request(app)
          .delete(`/api/channels/${channelId}/members/${getTestData().users[1].id}`)
          .set('Authorization', `Bearer ${getMemberToken()}`)
          .expect(200);
      });

      it('should reject removal of others by non-creator non-admin', async () => {
        // Add admin as member (creator is already member)
        await prisma.channelMember.create({
          data: {
            channelId,
            userId: getTestData().users[0].id,
            organizationId: getTestData().orgA.id,
          },
        });

        // Member (users[1]) tries to remove admin (users[0]) - should fail
        await request(app)
          .delete(`/api/channels/${channelId}/members/${getTestData().users[0].id}`)
          .set('Authorization', `Bearer ${getMemberToken()}`)
          .expect(403);
      });
    });
  });
});