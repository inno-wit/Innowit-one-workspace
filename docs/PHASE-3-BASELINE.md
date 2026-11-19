# PHASE 3 BASELINE: INNOWIT ONE CRM & SALES PIPELINE

**Audit Date:** 2026-11-19  
**Auditor:** Principal Engineering Orchestrator  
**Scope:** Baseline assessment before Phase 3 CRM implementation  
**Branch:** `work/innowit-one-build`  
**HEAD Commit:** `b87ac4898aa1a48b8cebc996ccfda5509cf7b192`  
**Working Tree:** Dirty (modified: `docs/PHASE-2-REA-EVIDENCE.md`, `server/tests/integration-results.json`; deleted: `docs/PHASE-2-Evidence.zip`)

---

## 1. Repository Baseline Verification

### 1.1 Git State
- **Current Branch:** `work/innowit-one-build`
- **HEAD SHA:** `b87ac4898aa1a48b8cebc996ccfda5509cf7b192`
- **Reported Phase 2 Milestone:** `b87ac48` (matches)
- **Uncommitted Changes:** 
  - Modified: `docs/PHASE-2-REA-EVIDENCE.md`
  - Modified: `server/tests/integration-results.json`
  - Deleted: `docs/PHASE-2-Evidence.zip`
- **Protection Status:** Changes recorded and protected. No destructive operations planned.

### 1.2 Architecture Stack Verification
| Component | Version | Status |
|---|---|---|
| React | 19.0.1 | ✅ Confirmed |
| Vite | 8.3.0 | ✅ Confirmed |
| Express/Node | 4.21.2 / 22.x | ✅ Confirmed |
| Prisma | 5.22.0 | ✅ Confirmed |
| PostgreSQL | 17 (local) | ✅ Connected |
| Tauri | 2.12.6 | ✅ Confirmed |
| TypeScript | 7.0.2 | ✅ 0 errors |
| Vitest | 5.1.1 | ✅ 91 tests pass |

### 1.3 Regression Baseline (Verified)
| Test Suite | Expected | Actual | Status |
|---|---|---|---|
| Phase 1 Acceptance Gates | 19/19 | 19/19 | ✅ PASS |
| Phase 1 Integration Tests | 33/33 | 33/33 | ✅ PASS |
| Phase 2 Vitest Tests | 91/91 | 91/91 | ✅ PASS |
| Combined Checks | 143/143 | 143/143 | ✅ PASS |
| TypeScript Check | 0 errors | 0 errors | ✅ PASS |
| Vite Production Build | PASS | PASS | ✅ PASS |
| Cargo Check (Tauri) | PASS | PASS | ✅ PASS |

---

## 2. Current CRM Implementation Inventory

### 2.1 Database Models (Prisma Schema) — Production-Backed

| Model | Status | Notes |
|---|---|---|
| `Customer` | ✅ Production-backed | Full fields: customerCode, name, companyName, kraPin, email, phone, billingAddress, creditLimit, paymentTermsDays. Tenant-scoped unique on (organizationId, customerCode). |
| `CustomerContact` | ✅ Production-backed | Fields: firstName, lastName, email, phone, jobTitle. Cascade delete on customer. **Missing:** isPrimary flag, primary contact uniqueness constraint. |
| `Deal` | ✅ Production-backed | Fields: customerId, assignedToId, title, value (Decimal), currency, stage (DealStage enum), winProbability, expectedCloseDate, lostReason. **Missing:** stage history, close outcome (WON/LOST separate from stage), probability defaults table, idempotency/version field. |
| `Task` | ✅ Production-backed | Fields: title, description, priority, status, dueDate, assignedToId, customerId, dealId. **Missing:** projectId, salesOrderId, reminder/snooze fields, completedAt. |
| `Quotation` | ✅ Production-backed | Full sales quotation with items, deal link (unique), organization-scoped. Conversion to SalesOrder implemented. |
| `SalesOrder` | ✅ Production-backed | Full order lifecycle with items, status enum, customer link. |
| `SalesInvoice` | ✅ Production-backed | Full invoice with eTIMS integration, payments, credit notes. |

