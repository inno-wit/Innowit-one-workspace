# PHASE 3 API CONTRACT: INNOWIT ONE CRM & SALES PIPELINE

**Document Version:** 1.0.0  
**Date:** 2026-11-19  
**Status:** As-Built  
**Base URL:** `/api`  

---

## 1. Common Patterns

### 1.1 Authentication
All endpoints require `Authorization: Bearer <accessToken>` header.

### 1.2 Tenant Isolation
All queries automatically scoped to `req.user.organizationId` and optionally `req.user.branchId`.

### 1.3 RBAC Enforcement
Each endpoint specifies required roles. Non-managers restricted to own branch/resources.

### 1.4 Response Format
```json
// Success (single)
{ "data": { ... } }

// Success (list with pagination)
{ "data": [...], "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 } }

// Error
{ "error": "Human readable message", "code": "ERROR_CODE", "details": [...] }
```

### 1.5 Error Codes
| Code | HTTP | Description |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing/invalid token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `DUPLICATE_ENTRY` | 409 | Unique constraint violation |
| `VALIDATION_ERROR` | 400 | Zod schema validation failed |
| `VERSION_CONFLICT` | 409 | Optimistic lock failure |
| `INSUFFICIENT_STOCK` | 400 | Inventory reservation failed |
| `DEAL_NOT_WON` | 400 | Operation requires won deal |

---

## 2. Customers (`/api/customers`)

### 2.1 List Customers
```
GET /api/customers
```
**Query Parameters:**
| Param | Type | Default | Description |
|---|---|---|---|
| `page` | int | 1 | Page number |
| `limit` | int | 20 | Items per page (max 100) |
| `search` | string | - | Search name, code, KRA PIN, email, phone |
| `lifecycle` | enum | - | `LEAD` \| `ACTIVE` \| `INACTIVE` |
| `type` | enum | - | `CORPORATE` \| `INDIVIDUAL` |
| `branchId` | uuid | - | Filter by branch |
| `hasKraPin` | boolean | - | Filter by KRA PIN presence |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "organizationId": "uuid",
      "branchId": "uuid",
      "customerCode": "CUST-001",
      "name": "Safaricom PLC",
      "companyName": "Safaricom Telecommunications PLC",
      "kraPin": "P051123456Z",
      "email": "billing@safaricom.co.ke",
      "phone": "+254 722 000 000",
      "city": "Nairobi",
      "billingAddress": "Waiyaki Way...",
      "creditLimit": "25000000.00",
      "paymentTermsDays": 30,
      "lifecycle": "ACTIVE",
      "type": "CORPORATE",
      "leadSource": "Direct Sales Outreach",
      "createdAt": "2025-08-15T00:00:00.000Z",
      "_count": { "deals": 5, "salesOrders": 10, "invoices": 20, "tasks": 3 }
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
}
```

### 2.2 Get Customer Detail (360° View)
```
GET /api/customers/:id
```
**Response:** Customer with nested relations
```json
{
  "data": {
    "id": "uuid",
    "name": "Safaricom PLC",
    "contacts": [...],
    "deals": [...],
    "salesOrders": [...],
    "invoices": [...],
    "tasks": [...],
    "activities": [...],
    "_count": { "deals": 5, "contacts": 3, "salesOrders": 10, "invoices": 20, "tasks": 3, "activities": 15 }
  }
}
```

### 2.3 Create Customer
```
POST /api/customers
```
**Roles:** `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, `SALES_REP`

**Body:**
```json
{
  "customerCode": "CUST-001",
  "name": "Safaricom PLC",
  "companyName": "Safaricom Telecommunications PLC",
  "kraPin": "P051123456Z",
  "email": "billing@safaricom.co.ke",
  "phone": "+254 722 000 000",
  "city": "Nairobi",
  "billingAddress": "Waiyaki Way...",
  "creditLimit": 25000000,
  "paymentTermsDays": 30,
  "lifecycle": "LEAD",
  "type": "CORPORATE",
  "branchId": "uuid",
  "leadSource": "Direct Sales Outreach"
}
```
**Validation:** KRA PIN must match `/^[A-Z]\d{9}[A-Z]$/`. `customerCode` unique per organization.

