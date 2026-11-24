# PHASE 3 CRM UI MAP: INNOWIT ONE CRM & SALES PIPELINE

**Document Version:** 1.0.0  
**Date:** 2026-11-19  
**Status:** As-Built  
**Framework:** React 19 + Vite + TypeScript  

---

## 1. Route Map

| Route | Component | Description |
|---|---|---|
| `/crm/dashboard` | `CrmDashboardView` | Executive metrics, pipeline funnel, rep leaderboard |
| `/crm/customers` | `CustomersDirectoryView` | Customer list with search, filters, pagination |
| `/crm/deals` | `DealsKanbanView` | 6-stage Kanban board with drag-drop |
| `/crm/tasks` | `TasksManagerView` | Task list with filters, priority, due dates |

---

## 2. Component Hierarchy

```
CrmView (src/components/views/CrmView.tsx)
├── CrmDashboardView (src/components/crm/CrmDashboardView.tsx)
├── CustomersDirectoryView (src/components/crm/CustomersDirectoryView.tsx)
│   ├── CreateCustomerModal
│   ├── CustomerDetailDrawer
│   │   ├── Overview & Contacts tab
│   │   ├── Deals tab
│   │   ├── Receivables & Ledger tab
│   │   ├── Tasks tab
│   │   └── Timeline Log tab
│   ├── CreateDealModal
│   └── CreateTaskModal
├── DealsKanbanView (src/components/crm/DealsKanbanView.tsx)
│   ├── CreateDealModal
│   └── DealOutcomeModal (Won/Lost dialog)
└── TasksManagerView (src/components/crm/TasksManagerView.tsx)
    └── CreateTaskModal
```

---

## 3. Screen-to-API Mapping

### 3.1 CRM Dashboard (`/crm/dashboard`)

| UI Element | API Endpoint | Data |
|---|---|---|
| KPI Cards (Pipeline, Weighted, Won, Win Rate, Active Accounts, Overdue) | `GET /api/crm/analytics/dashboard` | Aggregated metrics |
| Pipeline Funnel | `GET /api/crm/analytics/pipeline` | Stage counts & values |
| Rep Leaderboard | `GET /api/crm/analytics/rep-performance` | Rep quotas, attainment |
| Recent Activity | `GET /api/crm/analytics/activities` | Latest 5 CRMActivity |

**Real-time Updates:** **NOT IMPLEMENTED.** The original text claimed subscription to `org:{orgId}:crm`. Source inspection finds no CRM room join and no `crm.*` event emission from `RealtimeGateway`. **[CORRECTED]**

### 3.2 Customer Directory (`/crm/customers`)

| UI Element | API Endpoint | Data |
|---|---|---|
| Search & Filters | `GET /api/customers` | `search`, `lifecycle`, `type`, `branchId` |
| Customer Table | `GET /api/customers` | Paginated list with `_count` |
| KPI Strip (Total Invoiced, Outstanding) | `GET /api/customers` + client calc | From customer fields |
| Create Customer | `POST /api/customers` | Modal form |
| Customer Detail | `GET /api/customers/:id` | Full 360° view |

**Customer Detail Drawer Tabs:**
| Tab | Data Source |
|---|---|
| Overview & Contacts | `customer.contacts`, `customer.creditLimit`, `customer.paymentTermsDays` |
| Deals | `customer.deals` with `assignedTo` |
| Receivables & Ledger | `customer.invoices`, `customer.salesOrders` |
| Tasks | `customer.tasks` with `assignedTo` |
| Timeline Log | `customer.activities` (CRMActivity) |

**Actions from Drawer:**
| Action | API |
|---|---|
| Add Contact | `POST /api/customers/:id/contacts` |
| Create Deal | `POST /api/deals` (pre-filled customerId) |
| Create Task | `POST /api/tasks` (pre-filled customerId) |

### 3.3 Deals Kanban (`/crm/deals`)

