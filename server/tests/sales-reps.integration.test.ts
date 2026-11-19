import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { testState, initializeTestDatabase } from './db-singleton';
import salesRepRoutes from '../routes/salesReps';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';

describe('Gate P3.6: Sales Representatives, Quotas and Commissions Tests', () => {
  let app: express.Express;
  let prisma: PrismaClient;
  let userId: string;
  let dealId: string;

  beforeAll(async () => {
    await initializeTestDatabase();
    prisma = testState.prisma!;

    app = express();
    app.use(express.json());
    app.use('/api/sales-reps', salesRepRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);

    // Create a user with SALES_REP role in Org A
    const repUser = await prisma.user.create({
      data: {
        organizationId: testState.testData.orgA.id,
        email: `salesrep-${Date.now()}@orga.com`,
        passwordHash: 'dummy',
        fullName: 'Jane Wambui (Sales Rep)',
        role: 'SALES_REP',
      },
    });
    userId = repUser.id;

    // Create a customer and won deal for commission testing
    const cust = await prisma.customer.create({
      data: {
        organizationId: testState.testData.orgA.id,
        customerCode: `REP-CUST-${Date.now()}`,
        name: 'Rep Testing Customer',
      },
    });

    const deal = await prisma.deal.create({
      data: {
        organizationId: testState.testData.orgA.id,
        customerId: cust.id,
        assignedToId: userId,
        title: 'Commission Eligible Deal',
        value: 1000000,
        currency: 'KES',
        stage: 'CLOSED',
        closeOutcome: 'WON',
        closedAt: new Date(),
        winProbability: 100,
      },
    });
    dealId = deal.id;
  });

  const getAdminToken = () => testState.adminToken;
  const getOtherOrgToken = () => testState.otherOrgToken;

  describe('SalesRep Quotas API', () => {
    it('should create quota for sales representative scoped to organization', async () => {
      const start = new Date('2026-01-01T00:00:00Z');
      const end = new Date('2026-01-31T23:59:59Z');

      const res = await request(app)
        .post('/api/sales-reps/quotas')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          userId,
          periodStart: start.toISOString(),
          periodEnd: end.toISOString(),
          periodType: 'MONTHLY',
          metric: 'REVENUE',
          targetValue: 5000000,
          currency: 'KES',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.organizationId).toBe(testState.testData.orgA.id);
      expect(Number(res.body.data.targetValue)).toBe(5000000);

      // Verify in PostgreSQL
      const row = await prisma.salesRepQuota.findUnique({ where: { id: res.body.data.id } });
      expect(row).not.toBeNull();
      expect(row!.organizationId).toBe(testState.testData.orgA.id);
    });

    it('should reject overlapping duplicate quota for the same user, metric, and period', async () => {
      const start = new Date('2026-02-01T00:00:00Z');
      const end = new Date('2026-02-28T23:59:59Z');

      // Create first quota
      const res1 = await request(app)
        .post('/api/sales-reps/quotas')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          userId,
          periodStart: start.toISOString(),
          periodEnd: end.toISOString(),
          periodType: 'MONTHLY',
          metric: 'REVENUE',
          targetValue: 3000000,
        });
      expect(res1.status).toBe(201);

      // Attempt duplicate quota
      const res2 = await request(app)
        .post('/api/sales-reps/quotas')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          userId,
          periodStart: start.toISOString(),
          periodEnd: end.toISOString(),
          periodType: 'MONTHLY',
          metric: 'REVENUE',
          targetValue: 4000000,
        });

      expect([400, 409]).toContain(res2.status);
      expect(res2.body.error).toMatch(/overlapping|exists/i);
    });
  });

  describe('Commission Rules and Calculation', () => {
    let ruleId: string;

    it('should create commission rule and calculate commission deterministically', async () => {
      const ruleRes = await request(app)
        .post('/api/sales-reps/commission-rules')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          name: 'Standard Deal Win 5%',
          effectiveFrom: new Date('2026-01-01').toISOString(),
          basis: 'DEAL_VALUE',
          rateType: 'FLAT',
          rateValue: 5.0,
          eligibleDealStages: ['CLOSED'],
          requiresApproval: true,
        });

      expect(ruleRes.status).toBe(201);
      ruleId = ruleRes.body.data.id;

      // Calculate commission for the won deal
      const calcRes = await request(app)
        .post('/api/sales-reps/commission-records/calculate')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          dealId,
          ruleId,
        });

      expect(calcRes.status).toBe(201);
      expect(Number(calcRes.body.data.amount)).toBe(50000); // 5% of 1,000,000 = 50,000
      expect(calcRes.body.data.status).toBe('PENDING');

      // Attempt recalculation: should return existing record (idempotency key)
      const recalcRes = await request(app)
        .post('/api/sales-reps/commission-records/calculate')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          dealId,
          ruleId,
        });

      expect(recalcRes.status).toBe(200);
      expect(recalcRes.body.data.id).toBe(calcRes.body.data.id);
    });

    it('should approve commission record with audit trail', async () => {
      // Find the commission record
      const record = await prisma.commissionRecord.findFirst({
        where: { dealId, organizationId: testState.testData.orgA.id },
      });
      expect(record).not.toBeNull();

      const approveRes = await request(app)
        .post('/api/sales-reps/commission-records/approve')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({ commissionRecordIds: [record!.id] });

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.approved).toBe(1);

      // Verify in PostgreSQL
      const dbRecord = await prisma.commissionRecord.findUnique({ where: { id: record!.id } });
      expect(dbRecord!.status).toBe('APPROVED');
      expect(dbRecord!.approvedAt).not.toBeNull();
    });
  });
});