### 2.4 Update Customer
```
PUT /api/customers/:id
```
**Roles:** `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, `SALES_REP`

### 2.5 Archive Customer
```
DELETE /api/customers/:id
```
**Roles:** `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`
- If dependencies exist: sets `lifecycle=INACTIVE` (soft delete)
- If no dependencies: hard delete

### 2.6 Customer Contacts
```
GET    /api/customers/:customerId/contacts
POST   /api/customers/:customerId/contacts
PUT    /api/customers/:customerId/contacts/:contactId
DELETE /api/customers/:customerId/contacts/:contactId
```
**Primary Contact Enforcement:** Setting `isPrimary=true` unsets other contacts.

### 2.7 Duplicate Detection
```
POST /api/customers/check-duplicates
```
**Body:** `{ name?, kraPin?, email?, phone? }`

---

## 3. Deals (`/api/deals`)

### 3.1 List Deals
```
GET /api/deals
```
**Query Parameters:** `page`, `limit`, `search`, `stage`, `closeOutcome`, `assignedToId`, `customerId`, `branchId`

### 3.2 Get Deal Detail
```
GET /api/deals/:id
```
**Response:** Includes stage history, tasks, quotations

### 3.3 Create Deal
```
POST /api/deals
```
**Roles:** `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, `SALES_REP`

**Body:**
```json
{
  "customerId": "uuid",
  "assignedToId": "uuid",
  "title": "Enterprise License Renewal",
  "value": 5000000,
  "currency": "KES",
  "stage": "NEW_LEAD",
  "winProbability": 20,
  "expectedCloseDate": "2026-12-31T00:00:00.000Z",
  "source": "Direct Sales"
}
```

### 3.4 Update Deal
```
PUT /api/deals/:id
```
**Optimistic Locking:** Provide `version` field matching current.