| UI Element | API Endpoint | Data |
|---|---|---|
| Stage Columns (6) | `GET /api/deals` | Grouped by `stage` |
| Deal Cards | `GET /api/deals` | `title`, `value`, `stage`, `winProbability`, `assignedTo`, `expectedCloseDate` |
| Filters (Search, Rep) | `GET /api/deals` | `search`, `assignedToId` |
| Drag-Drop / Stage Buttons | `POST /api/deals/:id/stage` | Optimistic UI + server sync |
| Deal Detail (click) | `GET /api/deals/:id` | Full detail with history |
| Create Deal | `POST /api/deals` | Modal |
| Won/Lost Dialog | `POST /api/deals/:id/stage` with `closeOutcome` | DealOutcomeModal |

**Real-time:** **NOT IMPLEMENTED.** The original text claimed subscription to `crm.deal.stage.changed` and `crm.deal.closed`. Neither event is emitted by the server and no client subscription exists. **[CORRECTED]**

### 3.4 Tasks Manager (`/crm/tasks`)

| UI Element | API Endpoint | Data |
|---|---|---|
| Task List | `GET /api/tasks` | Paginated, with `customer`, `deal` |
| Filters (Priority, Status, Overdue) | `GET /api/tasks` | `priority`, `status`, `overdue` |
| Toggle Complete | `POST /api/tasks/:id/complete` | Optimistic toggle |
| Snooze | `POST /api/tasks/:id/snooze` | Sets `snoozedUntil` |
| Create Task | `POST /api/tasks` | Modal with customer/deal/project/salesOrder links |
| Upcoming View | `GET /api/tasks/upcoming` | Grouped by time horizon |

---

## 4. Premium Capabilities — API only, no UI

> **Reconciled 2026-11-23.** The original §4 presented these as UI-to-API mappings. The APIs exist and are permission-guarded in `server/routes/crmPremium.ts`, but a search of `src/components` finds **no Saved View, Custom Field, Import/Export or Workflow Builder component**. These capabilities are reachable only by direct API call, not through the desktop UI. **[CORRECTED]**

| Capability | Backend API | Permission guard | Frontend UI |
|---|---|---|---|
| Saved Views | `GET/POST/PUT/DELETE /api/crm/saved-views` | `SUPER_ADMIN, ADMIN, SALES_MANAGER, SALES_REP` | **None — DEFERRED (FE-008)** |
| Custom Fields (definitions) | `GET/POST/PUT/DELETE /api/crm/custom-fields/definitions` | `SUPER_ADMIN, ADMIN` | **None — DEFERRED (FE-009)** |
| Custom Fields (values) | `GET/POST/PUT/DELETE /api/crm/custom-fields/values` | `SUPER_ADMIN, ADMIN, SALES_MANAGER, SALES_REP` | **None — DEFERRED (FE-009)** |
| Import / Export | `/api/crm/premium/import`, `/export` | enforced | **None — DEFERRED (FE-010)** |
| Workflow rules | `/api/crm/premium/workflows/*` | enforced | **None — DEFERRED (FE-011)** |
| Sales rep performance / quotas | `/api/sales-reps/*` | enforced | Dashboard KPI cards only — **DEFERRED (FE-007)** |

Status vocabulary: `BACKEND_API_PASS` for all rows; `DEFERRED` for all UI rows.

---

## 5. State Management

> **Reconciled 2026-11-23.** The original §5 described a store that "persists to localStorage" and "syncs with server on mutations". Source inspection shows a more specific arrangement: the server is authoritative on read, while localStorage acts as an optimistic cache that survives API failure. See `docs/PHASE-3-RELEASE-RECONCILIATION.md` §6.

### 5.1 Client-Side Store (Zustand-style, module-local)

```typescript
// src/modules/crm/store.ts
interface CrmState {
  customers: CustomerRecord[];
  contacts: CustomerContact[];
  deals: DealRecord[];
  tasks: TaskRecord[];
  salesReps: SalesRepRecord[];
  activityLogs: ActivityLogRecord[];
  isServerSynced?: boolean;
}
```

Verified behaviour (`src/modules/crm/store.ts`, `src/components/views/CrmView.tsx`):

