# PHASE 3 IMPORT/EXPORT SPECIFICATION: INNOWIT ONE CRM & SALES PIPELINE

**Document Version:** 1.1.0
**Date:** 2026-11-19 (original) · **Reconciled:** 2026-11-23
**Status:** As-Built (backend API) / UI `DEFERRED`

> **Reconciliation notice (2026-11-23).** The import/export **API** exists in `server/routes/crmPremium.ts` (`/api/crm/premium/import`, `/import/:id`, `/export`) with permission guards, but it is **not fully functional**:
>
> - `POST /api/crm/premium/import` calls `prisma.importJob.findUnique(...)` and `prisma.importJob.create(...)` at `crmPremium.ts:711,720`. **No `ImportJob` model exists** in `prisma/schema.prisma` or in any migration, and a direct probe of the generated Prisma client returns `typeof prisma.importJob === 'undefined'`. The import route therefore throws `TypeError` at runtime and cannot persist a job.
> - The dry-run branch is explicitly a placeholder: `// In a real implementation, this would parse the file and validate rows` / `// For now, return mock results` (`crmPremium.ts:735–736`).
> - **No test covers import or export.** The 4 tests in `crm-premium.integration.test.ts` cover Saved Views (2), Custom Fields (1) and Automation Rule creation (1).
> - There is **no import or export user interface**: a search of `src/components` finds no `ImportWizard`, `ExportDialog` or equivalent CRM component.
>
> This document is therefore an **API contract specification**, not a description of shipped behaviour. Tracked as FE-010 in `docs/PHASE-3-BACKLOG.md` and RC-09 in `docs/PHASE-3-RELEASE-RECONCILIATION.md`. **[CORRECTED]**

---

## 1. Overview

Phase 3 implements a comprehensive import/export framework for CRM entities using the existing `ImportWizard` infrastructure, with idempotency, dry-run validation, and tenant isolation.

---

## 2. Supported Entities

| Entity | Import | Export | Notes |
|---|---|---|---|
| Customer | ✅ | ✅ | Includes contacts |
| Contact | ✅ | ✅ | Requires customerId mapping |
| Deal | ✅ | ✅ | Requires customerId, assignedToId |
| Task | ✅ | ✅ | Supports cross-entity links |
| Activity | ❌ | ✅ | Read-only (audit trail) |

---

## 3. Import Process

### 3.1 Flow

```
Upload File → Dry Run → Review Results → Execute Import → Results
```

### 3.2 Dry Run Mode

**Purpose:** Validate without persisting

**Endpoint:** `POST /api/crm/premium/import` with `"dryRun": true`

**Response:**
```json
{
  "data": { "importJobId": "uuid", "status": "PENDING" },
  "results": {
    "totalRows": 100,
    "validRows": 95,
    "invalidRows": 5,
    "errors": [
      { "row": 3, "field": "kraPin", "message": "Invalid KRA PIN format" }
    ],
    "duplicates": [
      { "row": 10, "customerCode": "CUST-001", "action": "skip" }
    ]
  }
}
```

### 3.3 Execution Mode

**Endpoint:** `POST /api/crm/premium/import` with `"dryRun": false`

**Options:**
| Option | Default | Description |
|---|---|---|
| `skipDuplicates` | false | Skip rows matching existing records |
| `updateExisting` | false | Update existing records on match |
| `idempotencyKey` | auto | Prevents re-execution |

**Response:**
```json
{
  "data": { "importJobId": "uuid", "status": "PROCESSING" },
  "message": "Import job queued for processing"
}
```

### 3.4 Job Status

```
GET /api/crm/premium/import/:id
```
**Response:**
```json
{
  "data": {
    "id": "uuid",
    "entityType": "CUSTOMER",
    "status": "COMPLETED",
    "totalRows": 100,
    "processedRows": 100,
    "validRows": 95,
    "invalidRows": 5,
    "duplicateRows": 0,
    "errorDetailsJson": "[...]",
    "completedAt": "2026-11-19T10:30:00.000Z"
  }
}
```

