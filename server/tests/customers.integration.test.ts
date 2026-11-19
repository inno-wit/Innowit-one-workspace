import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { testState, initializeTestDatabase } from './db-singleton';
import customerRoutes from '../routes/customers';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';

describe('Gate P3.1: Customers and Contacts Integration Tests', () => {
  let app: express.Express;
  let prisma: PrismaClient;

  beforeAll(async () => {
    await initializeTestDatabase();
    prisma = testState.prisma!;

    app = express();
    app.use(express.json());
    app.use('/api/customers', customerRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  const getAdminToken = () => testState.adminToken;
  const getOtherOrgToken = () => testState.otherOrgToken;

  describe('POST /api/customers - Create Customer', () => {
    it('should create customer scoped to authenticated user organization', async () => {
      const code = `CUST-TEST-${Date.now()}`;
      const res = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          customerCode: code,
          name: 'Nairobi Tech Hub',
          companyName: 'Nairobi Tech Hub Ltd',
          kraPin: 'P051234567Z',
          email: 'info@nairobitech.co.ke',
          phone: '+254712345678',
          billingAddress: 'Kilimani, Nairobi',
          creditLimit: 500000,
          paymentTermsDays: 30,
          lifecycle: 'ACTIVE',
          type: 'CORPORATE',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.customerCode).toBe(code);
      expect(res.body.data.organizationId).toBe(testState.testData.orgA.id);

      // Verify row in real PostgreSQL
      const row = await prisma.customer.findUnique({ where: { id: res.body.data.id } });
      expect(row).not.toBeNull();
      expect(row!.organizationId).toBe(testState.testData.orgA.id);
      expect(row!.lifecycle).toBe('ACTIVE');
    });

    it('should ignore client-supplied organizationId and use authenticated context', async () => {
      const code = `CUST-SEC-${Date.now()}`;
      const res = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          customerCode: code,
          name: 'Security Test Customer',
          organizationId: testState.testData.orgB.id, // Attempt to spoof Org B
        });

      expect(res.status).toBe(201);
      expect(res.body.data.organizationId).toBe(testState.testData.orgA.id);
    });

    it('should enforce customerCode uniqueness within organization', async () => {
      const code = `CUST-UNIQ-${Date.now()}`;
      // Create first customer
      const res1 = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({ customerCode: code, name: 'First Corp' });
      expect(res1.status).toBe(201);

      // Attempt duplicate code in same org
      const res2 = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({ customerCode: code, name: 'Duplicate Corp' });
      expect([400, 409]).toContain(res2.status);
      expect(res2.body.error).toMatch(/already exists/i);
    });

    it('should allow Org B to use the same customerCode as Org A (tenant-scoped uniqueness)', async () => {
      const code = `CUST-SHARED-${Date.now()}`;
      // Org A creates customer
      const resA = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({ customerCode: code, name: 'Org A Customer' });
      expect(resA.status).toBe(201);

      // Org B creates customer with identical code
      const resB = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${getOtherOrgToken()}`)
        .send({ customerCode: code, name: 'Org B Customer' });
      expect(resB.status).toBe(201);
      expect(resB.body.data.customerCode).toBe(code);
      expect(resB.body.data.organizationId).toBe(testState.testData.orgB.id);
    });

    it('should reject invalid KRA PIN formats', async () => {
      const res = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          customerCode: `CUST-KRA-${Date.now()}`,
          name: 'Invalid PIN Corp',
          kraPin: 'INVALID123', // Does not match /^[A-Z]\d{9}[A-Z]$/
        });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/customers - List and Filter', () => {
    it('should list customers with pagination and tenant isolation', async () => {
      const res = await request(app)
        .get('/api/customers?page=1&limit=10')
        .set('Authorization', `Bearer ${getAdminToken()}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.page).toBe(1);

      // All returned customers must belong to Org A
      for (const cust of res.body.data) {
        expect(cust.organizationId).toBe(testState.testData.orgA.id);
      }
    });

    it('should filter customers by lifecycle (LEAD, ACTIVE, INACTIVE)', async () => {
      const res = await request(app)
        .get('/api/customers?lifecycle=ACTIVE')
        .set('Authorization', `Bearer ${getAdminToken()}`);

      expect(res.status).toBe(200);
      for (const cust of res.body.data) {
        expect(cust.lifecycle).toBe('ACTIVE');
      }
    });
  });

  describe('GET /api/customers/:id - Retrieve Details', () => {
    it('should retrieve customer details with persisted counts and relations', async () => {
      const createRes = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({ customerCode: `CUST-GET-${Date.now()}`, name: 'Get Test Corp' });
      const custId = createRes.body.data.id;

      const getRes = await request(app)
        .get(`/api/customers/${custId}`)
        .set('Authorization', `Bearer ${getAdminToken()}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.id).toBe(custId);
      expect(getRes.body.data.contacts).toBeDefined();
      expect(getRes.body.data.deals).toBeDefined();
    });

    it('should block Org B from reading Org A customer by ID', async () => {
      const createRes = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({ customerCode: `CUST-ISO-${Date.now()}`, name: 'Org A Secret Corp' });
      const custId = createRes.body.data.id;

      const res = await request(app)
        .get(`/api/customers/${custId}`)
        .set('Authorization', `Bearer ${getOtherOrgToken()}`);

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/customers/:id - Update Customer', () => {
    it('should update customer lifecycle and details', async () => {
      const createRes = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({ customerCode: `CUST-UPD-${Date.now()}`, name: 'Updatable Corp', lifecycle: 'LEAD' });
      const custId = createRes.body.data.id;

      const updateRes = await request(app)
        .put(`/api/customers/${custId}`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          lifecycle: 'ACTIVE',
          billingAddress: 'Updated Address 123',
          creditLimit: 750000,
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.lifecycle).toBe('ACTIVE');
      expect(Number(updateRes.body.data.creditLimit)).toBe(750000);

      // Verify PostgreSQL state
      const dbRow = await prisma.customer.findUnique({ where: { id: custId } });
      expect(dbRow!.lifecycle).toBe('ACTIVE');
      expect(dbRow!.billingAddress).toBe('Updated Address 123');
    });
  });

  describe('Customer Contacts API', () => {
    it('should create and retrieve contacts linked to customer', async () => {
      const custRes = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({ customerCode: `CUST-CNT-${Date.now()}`, name: 'Contact Parent Corp' });
      const custId = custRes.body.data.id;

      const contactRes = await request(app)
        .post(`/api/customers/${custId}/contacts`)
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          firstName: 'Grace',
          lastName: 'Muthoni',
          email: 'grace@parentcorp.co.ke',
          phone: '+254722001122',
          jobTitle: 'Procurement Director',
          isPrimary: true,
        });

      expect(contactRes.status).toBe(201);
      expect(contactRes.body.data.firstName).toBe('Grace');
      expect(contactRes.body.data.isPrimary).toBe(true);

      // Verify contact in database
      const dbContact = await prisma.customerContact.findUnique({ where: { id: contactRes.body.data.id } });
      expect(dbContact).not.toBeNull();
      expect(dbContact!.customerId).toBe(custId);
      expect(dbContact!.isPrimary).toBe(true);
    });

    it('should block Org B from adding contact to Org A customer', async () => {
      const custRes = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({ customerCode: `CUST-XCNT-${Date.now()}`, name: 'Cross Contact Corp' });
      const custId = custRes.body.data.id;

      const contactRes = await request(app)
        .post(`/api/customers/${custId}/contacts`)
        .set('Authorization', `Bearer ${getOtherOrgToken()}`)
        .send({
          firstName: 'Attacker',
          lastName: 'User',
          email: 'attacker@evil.com',
        });

      expect([403, 404]).toContain(contactRes.status);
    });
  });
});
