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

**Real-time Updates:** Subscribes to `org:{orgId}:crm` for deal/task updates

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

**Real-time:** Subscribes to `crm.deal.stage.changed`, `crm.deal.closed`

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

## 4. Premium Capabilities UI

### 4.1 Saved Views
| UI | API |
|---|---|
| Save Current View | `POST /api/crm/premium/saved-views` |
| Load Saved View | `GET /api/crm/premium/saved-views/:id` |
| Manage Views | `GET /api/crm/premium/saved-views` |

### 4.2 Custom Fields
| UI | API |
|---|---|
| Define Fields (Admin) | `POST/PUT/DELETE /api/crm/premium/custom-fields/definitions` |
| Set Field Values | `POST/PUT /api/crm/premium/custom-fields/values` |
| Display in Forms/Grids | Client-side render from `CustomFieldValue` |

### 4.3 Import/Export
| UI | API |
|---|---|
| Import Wizard | `POST /api/crm/premium/import` (dry-run first) |
| Export Data | `POST /api/crm/premium/export` (CSV/JSON) |

### 4.4 Workflow Automation
| UI | API |
|---|---|
| Rule Builder (Admin) | `POST/PUT/DELETE /api/crm/premium/workflows/rules` |
| Execution Logs | `GET /api/crm/premium/workflows/executions` |
| Manual Trigger | `POST /api/crm/premium/workflows/rules/:id/execute` |

---

## 5. State Management

### 5.1 Client-Side Store (Zustand)
```typescript
// src/modules/crm/store.ts
interface CrmState {
  customers: CustomerRecord[];
  contacts: CustomerContact[];
  deals: DealRecord[];
  tasks: TaskRecord[];
  salesReps: SalesRepRecord[];
  activityLogs: ActivityLogRecord[];
}
```
- Persists to `localStorage` (key: `innowit_crm_v3`)
- Hydrates on app load
- Syncs with server on mutations (optimistic updates)

### 5.2 Server Synchronization
| Client Action | Server Call | Optimistic Update |
|---|---|---|
| Create Customer | `POST /api/customers` | Add to `customers[]` immediately |
| Update Deal Stage | `POST /api/deals/:id/stage` | Move card in Kanban |
| Complete Task | `POST /api/tasks/:id/complete` | Toggle checkbox |
| Create Deal | `POST /api/deals` | Add to stage column |

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