### 2.2 API Routes — Production-Backed

| Route | Status | Coverage |
|---|---|---|
| `GET/POST /api/customers` | ✅ | List with pagination/search, create with tenant scoping, duplicate code check |
| `GET/PUT/DELETE /api/customers/:id` | ✅ | Full CRUD with ownership verification |
| `GET/POST/PUT/DELETE /api/customers/:customerId/contacts` | ✅ | Contact management **Missing:** primary contact logic |
| `GET/POST/PUT/DELETE /api/deals` | ✅ | List with filters (stage, assignee, customer), create, update with RBAC |
| `GET/POST/PUT/DELETE /api/tasks` | ✅ | Full CRUD with cross-entity links (customer, deal) |
| `GET/POST/PUT/DELETE /api/quotations` | ✅ | Full CRUD with items, deal link, conversion to sales order |

### 2.3 Frontend Components — LocalStorage-Backed (UI-Only)

| Component | Status | Backend Connected |
|---|---|---|
| `CrmView` | ⚠️ UI-Only | ❌ Uses `loadCrmState`/`saveCrmState` from localStorage |
| `CrmDashboardView` | ⚠️ UI-Only | ❌ Calculates from local state |
| `CustomersDirectoryView` | ⚠️ UI-Only | ❌ Local filtering/sorting/pagination |
| `CustomerDetailDrawer` | ⚠️ UI-Only | ❌ Local contact creation, no server sync |
| `DealsKanbanView` | ⚠️ UI-Only | ❌ Local stage transitions, no persistence |
| `DealOutcomeModal` | ⚠️ UI-Only | ❌ Won/Lost outcomes not sent to API |
| `CreateDealModal` | ⚠️ UI-Only | ❌ Creates local ID, no server create |
| `CreateCustomerModal` | ⚠️ UI-Only | ❌ Creates local ID, no server create |
| `CreateTaskModal` | ⚠️ UI-Only | ❌ Creates local ID, no server create |
| `TasksManagerView` | ⚠️ UI-Only | ❌ Local filtering, toggle status not persisted |

### 2.4 State Management — LocalStorage (v3)

- **Store:** `src/modules/crm/store.ts` — loads/saves to `localStorage` key `innowit_crm_v3`
- **Seed Data:** `src/data/crmSeed.ts` — 8 customers, 8 contacts, 3 sales reps, 7 deals, 6 tasks, 5 activities
- **Reality:** All CRM data is client-side only. Zero database persistence for CRM operations.

### 2.5 Missing CRM Capabilities (Per Phase 3 Requirements)

| Requirement | Current Status | Gap |
|---|---|---|
| Customer lifecycle (LEAD/ACTIVE/INACTIVE) | ❌ | Customer model has no lifecycle enum; only `status` ACTIVE/INACTIVE |
| Multiple contacts per customer | ⚠️ Partial | Model exists but no primary contact enforcement |
| KRA PIN format validation | ⚠️ Partial | Frontend validates; backend does not |
| 6-stage Kanban (exact labels) | ⚠️ Partial | Frontend has 6 stages; backend DealStage enum has CLOSED_WON/CLOSED_LOST not "Closed" |
| Mandatory Won/Lost outcome on Close | ❌ | Backend accepts stage=CLOSED_WON/CLOSED_LOST directly; no outcome dialog enforcement |
| Stage history/audit trail | ❌ | No DealStageHistory model |
| Deal probability defaults by stage | ⚠️ Partial | Frontend has defaults; backend doesn't enforce |
| Cross-entity tasks (project, salesOrder) | ❌ | Task model only has customerId, dealId |
| CRM Analytics (conversion velocity, CAC, weighted pipeline) | ❌ | Dashboard calculates from local state only |
| Sales rep quota/commission tracking | ❌ | SalesRepRecord is frontend-only type; no backend models |
| Customer 360 tabs (Overview, Deals, Invoices, Tasks, Activity) | ⚠️ Partial | Frontend drawer has tabs; no server-backed data fetching |
| Real-time CRM events | ❌ | Phase 2 RealtimeGateway exists but no CRM event types |
| CSV Import/Export | ❌ | ImportWizard exists but not wired for CRM |

