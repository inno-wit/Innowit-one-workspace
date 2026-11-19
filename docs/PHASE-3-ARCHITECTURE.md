# PHASE 3 ARCHITECTURE: INNOWIT ONE CRM & SALES PIPELINE

**Document Version:** 1.0.0  
**Date:** 2026-11-19  
**Status:** As-Built  

---

## 1. System Overview

Phase 3 extends Innowit One with a comprehensive CRM & Sales Pipeline module that integrates seamlessly with the existing Phase 1 (Foundation) and Phase 2 (Collaboration) architectures.

```
┌─────────────────────────────────────────────────────────────────┐
│                    INNOWIT ONE ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────────┤
│  PRESENTATION LAYER (React 19 + Vite + Tauri 2)                │
│  ├── CRM Dashboard & Analytics                                  │
│  ├── Customer Directory & 360° View                             │
│  ├── Deals Kanban (6-Stage)                                     │
│  ├── Tasks Manager                                              │
│  ├── Sales Rep Performance                                      │
│  └── Premium: Saved Views, Custom Fields, Workflows            │
├─────────────────────────────────────────────────────────────────┤
│  API LAYER (Express.js + TypeScript)                           │
│  ├── /api/customers          Customer & Contact Management     │
│  ├── /api/deals              Deals Pipeline & Stage History    │
│  ├── /api/tasks              Tasks & Cross-Entity Links        │
│  ├── /api/quotations         Quotations + Won Deal Integration │
│  ├── /api/sales-reps         Reps, Quotas, Commissions         │
│  ├── /api/crm/analytics      Dashboard, Pipeline, Performance  │
│  └── /api/crm/premium        Saved Views, Custom Fields, WF    │
├─────────────────────────────────────────────────────────────────┤
│  SERVICE LAYER                                                │
│  ├── Tenant Isolation Middleware (org/branch scoping)         │
│  ├── RBAC Authorization (12 roles, resource-level)            │
│  ├── RealtimeGateway (Socket.IO) - Phase 2                    │
│  ├── NotificationService - Phase 2                            │
│  ├── AuditLogger (immutable)                                  │
│  ├── ImportWizard (CSV dry-run/idempotent)                    │
│  └── Workflow Engine (trigger-condition-action)               │
├─────────────────────────────────────────────────────────────────┤
│  DATA LAYER (PostgreSQL 17 + Prisma 5.22)                    │
│  ├── Phase 1 Models: Org, User, Branch, Accounting, Inventory│
│  ├── Phase 2 Models: Channel, Message, Note, Notification     │
│  └── Phase 3 Models: Customer, Deal, Task, Activity, CRM Ext  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Module Boundaries

### 2.1 CRM Module (New)
**Ownership:** CRM Team  
**Database:** `crm` schema (logical, same PostgreSQL instance)  
**Core Entities:** Customer, CustomerContact, Deal, DealStageHistory, CRMActivity, Task  
**Integration Points:** 
- Reads Users, Branches, Organizations (Phase 1)
- Reads Quotations, SalesOrders, Invoices (Phase 1 Sales/Accounting)
- Writes CRMActivity, AuditLog
- Publishes Realtime Events (Phase 2)

### 2.2 Sales Rep & Commission Module (New)
**Ownership:** Sales Team  
**Core Entities:** SalesRepQuota, CommissionRule, CommissionRecord  
**Integration Points:**
- Reads Deals (for quota attainment)
- Reads Users (for rep assignment)
- Writes CommissionRecord (no GL posting in Phase 3)

### 2.3 Analytics Module (New)
**Ownership:** BI Team  
**Type:** Read-only aggregated views  
**Integration Points:**
- Reads all CRM + Sales + Accounting data
- No direct writes
- Cached with explicit invalidation

### 2.4 Premium Capabilities Module (New)
**Ownership:** Platform Team  
**Core Entities:** SavedView, CustomFieldDefinition, CustomFieldValue, AutomationRule, AutomationExecutionLog, ImportJob  
**Integration Points:**
- SavedView: Reads all list endpoints
- CustomFields: Extends Customer, Contact, Deal
- ImportJob: Uses ImportWizard infrastructure
- AutomationRule: Triggered by CRM events

---

## 3. Data Flow

### 3.1 Deal Lifecycle
```
NEW_LEAD → CONTACTED → QUALIFIED → PROPOSAL → NEGOTIATION → CLOSED
                                                      │
                                                      ├── WON → closeOutcome=WON → commission calc → quotation option
                                                      └── LOST → closeOutcome=LOST → lostReason required
```

**Stage Transition Rules:**
- Forward only (except CLOSED reopen with SALES_MANAGER+ permission)
- Optimistic locking via `version` field
- Each transition creates `DealStageHistory` + `CRMActivity`
- Probability auto-updated unless explicitly set

### 3.2 Commission Calculation
```
Deal CLOSED/WON 
    → Find applicable CommissionRule (active, effective dates, eligible stages)
    → Calculate basis (DEAL_VALUE or COLLECTED_AMOUNT)
    → Apply rate (FLAT or TIERED)
    → Create CommissionRecord with calculationKey (idempotent)
    → Status: PENDING (if requiresApproval) or APPROVED
    → NO GL POSTING in Phase 3
```

### 3.3 Activity Timeline
```
CRMActivity created for:
  - Customer create/update/lifecycle change
  - Contact add/primary change/delete
  - Deal create/stage change/close/reopen
  - Task create/complete/reassign
  - Quotation generated from won deal
  - Custom field changes
  - Workflow actions
