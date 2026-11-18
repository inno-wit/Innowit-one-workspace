import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { testState, initializeTestDatabase } from './db-singleton';
import attachmentRoutes from '../routes/attachments';
import { authenticateToken } from '../middleware/auth';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';

describe('Attachments API Integration Tests', () => {
  let app: express.Express;
  let prisma: any;

  beforeAll(async () => {
    await initializeTestDatabase();
    prisma = testState.prisma;

    // Use the existing fixture channel which already has members (admin and member)
    // No need to create a separate channel

    app = express();
    app.use(express.json());
    app.use('/api/attachments', authenticateToken, attachmentRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  afterAll(async () => {
    // No cleanup needed - fixture channel persists
  });

  // Clean up test-specific data before each test
  beforeEach(async () => {
    // Only clean up test channels that start with 'test-' prefix
    await prisma.reaction.deleteMany({ where: { message: { channel: { name: { startsWith: 'test-' } } } } });
    await prisma.message.deleteMany({ where: { channel: { name: { startsWith: 'test-' } } } });
    await prisma.channelMember.deleteMany({ where: { channel: { name: { startsWith: 'test-' } } } });
    await prisma.channel.deleteMany({ where: { name: { startsWith: 'test-' } } });
  });

  const getMemberToken = () => testState.memberToken;
  const getAdminToken = () => testState.adminToken;
  const getOtherOrgToken = () => testState.otherOrgToken;
  const getTestData = () => testState.testData;
  const getChannelId = () => testState.channelId; // Use fixture-test-channel

  it('should initialize an attachment upload', async () => {
    const checksum = crypto.createHash('sha256').update('test file content').digest('hex');
    const response = await request(app)
      .post('/api/attachments/init')
      .set('Authorization', `Bearer ${getMemberToken()}`)
      .send({
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        checksum,
        channelId: getChannelId(),
      })
      .expect(201);

    expect(response.body.data).toBeDefined();
    expect(response.body.data.id).toBeDefined();
    expect(response.body.data.uploadUrl).toBeDefined();
    expect(response.body.data.key).toBeDefined();
  });

  it('should reject upload with invalid checksum format', async () => {
    await request(app)
      .post('/api/attachments/init')
      .set('Authorization', `Bearer ${getMemberToken()}`)
      .send({
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        checksum: 'short-checksum',
        channelId: getChannelId(),
      })
      .expect(400);
  });

  it('should complete upload and update status to COMPLETED', async () => {
    const content = 'sample content';
    const checksum = crypto.createHash('sha256').update(content).digest('hex');
    const initRes = await request(app)
      .post('/api/attachments/init')
      .set('Authorization', `Bearer ${getMemberToken()}`)
      .send({
        fileName: 'contract.pdf',
        mimeType: 'application/pdf',
        size: Buffer.byteLength(content),
        checksum,
        channelId: getChannelId(),
      })
      .expect(201);

    const attachmentId = initRes.body.data.id;
    const storageKey = initRes.body.data.key;

    // Simulate file storage in dev uploads directory
    const fullPath = path.join('./uploads', storageKey);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);

    const completeRes = await request(app)
      .post(`/api/attachments/${attachmentId}/complete`)
      .set('Authorization', `Bearer ${getMemberToken()}`)
      .expect(200);

    expect(completeRes.body.data.uploadStatus).toBe('COMPLETED');
  });

  it('should get attachment metadata by authorized user', async () => {
    const checksum = crypto.createHash('sha256').update('metadata test').digest('hex');
    const initRes = await request(app)
      .post('/api/attachments/init')
      .set('Authorization', `Bearer ${getMemberToken()}`)
      .send({
        fileName: 'data.csv',
        mimeType: 'text/csv',
        size: 512,
        checksum,
        channelId: getChannelId(),
      })
      .expect(201);

    const attachmentId = initRes.body.data.id;

    const response = await request(app)
      .get(`/api/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${getMemberToken()}`)
      .expect(200);

    expect(response.body.data.fileName).toBe('data.csv');
    expect(response.body.data.fileSize).toBe(512);
  });

  it('should reject attachment access to user from different organization', async () => {
    const checksum = crypto.createHash('sha256').update('secret doc').digest('hex');
    const initRes = await request(app)
      .post('/api/attachments/init')
      .set('Authorization', `Bearer ${getMemberToken()}`)
      .send({
        fileName: 'secret.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        checksum,
        channelId: getChannelId(),
      })
      .expect(201);

    const attachmentId = initRes.body.data.id;

    await request(app)
      .get(`/api/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${getOtherOrgToken()}`)
      .expect(403);
  });

  it('should get download URL for authorized attachment', async () => {
    const content = 'download doc';
    const checksum = crypto.createHash('sha256').update(content).digest('hex');
    const initRes = await request(app)
      .post('/api/attachments/init')
      .set('Authorization', `Bearer ${getMemberToken()}`)
      .send({
        fileName: 'download.pdf',
        mimeType: 'application/pdf',
        size: Buffer.byteLength(content),
        checksum,
        channelId: getChannelId(),
      })
      .expect(201);

    const attachmentId = initRes.body.data.id;
    const storageKey = initRes.body.data.key;

    // Simulate file storage
    const fullPath = path.join('./uploads', storageKey);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);

    await request(app)
      .post(`/api/attachments/${attachmentId}/complete`)
      .set('Authorization', `Bearer ${getMemberToken()}`)
      .expect(200);

    const downloadRes = await request(app)
      .get(`/api/attachments/${attachmentId}/download`)
      .set('Authorization', `Bearer ${getMemberToken()}`)
      .expect(200);

    expect(downloadRes.body.data.downloadUrl).toBeDefined();
    expect(downloadRes.body.data.fileName).toBe('download.pdf');
  });

  it('should allow creator to delete attachment', async () => {
    const checksum = crypto.createHash('sha256').update('delete doc').digest('hex');
    const initRes = await request(app)
      .post('/api/attachments/init')
      .set('Authorization', `Bearer ${getMemberToken()}`)
      .send({
        fileName: 'delete-me.pdf',
        mimeType: 'application/pdf',
        size: 128,
        checksum,
        channelId: getChannelId(),
      })
      .expect(201);

    const attachmentId = initRes.body.data.id;

    await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${getMemberToken()}`)
      .expect(200);

    await request(app)
      .get(`/api/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${getMemberToken()}`)
      .expect(404);
  });
});