---

## 3. Classification of CRM Capabilities

| Capability | Classification | Evidence |
|---|---|---|
| Customer CRUD (API) | **Production-backed and verified** | Routes exist, tested in integration suite |
| Contact CRUD (API) | **Production-backed and verified** | Routes exist, basic CRUD |
| Deal CRUD (API) | **Production-backed and verified** | Routes exist, RBAC tested |
| Task CRUD (API) | **Production-backed and verified** | Routes exist, cross-entity links work |
| Quotation CRUD (API) | **Production-backed and verified** | Routes exist, conversion to SalesOrder works |
| Customer Directory UI | **UI-only / local-only** | Uses localStorage, no server calls |
| Customer Detail Drawer | **UI-only / local-only** | Local contact creation, no persistence |
| Deals Kanban UI | **UI-only / local-only** | Local stage transitions, no API calls |
| Deal Outcome Modal | **UI-only / local-only** | Won/Lost not sent to server |
| Create Deal/Customer/Task Modals | **UI-only / local-only** | Generate local IDs, no server create |
| Tasks Manager UI | **UI-only / local-only** | Local filtering, no server sync |
| CRM Dashboard | **UI-only / local-only** | Calculates from local state |
| Sales Rep Management | **Missing** | No backend models, no UI |
| Quota/Commission | **Missing** | No models, no calculations |
| CRM Analytics | **UI-only / demo-only** | Calculated from seed data only |
| Activity Timeline | **UI-only / demo-only** | Local array, no AuditLog integration |
| Import/Export | **Missing** | ImportWizard exists but not for CRM |
| Real-time Updates | **Missing** | No CRM event types in RealtimeGateway |

---

## 4. Architecture Decision Notes (Pre-Implementation)

### 4.1 Schema Changes Required
1. **Customer** — Add `lifecycle` enum (LEAD, ACTIVE, INACTIVE), `branchId`, `leadSource`, `businessType` (CORPORATE/INDIVIDUAL)
2. **CustomerContact** — Add `isPrimary` boolean, unique partial index for primary contact per customer
3. **Deal** — Add `stageHistory` relation, `closeOutcome` (WON/LOST separate from stage), `reopenedAt`, `reopenedById`, `reopenReason`, `version` for optimistic locking, `source` field
4. **DealStageHistory** — New model for auditable stage transitions
5. **Task** — Add `projectId`, `salesOrderId`, `completedAt`, `reminderAt`, `snoozedUntil`, `reminderSent`
6. **CRMActivity** — New model for timeline (call, meeting, note, email_logged, stage_change, task_created, etc.)
7. **SalesRepQuota** — New model for quota periods (rep, period, metric, target, currency)
8. **CommissionRule** — New model for commission configuration
9. **CommissionRecord** — New model for calculated commissions
10. **CustomFieldDefinition/Value** — For P1 custom fields capability

### 4.2 Event Contracts (RealtimeGateway)
- `crm.customer.created`, `crm.customer.updated`, `crm.customer.lifecycle.changed`
- `crm.contact.created`, `crm.contact.updated`, `crm.contact.primary.changed`
- `crm.deal.created`, `crm.deal.updated`, `crm.deal.stage.changed`, `crm.deal.closed`, `crm.deal.reopened`
- `crm.task.created`, `crm.task.updated`, `crm.task.completed`
- `crm.activity.created`
- `crm.quota.updated`, `crm.commission.calculated`