| Property | Verified fact |
|---|---|
| Storage key | `innowit_crm_v3` (`store.ts:19`) |
| What is stored | **Full CRM business records** — customers, contacts, deals, tasks, sales reps, activity logs (`store.ts:107–136`) |
| Hydration order | localStorage first, then server replaces it on mount |
| Server fetch | `fetchCrmStateFromServer()` in `CrmView.tsx:63–100`; sets `isServerSynced: true` on success |
| On fetch failure | `serverError = 'Offline or fallback mode active'`; local cache remains and the UI shows a **"Local Cache Active"** badge (`CrmView.tsx:382`) |
| Write path | API called first, then local state updated regardless of outcome |
| On write failure | `console.warn('Could not persist customer to server, keeping optimistic local:', err)` — **local record stays, no rollback** (`CrmView.tsx:139–147`) |

**Classification:** `SERVER_BACKED` for reads; `SERVER_BACKED_OPTIMISTIC` with `LOCAL_CACHE_NON_AUTHORITATIVE` fallback for writes. Not `LOCAL_ONLY`, and not "localStorage removed".

### 5.2 Server Synchronization

| Client Action | Server Call | Optimistic Update | Rollback on failure |
|---|---|---|---|
| Create Customer | `POST /api/customers` | Add to `customers[]` immediately | **No** |
| Update Deal Stage | `POST /api/deals/:id/stage` | Move card in Kanban | **No** |
| Complete Task | `POST /api/tasks/:id/complete` | Toggle checkbox | **No** |
| Create Deal | `POST /api/deals` | Add to stage column | **No** |

---

## 6. Form Validation (Zod)

### 6.1 Customer Form
```typescript
createCustomerSchema = z.object({
  customerCode: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  kraPin: z.string().regex(/^[A-Z]\d{9}[A-Z]$/),
  email: z.string().email().optional(),
  lifecycle: z.enum(['LEAD', 'ACTIVE', 'INACTIVE']).default('LEAD'),
  type: z.enum(['CORPORATE', 'INDIVIDUAL']).default('CORPORATE'),
});
```

### 6.2 Deal Form
```typescript
createDealSchema = z.object({
  customerId: z.string().uuid(),
  assignedToId: z.string().uuid(),
  title: z.string().min(1).max(255),
  value: z.number().nonnegative(),
  stage: z.enum(['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED']),
  closeOutcome: z.enum(['WON', 'LOST']).optional(),
  winProbability: z.number().int().min(0).max(100),
  expectedCloseDate: z.string().datetime().optional(),
});
```

### 6.3 Task Form
```typescript
createTaskSchema = z.object({
  title: z.string().min(1).max(255),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  dueDate: z.string().datetime().optional(),
  assignedToId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  salesOrderId: z.string().uuid().optional(),
  reminderAt: z.string().datetime().optional(),
});
```

---

## 7. Error Handling UI

| Error Type | UI Response |
|---|---|
| `VALIDATION_ERROR` | Inline field errors |
| `DUPLICATE_ENTRY` | Toast: "Customer code already exists" |
| `FORBIDDEN` | Redirect to 403 page / disable action |
| `VERSION_CONFLICT` | Modal: "Record modified by another user. Refresh?" |
| `DEAL_NOT_WON` | Disable quotation button, show tooltip |
| Network Error | Retry button + offline indicator |

---

## 8. Accessibility

- All modals: Focus trap, ESC to close, ARIA labels
- Kanban: Keyboard navigation (Arrow keys), drag-drop alternative buttons
- Tables: Sortable headers with ARIA sort, row selection
- Forms: Required field indicators, error announcements
- Color: WCAG AA contrast, status badges with text labels

---

## 9. Performance Targets

| Metric | Target |
|---|---|
| Initial CRM load | < 2s |
| Kanban drag-drop latency | < 100ms |
| Customer search (10k records) | < 300ms |
| Dashboard metrics load | < 500ms |
| Task toggle complete | < 50ms (optimistic) |