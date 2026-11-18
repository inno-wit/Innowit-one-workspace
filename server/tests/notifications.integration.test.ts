import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { testState, initializeTestDatabase } from './db-singleton';
import notificationRoutes from '../routes/notifications';
import { authenticateToken } from '../middleware/auth';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';

describe('Notifications API Integration Tests', () => {
  let app: express.Express;
  let prisma: PrismaClient;

  beforeAll(async () => {
    await initializeTestDatabase();
    prisma = testState.prisma;

    app = express();
    app.use(express.json());
    app.use('/api/notifications', authenticateToken, notificationRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  afterAll(async () => {
    // Global teardown handles disconnect
  });

  // Clean test-specific data before each test
  beforeEach(async () => {
    // Only clean up test channels that start with 'test-' prefix
    await prisma.reaction.deleteMany({ where: { message: { channel: { name: { startsWith: 'test-' } } } } });
    await prisma.message.deleteMany({ where: { channel: { name: { startsWith: 'test-' } } } });
    await prisma.channelMember.deleteMany({ where: { channel: { name: { startsWith: 'test-' } } } });
    await prisma.channel.deleteMany({ where: { name: { startsWith: 'test-' } } });
    // Clean up notifications for test users
    await prisma.notification.deleteMany({ where: { user: { email: { contains: 'test-' } } } });
  });

  const getMemberToken = () => testState.memberToken;
  const getAdminToken = () => testState.adminToken;
  const getOtherOrgToken = () => testState.otherOrgToken;
  const getTestData = () => testState.testData;
  const getChannelId = () => testState.channelId;

  describe('GET /api/notifications', () => {
    it('should return paginated notifications for user', async () => {
      const response = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.pagination).toBeDefined();
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/notifications?page=1&limit=5')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(5);
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(5);
    });

    it('should filter by read status', async () => {
      const response = await request(app)
        .get('/api/notifications?unreadOnly=true')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response.body.data).toBeInstanceOf(Array);
      for (const notification of response.body.data) {
        expect(notification.isRead).toBe(false);
      }
    });
  });

  describe('POST /api/notifications/:id/read', () => {
    let notificationId: string;

    beforeEach(async () => {
      const notification = await prisma.notification.create({
        data: {
          organizationId: getTestData().orgA.id,
          userId: getTestData().users[1].id,
          type: 'MENTION',
          title: 'Test Notification',
          body: 'You were mentioned',
          isRead: false,
        },
      });
      notificationId = notification.id;
    });

    it('should mark notification as read', async () => {
      const response = await request(app)
        .post(`/api/notifications/${notificationId}/read`)
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(response.body.data.isRead).toBe(true);

      const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
      expect(notification?.isRead).toBe(true);
      expect(notification?.readAt).not.toBeNull();
    });

    it('should reject marking other user notification as read', async () => {
      await request(app)
        .post(`/api/notifications/${notificationId}/read`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .expect(403);
    });
  });

  describe('POST /api/notifications/read-all', () => {
    it('should mark all notifications as read', async () => {
      // Create some unread notifications
      await prisma.notification.createMany({
        data: [
          {
            organizationId: getTestData().orgA.id,
            userId: getTestData().users[1].id,
            type: 'MENTION',
            title: 'Test 1',
            body: 'Body 1',
            isRead: false,
          },
          {
            organizationId: getTestData().orgA.id,
            userId: getTestData().users[1].id,
            type: 'MENTION',
            title: 'Test 2',
            body: 'Body 2',
            isRead: false,
          },
        ],
      });

      const response = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      const unreadCount = await prisma.notification.count({
        where: { userId: getTestData().users[1].id, isRead: false },
      });
      expect(unreadCount).toBe(0);
    });
  });

  describe('GET /api/notifications/unread-count', () => {
    it('should return unread count', async () => {
      await prisma.notification.create({
        data: {
          organizationId: getTestData().orgA.id,
          userId: getTestData().users[1].id,
          type: 'MENTION',
          title: 'Test',
          body: 'Body',
          isRead: false,
        },
      });

      const response = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response.body.data.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Notification Preferences', () => {
    it('should get user notification preferences', async () => {
      const response = await request(app)
        .get('/api/notifications/preferences')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .expect(200);

      expect(response.body.data).toBeDefined();
      expect(response.body.data.desktopEnabled).toBeDefined();
    });

    it('should update notification preferences', async () => {
      const response = await request(app)
        .put('/api/notifications/preferences')
        .set('Authorization', `Bearer ${getMemberToken()}`)
        .send({
          desktopEnabled: false,
          previewEnabled: true,
          quietHoursStart: '22:00',
          quietHoursEnd: '08:00',
        })
        .expect(200);

      expect(response.body.data.desktopEnabled).toBe(false);
      expect(response.body.data.previewEnabled).toBe(true);
    });
  });
});