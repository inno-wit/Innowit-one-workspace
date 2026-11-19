import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { testState, initializeTestDatabase } from './db-singleton';
import dealRoutes from '../routes/deals';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';

describe('Gate P3.3: Deal Concurrency and Lifecycle Integrity Tests', () => {
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
    app.use(notFoundHandler);
    app.use(errorHandler);

    const cust = await prisma.customer.create({
      data: {
        organizationId: testState.testData.orgA.id,
        customerCode: `CONCURR-CUST-${Date.now()}`,
        name: 'Concurrency Testing Corp',
      },
    });
    customerId = cust.id;
    assigneeId = testState.testData.users[0].id;
  });

  const getAdminToken = () => testState.adminToken;

  it('should reject stale version update with 409 VERSION_CONFLICT', async () => {
    const deal = await prisma.deal.create({
      data: {
        organizationId: testState.testData.orgA.id,
        customerId,
        assignedToId: assigneeId,
        title: 'Optimistic Lock Deal',
        value: 1000000,
        stage: 'NEW_LEAD',
        version: 2, // Current version is 2
      },
    });

    // Client sends request with stale version=1
    const res = await request(app)
      .post(`/api/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${getAdminToken()}`)
      .send({
        stage: 'QUALIFIED',
        version: 1, // Stale!
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VERSION_CONFLICT');

    // Confirm DB was untouched
    const freshDeal = await prisma.deal.findUnique({ where: { id: deal.id } });
    expect(freshDeal!.stage).toBe('NEW_LEAD');
    expect(freshDeal!.version).toBe(2);
  });

  it('should handle concurrent stage transitions safely: exactly one wins and losing gets 409', async () => {
    const deal = await prisma.deal.create({
      data: {
        organizationId: testState.testData.orgA.id,
        customerId,
        assignedToId: assigneeId,
        title: 'Concurrent Race Deal',
        value: 2000000,
        stage: 'CONTACTED',
        version: 1,
      },
    });

    // Fire two concurrent requests starting from version 1
    const req1 = request(app)
      .post(`/api/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${getAdminToken()}`)
      .send({ stage: 'QUALIFIED', version: 1, reason: 'Fast User 1' });

    const req2 = request(app)
      .post(`/api/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${getAdminToken()}`)
      .send({ stage: 'PROPOSAL', version: 1, reason: 'Fast User 2' });

    const [res1, res2] = await Promise.all([req1, req2]);

    const statuses = [res1.status, res2.status].sort();
    // One must succeed (200) and one must receive version conflict (409)
    expect(statuses).toEqual([200, 409]);

    const winner = res1.status === 200 ? res1 : res2;
    const loser = res1.status === 409 ? res1 : res2;

    expect(loser.body.code).toBe('VERSION_CONFLICT');
    expect(winner.body.data.version).toBe(2);

    // Database must reflect the winning transition with version 2
    const finalDeal = await prisma.deal.findUnique({ where: { id: deal.id } });
    expect(finalDeal!.version).toBe(2);
    expect(finalDeal!.stage).toBe(winner.body.data.stage);

    // DealStageHistory must have exactly 1 record (the winner's)
    const history = await prisma.dealStageHistory.findMany({ where: { dealId: deal.id } });
    expect(history.length).toBe(1);
    expect(history[0].toStage).toBe(winner.body.data.stage);
  });

  it('should prevent direct stage movement out of CLOSED without using /reopen endpoint', async () => {
    const deal = await prisma.deal.create({
      data: {
        organizationId: testState.testData.orgA.id,
        customerId,
        assignedToId: assigneeId,
        title: 'Closed Deal Guard',
        value: 1500000,
        stage: 'CLOSED',
        closeOutcome: 'LOST',
        lostReason: 'BUDGET',
        closedAt: new Date(),
        version: 1,
      },
    });

    const res = await request(app)
      .post(`/api/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${getAdminToken()}`)
      .send({
        stage: 'NEGOTIATION',
        version: 1,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DEAL_CLOSED');
  });
});