### 4.3 Permission Matrix Extensions
- `crm.customers.view.own/branch/organization`
- `crm.customers.create/update/archive`
- `crm.contacts.manage`
- `crm.deals.view.own/team/branch/organization`
- `crm.deals.create/update.own/update.assigned/assign/close/reopen/createQuotation`
- `crm.tasks.manage.own/assign`
- `crm.activities.create`
- `crm.reports.view/export`
- `crm.quotas.manage`
- `crm.commissions.manage`
- `crm.import.execute`
- `crm.customFields.manage`
- `crm.workflows.manage`

### 4.4 Integration Points
- **Won Deal → Quotation:** Use existing `POST /api/quotations` with `dealId` link
- **Customer 360 Invoices:** Read from existing `SalesInvoice` via customerId
- **Customer 360 Sales Orders:** Read from existing `SalesOrder` via customerId
- **Activity Timeline:** Project from AuditLog + CRMActivity, not duplicate records
- **Collaboration Links:** Use existing `SharedNote.linkedEntityType` (CUSTOMER, DEAL)

---

## 5. Implementation Waves Plan

| Wave | Focus | Dependencies |
|---|---|---|
| **3.0** | Baseline & REA Evidence | ✅ Complete (this document) |
| **3.1** | Domain Model & Database Migration | Schema decisions from 4.1 |
| **3.2** | Customer & Contact Management | 3.1 complete |
| **3.3** | Deals Pipeline & Outcomes | 3.1 complete |
| **3.4** | Tasks, Activities & Timeline | 3.1, 3.2, 3.3 complete |
| **3.5** | Sales Reps, Quotas & Commissions | 3.1 complete |
| **3.6** | CRM Dashboard & Analytics | 3.2, 3.3, 3.4, 3.5 complete |
| **3.7** | Premium Capabilities (Saved Views, Custom Fields, Import, Workflows) | Core stable |
| **3.8** | Integration, Quality & Acceptance | All waves complete |

---

## 6. Known Phase 2 Limitations (Carried Forward)

| Limitation | Status | Tracking |
|---|---|---|
| Desktop Multi-Client QA | 🚫 BLOCKED | Tauri 2 architecture verified; multi-process GUI validation pending release QA |
| Huddles/SFU Media | 🚫 BLOCKED | BACK-26: Requires SFU provisioning, TURN, TLS certs, native permissions |
| eTIMS Production Certification | 🚫 BLOCKED | No paid QuickBooks/KRA production access; sandbox only |

---

## 7. Next Steps

1. **Wave 3.1:** Create additive Prisma migration for CRM domain model extensions ✅ **COMPLETED**
   - Migration `20261119_phase3_crm_domain` applied successfully
   - New models: `DealStageHistory`, `CRMActivity`, `SalesRepQuota`, `CommissionRule`, `CommissionRecord`, `CustomFieldDefinition`, `CustomFieldValue`, `SavedView`
   - Extended models: `Customer` (lifecycle, type, branchId, leadSource), `CustomerContact` (isPrimary, createdAt, updatedAt), `Deal` (organizationId, closeOutcome, lostNotes, source, version, reopenedAt, reopenedById, reopenReason), `Task` (organizationId, completedAt, projectId, salesOrderId, reminderAt, snoozedUntil, reminderSent)
   - New enums: `DealCloseOutcome`, `CustomerLifecycle`, `CustomerType`, `CRMActivityType`
   - Added `CLOSED` value to `DealStage` enum
   - All regression tests pass (19 acceptance gates + 33 integration + 91 vitest = 143 checks)

2. **Wave 3.2:** Implement server-backed Customer/Contact API and wire frontend
3. **Wave 3.3:** Implement server-backed Deal pipeline with stage history and outcomes
4. **Wave 3.4:** Extend Tasks with cross-entity links, reminders, and Activity timeline
5. **Wave 3.5:** Add SalesRep, Quota, Commission models and APIs
6. **Wave 3.6:** Build server-calculated Analytics with drill-down
7. **Wave 3.7:** Deliver P1 premium capabilities (saved views, custom fields, import)
8. **Wave 3.8:** Full integration testing, regression verification, documentation

**Do not start Phase 4.** Phase 3 acceptance report must be presented first.