---

## 4. CSV Format Specifications

### 4.1 Customer Import

**Required Columns:** `customerCode`, `name`  
**Optional Columns:** `companyName`, `kraPin`, `email`, `phone`, `city`, `billingAddress`, `creditLimit`, `paymentTermsDays`, `lifecycle`, `type`, `branchCode`, `leadSource`

**Example:**
```csv
customerCode,name,companyName,kraPin,email,phone,city,lifecycle,type,creditLimit,paymentTermsDays,leadSource
CUST-001,Safaricom PLC,Safaricom Telecommunications PLC,P051123456Z,billing@safaricom.co.ke,+254722000000,Nairobi,ACTIVE,CORPORATE,25000000,30,Executive Inbound
CUST-002,Equity Group,Equity Bank Kenya Limited,P051987654A,procurement@equitybank.co.ke,+254763000000,Nairobi,LEAD,CORPORATE,10000000,45,Partner Referral
```

**Validation Rules:**
- `customerCode`: Unique per organization
- `kraPin`: Must match `/^[A-Z]\d{9}[A-Z]$/` or empty
- `email`: Valid email format or empty
- `lifecycle`: Must be `LEAD`, `ACTIVE`, or `INACTIVE`
- `type`: Must be `CORPORATE` or `INDIVIDUAL`
- `branchCode`: Must exist in organization

### 4.2 Contact Import

**Required Columns:** `customerCode`, `firstName`, `lastName`  
**Optional Columns:** `email`, `phone`, `jobTitle`, `isPrimary`

**Example:**
```csv
customerCode,firstName,lastName,email,phone,jobTitle,isPrimary
CUST-001,John,Doe,john@safaricom.co.ke,+254722111222,CTO,true
CUST-001,Jane,Smith,jane@safaricom.co.ke,+254722333444,Procurement,false
```

**Validation Rules:**
- `customerCode` must exist in organization
- `isPrimary`: If true, unsets other primary contacts for that customer

### 4.3 Deal Import

**Required Columns:** `customerCode`, `assignedToEmail`, `title`, `value`  
**Optional Columns:** `currency`, `stage`, `closeOutcome`, `winProbability`, `expectedCloseDate`, `lostReason`, `lostNotes`, `source`

**Example:**
```csv
customerCode,assignedToEmail,title,value,currency,stage,winProbability,expectedCloseDate,source
CUST-001,kevin@innowit.ke,Enterprise Renewal,5000000,KES,QUALIFIED,60,2026-12-31,Direct Sales
CUST-002,grace@innowit.ke,New Opportunity,3000000,USD,NEW_LEAD,20,2027-01-15,Web Lead
```

**Validation Rules:**
- `customerCode` must exist
- `assignedToEmail` must map to user in organization with sales role
- `stage`: Must be valid DealStage enum
- `closeOutcome`: Required if stage=CLOSED; must be WON/LOST
- `lostReason`: Required if closeOutcome=LOST

### 4.4 Task Import

**Required Columns:** `title`, `assignedToEmail`  
**Optional Columns:** `description`, `priority`, `status`, `dueDate`, `customerCode`, `dealTitle`, `projectCode`, `salesOrderNumber`, `reminderAt`

**Example:**
```csv
title,assignedToEmail,priority,status,dueDate,customerCode,dealTitle,reminderAt
Follow up proposal,kevin@innowit.ke,HIGH,PENDING,2026-12-15,CUST-001,Enterprise Renewal,2026-12-14T09:00:00Z
```

**Validation Rules:**
- `assignedToEmail` must map to user in organization
- `customerCode` must exist if provided
- `dealTitle` must match existing deal for that customer
- `projectCode` must exist in organization
- `salesOrderNumber` must exist in organization

---

## 5. Export Format

### 5.1 CSV Export

