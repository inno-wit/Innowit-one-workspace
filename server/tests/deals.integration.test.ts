import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { testState, initializeTestDatabase } from './db-singleton';
import dealRoutes from '../routes/deals';
import customerRoutes from '../routes/customers';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';

describe('Gate P3.2: Deals and Sales Pipeline Integration Tests', () => {
  let app: express.Express;
  let prisma: PrismaClient;
  let customerId: string;
  let assigneeId: string;

  beforeAll(async () => {
    await initializeTestDatabase();
    prisma = testState.prisma!;

    app = express();
    app.use(express.json());
    app.use('/api/deals', dealRoutes);
    app.use('/api/customers', customerRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);

    // Create a base customer in Org A
    const cust = await prisma.customer.create({
      data: {
        organizationId: testState.testData.orgA.id,
        customerCode: `DEAL-CUST-${Date.now()}`,
        name: 'Enterprise Client for Deals',
      },
    });
    customerId = cust.id;
    assigneeId = testState.testData.users[0].id;
  });

  const getAdminToken = () => testState.adminToken;
  const getOtherOrgToken = () => testState.otherOrgToken;

  describe('POST /api/deals - Create Deal', () => {
    it('should create a deal with organization-scoping and initial stage', async () => {
      const res = await request(app)
        .post('/api/deals')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          customerId,
          assignedToId: assigneeId,
          title: 'Cloud Infrastructure Upgrade 2026',
          value: 2500000,
          currency: 'KES',
          stage: 'NEW_LEAD',
          winProbability: 20,
          expectedCloseDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.organizationId).toBe(testState.testData.orgA.id);
      expect(res.body.data.stage).toBe('NEW_LEAD');
      expect(Number(res.body.data.value)).toBe(2500000);
      expect(res.body.data.version).toBe(1);

      // Verify row in PostgreSQL
      const row = await prisma.deal.findUnique({ where: { id: res.body.data.id } });
      expect(row).not.toBeNull();
      expect(row!.organizationId).toBe(testState.testData.orgA.id);
    });

    it('should block creating deal referencing another organization customer', async () => {
      // Create a customer in Org B
      const orgBCust = await prisma.customer.create({
        data: {
          organizationId: testState.testData.orgB.id,
          customerCode: `ORGB-CUST-${Date.now()}`,
          name: 'Org B Customer',
        },
      });

      const res = await request(app)
        .post('/api/deals')
        .set('Authorization', `Bearer ${getAdminToken()}`) // Org A user trying to use Org B customer
        .send({
          customerId: orgBCust.id,
          assignedToId: assigneeId,
          title: 'Illegal Cross-Tenant Deal',
          value: 100000,
        });

      expect([403, 404]).toContain(res.status);
    });
  });

  describe('POST /api/deals/:id/stage - Stage Transitions & Outcomes', () => {
    it('should advance deal through intermediate stages updating probability', async () => {
      const deal = await prisma.deal.create({
        data: {
          organizationId: testState.testData.orgA.id,
          customerId,
          assignedToId: assigneeId,
          title: 'Progressive Deal',
          value: 1200000,
          stage: 'NEW_LEAD',
          winProbability: 20,
        },
      });

      // Transition to QUALIFIED
      const res = await request(app)
        .post(`/api/deals/${deal.id}/stage`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          stage: 'QUALIFIED',
          reason: 'BANT criteria met',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.stage).toBe('QUALIFIED');
      expect(res.body.data.winProbability).toBe(60);
      expect(res.body.data.version).toBe(2);

      // Check DealStageHistory
      const history = await prisma.dealStageHistory.findMany({
        where: { dealId: deal.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(history.length).toBe(1);
      expect(history[0].fromStage).toBe('NEW_LEAD');
      expect(history[0].toStage).toBe('QUALIFIED');
      expect(history[0].reason).toBe('BANT criteria met');
    });

    it('should reject closing deal without mandatory closeOutcome (WON/LOST)', async () => {
      const deal = await prisma.deal.create({
        data: {
          organizationId: testState.testData.orgA.id,
          customerId,
          assignedToId: assigneeId,
          title: 'Outcome Test Deal',
          value: 500000,
          stage: 'NEGOTIATION',
        },
      });

      const res = await request(app)
        .post(`/api/deals/${deal.id}/stage`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          stage: 'CLOSED',
          // closeOutcome missing!
        });

      expect(res.status).toBe(400);
    });

    it('should reject closing deal as LOST without mandatory lostReason', async () => {
      const deal = await prisma.deal.create({
        data: {
          organizationId: testState.testData.orgA.id,
          customerId,
          assignedToId: assigneeId,
          title: 'Lost Reason Test Deal',
          value: 300000,
          stage: 'NEGOTIATION',
        },
      });

      const res = await request(app)
        .post(`/api/deals/${deal.id}/stage`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          stage: 'CLOSED',
          closeOutcome: 'LOST',
          // lostReason missing!
        });

      expect(res.status).toBe(400);
    });

    it('should close deal as WON with closedAt timestamp and winProbability=100', async () => {
      const deal = await prisma.deal.create({
        data: {
          organizationId: testState.testData.orgA.id,
          customerId,
          assignedToId: assigneeId,
          title: 'Won Deal Verification',
          value: 3500000,
          stage: 'NEGOTIATION',
        },
      });

      const beforeTime = new Date();
      const res = await request(app)
        .post(`/api/deals/${deal.id}/stage`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          stage: 'CLOSED',
          closeOutcome: 'WON',
          finalAmount: 3500000,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.stage).toBe('CLOSED');
      expect(res.body.data.closeOutcome).toBe('WON');
      expect(res.body.data.winProbability).toBe(100);

      // Verify closedAt field in PostgreSQL
      const dbDeal = await prisma.deal.findUnique({ where: { id: deal.id } });
      expect(dbDeal!.closedAt).not.toBeNull();
      expect(new Date(dbDeal!.closedAt!).getTime()).toBeGreaterThanOrEqual(beforeTime.getTime() - 2000);
    });

    it('should close deal as LOST with mandatory reason', async () => {
      const deal = await prisma.deal.create({
        data: {
          organizationId: testState.testData.orgA.id,
          customerId,
          assignedToId: assigneeId,
          title: 'Competitor Lost Deal',
          value: 800000,
          stage: 'NEGOTIATION',
        },
      });

      const res = await request(app)
        .post(`/api/deals/${deal.id}/stage`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          stage: 'CLOSED',
          closeOutcome: 'LOST',
          lostReason: 'COMPETITOR_PRICE',
          lostNotes: 'Competitor offered 15% discount',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.stage).toBe('CLOSED');
      expect(res.body.data.closeOutcome).toBe('LOST');
      expect(res.body.data.lostReason).toBe('COMPETITOR_PRICE');
      expect(res.body.data.winProbability).toBe(0);
    });
  });

  describe('POST /api/deals/:id/reopen - Reopen Deal', () => {
    it('should reopen closed deal, set stage=NEGOTIATION, clear closedAt, and create stage history', async () => {
      const deal = await prisma.deal.create({
        data: {
          organizationId: testState.testData.orgA.id,
          customerId,
          assignedToId: assigneeId,
          title: 'Reopenable Deal',
          value: 1000000,
          stage: 'CLOSED',
          closeOutcome: 'LOST',
          lostReason: 'BUDGET_CONSTRAINTS',
          closedAt: new Date(Date.now() - 86400000),
          version: 2,
        },
      });

      const res = await request(app)
        .post(`/api/deals/${deal.id}/reopen`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          reason: 'Client secured Q4 supplementary budget',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.stage).toBe('NEGOTIATION');
      expect(res.body.data.closeOutcome).toBeNull();
      expect(res.body.data.reopenedAt).not.toBeNull();
      expect(res.body.data.reopenReason).toBe('Client secured Q4 supplementary budget');
      expect(res.body.data.version).toBe(3);

      // Verify closedAt is cleared in database
      const dbDeal = await prisma.deal.findUnique({ where: { id: deal.id } });
      expect(dbDeal!.closedAt).toBeNull();
      expect(dbDeal!.stage).toBe('NEGOTIATION');

      // Verify history row exists
      const history = await prisma.dealStageHistory.findMany({
        where: { dealId: deal.id, toStage: 'NEGOTIATION' },
      });
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].reason).toContain('Client secured Q4 supplementary budget');
    });

    it('should reject reopening a deal that is not closed', async () => {
      const deal = await prisma.deal.create({
        data: {
          organizationId: testState.testData.orgA.id,
          customerId,
          assignedToId: assigneeId,
          title: 'Already Open Deal',
          value: 500000,
          stage: 'QUALIFIED',
        },
      });

      const res = await request(app)
        .post(`/api/deals/${deal.id}/reopen`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({ reason: 'Try to reopen open deal' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_STATE');
    });
  });
});
