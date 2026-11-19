import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { testState, initializeTestDatabase } from './db-singleton';
import crmAnalyticsRoutes from '../routes/crmAnalytics';
import dealRoutes from '../routes/deals';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';

describe('Gate P3.4 & P3.7: CRM Analytics and Date Correctness Tests', () => {
  let app: express.Express;
  let prisma: PrismaClient;
  let customerId: string;
  let assigneeId: string;

  beforeAll(async () => {
    await initializeTestDatabase();
    prisma = testState.prisma!;

    app = express();
    app.use(express.json());
    app.use('/api/crm/analytics', crmAnalyticsRoutes);
    app.use('/api/deals', dealRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);

    const cust = await prisma.customer.create({
      data: {
        organizationId: testState.testData.orgA.id,
        customerCode: `ANLY-CUST-${Date.now()}`,
        name: 'Analytics Test Customer',
      },
    });
    customerId = cust.id;
    assigneeId = testState.testData.users[0].id;
  });

  const getAdminToken = () => testState.adminToken;
  const getOtherOrgToken = () => testState.otherOrgToken;

  describe('Gate P3.4 Date Correctness: closedAt vs updatedAt', () => {
    it('editing a closed deal description or value must NOT shift its closedAt timestamp', async () => {
      const fixedCloseDate = new Date('2026-05-15T10:00:00.000Z');
      const deal = await prisma.deal.create({
        data: {
          organizationId: testState.testData.orgA.id,
          customerId,
          assignedToId: assigneeId,
          title: 'Initial Deal Title',
          value: 1000000,
          stage: 'CLOSED',
          closeOutcome: 'WON',
          closedAt: fixedCloseDate,
          winProbability: 100,
        },
      });

      // Update the deal's title and value
      const updateRes = await request(app)
        .put(`/api/deals/${deal.id}`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          title: 'Revised Deal Title After Close',
          value: 1200000,
        });

      expect(updateRes.status).toBe(200);

      // Verify closedAt is unchanged in PostgreSQL
      const refreshed = await prisma.deal.findUnique({ where: { id: deal.id } });
      expect(refreshed!.title).toBe('Revised Deal Title After Close');
      expect(Number(refreshed!.value)).toBe(1200000);
      expect(refreshed!.closedAt!.toISOString()).toBe(fixedCloseDate.toISOString());
    });
  });

  describe('Gate P3.7 CRM Analytics KPIs', () => {
    it('should calculate pipeline and won revenue accurately from PostgreSQL records', async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

      // Create an open deal
      await prisma.deal.create({
        data: {
          organizationId: testState.testData.orgA.id,
          customerId,
          assignedToId: assigneeId,
          title: 'Open Deal for Analytics',
          value: 500000,
          stage: 'PROPOSAL',
          winProbability: 75,
          expectedCloseDate: now,
        },
      });

      // Create a won deal closed this month
      await prisma.deal.create({
        data: {
          organizationId: testState.testData.orgA.id,
          customerId,
          assignedToId: assigneeId,
          title: 'Won Deal for Analytics',
          value: 800000,
          stage: 'CLOSED',
          closeOutcome: 'WON',
          closedAt: now,
          winProbability: 100,
        },
      });

      const res = await request(app)
        .get(`/api/crm/analytics/dashboard?dateRange=CUSTOM&periodStart=${monthStart}&periodEnd=${monthEnd}`)
        .set('Authorization', `Bearer ${getAdminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.metrics).toBeDefined();
      expect(res.body.data.metrics.wonRevenue).toBeGreaterThanOrEqual(800000);
      expect(res.body.data.metrics.totalPipelineValue).toBeGreaterThanOrEqual(500000);
      expect(res.body.data.metrics.dealsByStage).toBeDefined();
    });

    it('should enforce tenant isolation in analytics: Org B sees 0 of Org A deals', async () => {
      const res = await request(app)
        .get('/api/crm/analytics/dashboard')
        .set('Authorization', `Bearer ${getOtherOrgToken()}`);

      expect(res.status).toBe(200);
      // Org B has no deals created in Org A's setup
      expect(res.body.data.metrics.wonRevenue).toBe(0);
      expect(res.body.data.metrics.totalPipelineValue).toBe(0);
    });

    it('should aggregate sales representative performance metrics', async () => {
      const res = await request(app)
        .get('/api/crm/analytics/rep-performance')
        .set('Authorization', `Bearer ${getAdminToken()}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      const rep = res.body.data.find((r: any) => r.id === assigneeId);
      if (rep) {
        expect(rep.metrics.wonRevenue).toBeDefined();
        expect(rep.metrics.winRate).toBeDefined();
      }
    });
  });
});