```

**Projection Strategy:** Timeline = `CRMActivity` + `AuditLog` (filtered) + `SharedNote` (linked) — no duplicate events.

---

## 4. Security Model

### 4.1 Tenant Isolation
- All queries scoped by `organizationId` via `orgWhereClause()`
- `branchId` scoping for non-manager roles
- Client-supplied `organizationId` stripped via `sanitizeCreateInput()`/`sanitizeUpdateInput()`

### 4.2 RBAC Permissions (CRM Extensions)
| Permission | Roles | Scope |
|---|---|---|
| `crm.customers.view.own` | SALES_REP+ | Own branch customers |
| `crm.customers.view.organization` | SALES_MANAGER+ | All org customers |
| `crm.customers.create` | SALES_REP+ | Create |
| `crm.customers.update` | SALES_REP+ | Own/assigned |
| `crm.customers.archive` | SALES_MANAGER+ | Archive (soft delete) |
| `crm.deals.view.own` | SALES_REP+ | Own deals |
| `crm.deals.view.organization` | SALES_MANAGER+ | All org deals |
| `crm.deals.close` | SALES_REP+ | Own deals |
| `crm.deals.reopen` | SALES_MANAGER+ | Reopen closed |
| `crm.deals.createQuotation` | SALES_REP+ | Won deals |
| `crm.quotas.manage` | SALES_MANAGER+ | CRUD quotas |
| `crm.commissions.manage` | SALES_MANAGER+ | Rules, approve records |
| `crm.analytics.view` | SALES_REP+ | Own + team (if manager) |
| `crm.premium.savedViews.manage` | SALES_REP+ | Own + shared |
| `crm.premium.customFields.manage` | ADMIN+ | Definitions only |
| `crm.premium.workflows.manage` | ADMIN+ | Rules & execution |

### 4.3 Cross-Entity Access Control
- Task links validated: customer/deal/project/salesOrder must belong to user's organization
- Contact primary enforcement: DB-level partial unique index per customer
- Quotation generation: Only for CLOSED/WON deals, idempotent via `dealId` unique constraint

---

## 5. Realtime Events

### 5.1 Event Catalog (Phase 3 Additions)
| Event | Payload | Room Scope |
|---|---|---|
| `crm.customer.created` | `{customerId, organizationId}` | `org:{orgId}:crm` |
| `crm.customer.updated` | `{customerId, changes}` | `org:{orgId}:crm` |
| `crm.customer.lifecycle.changed` | `{customerId, from, to}` | `org:{orgId}:crm` |
| `crm.contact.created` | `{contactId, customerId}` | `org:{orgId}:crm` |
| `crm.contact.primary.changed` | `{customerId, oldContactId, newContactId}` | `org:{orgId}:crm` |
| `crm.deal.created` | `{dealId, customerId, assignedToId}` | `org:{orgId}:crm` |
| `crm.deal.updated` | `{dealId, changes}` | `org:{orgId}:crm` |
| `crm.deal.stage.changed` | `{dealId, fromStage, toStage, closeOutcome}` | `org:{orgId}:crm` |
| `crm.deal.closed` | `{dealId, outcome, value}` | `org:{orgId}:crm` |
| `crm.deal.reopened` | `{dealId, reason}` | `org:{orgId}:crm` |
| `crm.task.created` | `{taskId, customerId, dealId, assignedToId}` | `org:{orgId}:crm` |
| `crm.task.completed` | `{taskId, userId}` | `org:{orgId}:crm` |
| `crm.quota.updated` | `{quotaId, userId}` | `org:{orgId}:crm` |
| `crm.commission.calculated` | `{recordId, dealId, userId, amount}` | `org:{orgId}:crm` |

**Publishing:** After transaction commit via `RealtimeGateway.emitToOrgRoom()`
**Subscription:** Client subscribes to `org:{orgId}:crm` on CRM page load

---

## 6. Performance Considerations

### 6.1 Query Optimization
- All list endpoints: server-side pagination, filtering, sorting
- Compound indexes on `(organizationId, ...)` for tenant queries
- `DealStageHistory` indexed by `(dealId, createdAt)`
- `CRMActivity` indexed by `(customerId, occurredAt)`, `(dealId, occurredAt)`
- `SavedView` filters/sorts applied at database level

### 6.2 Caching Strategy
- Analytics: In-memory cache with 30s TTL, invalidated on write
- Custom field definitions: Cached per organization (5min TTL)
- Saved views: Cached per user (1min TTL)
- Invalidation: On any CRM write, clear relevant cache keys

### 6.3 Data Volume Targets
| Entity | Target Volume | Pagination |
|---|---|---|
| Customers | 100,000+ | 20/page |
| Deals | 500,000+ | 20/page |
| Tasks | 1,000,000+ | 20/page |
| Activities | 5,000,000+ | 50/page |

---

## 7. Deployment

### 7.1 Database Migration
```bash
npx prisma migrate deploy
# Applies: 20261119_phase3_crm_domain
```

### 7.2 Environment Variables
```env
# No new required variables for Phase 3
# Uses existing: DATABASE_URL, JWT_SECRET, etc.
```

### 7.3 Rollback Plan
- Migration is additive (no column drops, no data loss)
- Rollback: `npx prisma migrate reset --force` + restore Phase 2 backup
- Forward-fix: Add missing columns/indexes via new migration

---

## 8. Monitoring & Observability

### 8.1 Key Metrics to Alert
- CRM API latency > 500ms (p95)
- Deal stage transition failures > 1%
- Commission calculation errors > 0
- Import job failures > 5%
- Realtime event delivery latency > 1s

### 8.2 Audit Trail
- All CRM writes: `AuditLog` entry (immutable)
- Stage changes: `DealStageHistory` (append-only)
- Commission records: `CommissionRecord` (calculationKey prevents duplicates)
- Import jobs: `ImportJob` (idempotencyKey prevents re-execution)