**Endpoint:** `POST /api/crm/premium/export`

**Request:**
```json
{
  "entityType": "CUSTOMER",
  "filtersJson": "{\"lifecycle\": \"ACTIVE\"}",
  "sortJson": "{\"createdAt\": \"desc\"}",
  "columnsJson": "[\"customerCode\", \"name\", \"kraPin\", \"email\", \"phone\", \"city\", \"lifecycle\", \"type\", \"creditLimit\", \"paymentTermsDays\", \"createdAt\"]",
  "format": "CSV"
}
```

**Response:** File download with `Content-Disposition: attachment; filename="customer_export_2026-11-19.csv"`

### 5.2 JSON Export

Same endpoint with `"format": "JSON"`

**Response:** `application/json` with full object structure

### 5.3 Default Columns by Entity

| Entity | Default Columns |
|---|---|
| CUSTOMER | id, customerCode, name, companyName, kraPin, email, phone, city, lifecycle, type, creditLimit, paymentTermsDays, leadSource, createdAt |
| CONTACT | id, customerCode, firstName, lastName, email, phone, jobTitle, isPrimary, createdAt |
| DEAL | id, customerCode, title, value, currency, stage, closeOutcome, winProbability, expectedCloseDate, lostReason, assignedToEmail, createdAt |
| TASK | id, title, description, priority, status, dueDate, assignedToEmail, customerCode, dealTitle, projectCode, salesOrderNumber, reminderAt, createdAt |
| ACTIVITY | id, customerName, dealTitle, type, title, description, actorName, occurredAt |

---

## 6. Idempotency & Conflict Resolution

### 6.1 Import Idempotency

**Mechanism:** `idempotencyKey` in import options

**Behavior:**
- Client generates UUID for each import batch
- Server stores key with job record
- Duplicate submission with same key returns existing job

### 6.2 Duplicate Detection

| Entity | Match Key | Action (updateExisting=false) | Action (updateExisting=true) |
|---|---|---|---|
| Customer | customerCode | Skip row | Update all fields |
| Contact | customerCode + firstName + lastName | Skip row | Update fields |
| Deal | customerCode + title | Skip row | Update fields |
| Task | title + assignedToEmail + customerCode | Skip row | Update fields |

### 6.3 Foreign Key Resolution

**Strategy:** Map external identifiers to internal UUIDs

| Import Field | Resolved To |
|---|---|
| `customerCode` | Customer.id |
| `assignedToEmail` | User.id |
| `branchCode` | Branch.id |
| `dealTitle` | Deal.id (scoped to customer) |
| `projectCode` | Project.id |
| `salesOrderNumber` | SalesOrder.id |

---

## 7. Error Handling

### 7.1 Row-Level Errors

Each error includes:
```json
{
  "row": 15,
  "field": "kraPin",
  "value": "INVALID",
  "message": "KRA PIN must match format ^[A-Z]\\d{9}[A-Z]$"
}
```

### 7.2 Common Errors

| Error | Cause | Resolution |
|---|---|---|
| `DUPLICATE_CUSTOMER_CODE` | customerCode exists | Use updateExisting or different code |
| `INVALID_KRA_PIN` | PIN format wrong | Fix format: P051234567Z |
| `USER_NOT_FOUND` | Email not in org | Add user first or fix email |
| `CUSTOMER_NOT_FOUND` | customerCode missing | Create customer first |
| `INVALID_STAGE` | Stage not in enum | Use valid stage |

---

## 8. Performance

| Metric | Target |
|---|---|
| Dry-run 1000 rows | < 5s |
| Import 1000 rows | < 30s |
| Export 10000 rows | < 10s |
| Memory usage | < 500MB |

---

## 9. Security

- All imports/exports scoped to `organizationId`
- File URLs must be pre-signed (S3) or local
- Admin-only for import execution
- Export respects user's view permissions
- No sensitive fields (passwords, tokens) in exports