### 3.5 Stage Transition (Kanban Drag-Drop)
```
POST /api/deals/:id/stage
```
**Roles:** `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, `SALES_REP`

**Body:**
```json
{
  "stage": "PROPOSAL",
  "closeOutcome": "WON",          // Required if stage=CLOSED
  "lostReason": "Budget cut",     // Required if closeOutcome=LOST
  "lostNotes": "Client reduced budget",
  "reason": "Client approved proposal",
  "version": 5,                   // Optimistic locking
  "generateQuotation": true       // Only for CLOSED/WON
}
```

### 3.6 Get Stage History
```
GET /api/deals/:id/stage-history
```

---

## 4. Tasks (`/api/tasks`)

### 4.1 List Tasks
```
GET /api/tasks
```
**Query Parameters:** `page`, `limit`, `search`, `status`, `priority`, `assignedToId`, `customerId`, `dealId`, `projectId`, `salesOrderId`, `overdue`, `dueBefore`, `dueAfter`

### 4.2 Create Task
```
POST /api/tasks
```
**Body:**
```json
{
  "title": "Follow up on proposal",
  "description": "Send revised SLA",
  "priority": "HIGH",
  "dueDate": "2026-12-15T00:00:00.000Z",
  "assignedToId": "uuid",
  "customerId": "uuid",
  "dealId": "uuid",
  "projectId": "uuid",
  "salesOrderId": "uuid",
  "reminderAt": "2026-12-14T09:00:00.000Z"
}
```

### 4.3 Complete Task
```
POST /api/tasks/:id/complete
```

### 4.4 Snooze Reminder
```
POST /api/tasks/:id/snooze
```
**Body:** `{ "snoozedUntil": "2026-12-16T09:00:00.000Z" }`

### 4.5 Upcoming Tasks (Dashboard)
```
GET /api/tasks/upcoming
```
**Response:** Grouped by overdue, due today, due this week, upcoming

---

## 5. Quotations (`/api/quotations`)

### 5.1 Generate from Won Deal
```
POST /api/quotations/from-deal/:dealId
```
**Roles:** `SUPER_ADMIN`, `ADMIN`, `SALES_MANAGER`, `SALES_REP`

**Body:**
```json
{
  "quotationNumber": "QUO-2026-001",
  "validUntil": "2026-12-31T00:00:00.000Z",
  "items": [
    { "productId": "uuid", "description": "Enterprise License", "quantity": 100, "unitPrice": 50000, "taxRate": 16 }
  ]
}
```
**Constraints:** Deal must be `stage=CLOSED` and `closeOutcome=WON`. Idempotent via `dealId` unique constraint.

---

## 6. Sales Reps (`/api/sales-reps`)

### 6.1 List Eligible Reps
```
GET /api/sales-reps
```
**Response:** Users with `SALES_REP` or `SALES_MANAGER` role + active deal counts

### 6.2 Rep Performance
```
GET /api/sales-reps/performance
```
**Query:** `periodStart`, `periodEnd`, `userId`

### 6.3 Quotas
```
GET    /api/sales-reps/quotas
POST   /api/sales-reps/quotas
GET    /api/sales-reps/quotas/:id
PUT    /api/sales-reps/quotas/:id
DELETE /api/sales-reps/quotas/:id
```
**Quota Create Body:**
```json
{
  "userId": "uuid",
  "periodStart": "2026-11-01T00:00:00.000Z",
  "periodEnd": "2026-11-30T23:59:59.000Z",
  "periodType": "MONTHLY",
  "metric": "REVENUE",
  "targetValue": 10000000,
  "currency": "KES"
}
```
**Attainment:** Auto-calculated in GET responses.

### 6.4 Commission Rules
```
GET    /api/sales-reps/commission-rules
POST   /api/sales-reps/commission-rules
GET    /api/sales-reps/commission-rules/:id
PUT    /api/sales-reps/commission-rules/:id
DELETE /api/sales-reps/commission-rules/:id
```
**Rule Create Body:**
```json
{
  "name": "Standard 10%",
  "effectiveFrom": "2026-11-01T00:00:00.000Z",
  "effectiveTo": null,
  "isActive": true,
  "basis": "DEAL_VALUE",
  "rateType": "FLAT",
  "rateValue": 10.00,
  "eligibleDealStages": ["CLOSED"],
  "excludedDealSources": [],
  "requiresApproval": true
}
```

### 6.5 Commission Records
```
GET /api/sales-reps/commission-records
POST /api/sales-reps/commission-records/calculate
POST /api/sales-reps/commission-records/approve
```
**Calculate Body:** `{ "dealId": "uuid", "ruleId": "uuid?" }` — Idempotent via `calculationKey`

---

## 7. CRM Analytics (`/api/crm/analytics`)

### 7.1 Dashboard Metrics
```
GET /api/crm/analytics/dashboard
```
**Query:** `periodStart`, `periodEnd`, `dateRange` (TODAY/WEEK/MONTH/QUARTER/YTD), `branchId`, `ownerId`, `currency`

### 7.2 Pipeline Analysis
```
GET /api/crm/analytics/pipeline
```
**Query:** `periodStart`, `periodEnd`, `branchId`, `ownerId`, `stage`, `currency`

### 7.3 Rep Performance
```
GET /api/crm/analytics/rep-performance
```
**Query:** `periodStart`, `periodEnd`, `branchId`, `userId`

### 7.4 Customer Metrics
```
GET /api/crm/analytics/customers
```

### 7.5 Activity Metrics
```
GET /api/crm/analytics/activities
```

---

## 8. CRM Premium (`/api/crm/premium`)

### 8.1 Saved Views
```
GET    /api/crm/premium/saved-views
POST   /api/crm/premium/saved-views
GET    /api/crm/premium/saved-views/:id
PUT    /api/crm/premium/saved-views/:id
DELETE /api/crm/premium/saved-views/:id
```

### 8.2 Custom Fields
```
GET    /api/crm/premium/custom-fields/definitions
POST   /api/crm/premium/custom-fields/definitions
PUT    /api/crm/premium/custom-fields/definitions/:id
DELETE /api/crm/premium/custom-fields/definitions/:id

GET    /api/crm/premium/custom-fields/values
POST   /api/crm/premium/custom-fields/values
PUT    /api/crm/premium/custom-fields/values/:id
DELETE /api/crm/premium/custom-fields/values/:id
```

### 8.3 Import/Export
```
POST /api/crm/premium/import
GET  /api/crm/premium/import/:id
POST /api/crm/premium/export
```

### 8.4 Workflow Automation
```
GET    /api/crm/premium/workflows/rules
POST   /api/crm/premium/workflows/rules
GET    /api/crm/premium/workflows/rules/:id
PUT    /api/crm/premium/workflows/rules/:id
DELETE /api/crm/premium/workflows/rules/:id
POST   /api/crm/premium/workflows/rules/:id/execute

GET    /api/crm/premium/workflows/executions
```

---

## 9. Pagination & Sorting

### List Endpoints
All list endpoints support:
- `page` (default 1)
- `limit` (default 20, max 100)
- Sorting via `sortJson` in saved views or default `createdAt: desc`

### Response
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

---

## 10. Versioning & Compatibility

- **API Version:** Implicit via URL path `/api`
- **Breaking Changes:** New fields only additive; no field removals
- **Optimistic Locking:** `version` field on Deal entity
- **Idempotency:** `idempotencyKey` for imports, `calculationKey` for commissions