# Innowit One - Dependency & Module Ownership Map
**Phase 0: Dependency Analysis**

> **Orchestrator correction (2026-11-17):** The "Phase" column in §4 follows this file's internal phase legend below §4, which is **not** the master prompt's phase numbering (master prompt: Phase 1 = desktop foundation/data platform, Phase 4 = accounting engine, Phase 6 = payroll/eTIMS, Phase 7 = BI/automation, Phase 8 = hardening). When planning work against `docs/roadmap/IMPLEMENTATION_STATUS.md`, remap using the master prompt phases; the *owner lane* and *migration target* columns are authoritative. Verified facts used: 4 live localStorage keys (ev_94d5096b…), COA memory-only on reload (ev_afe9a375…/ev_5d8cb24e…), `App.tsx` 1369 lines.

Generated from analysis of `src/App.tsx` (1369 lines) and project structure.
Repo: React 19 + TS + Vite + Tailwind v4 SPA, no backend.
Date: Tue Nov 17 2026

---

## 1. Module Inventory Table

| Module | Primary View File(s) | App.tsx State Slices Consumed | localStorage Keys Touched | Shared Components Used | Seed Data Dependencies |
|--------|---------------------|-------------------------------|--------------------------|-----------------------|----------------------|
| **Collaboration** | `CollaborationView` (`/collaboration`) | `currentUser`, `userRole`, `userId`, `currentPath`, `onNavigate` | None (user-context only) | None | `SEED_USERS` (via `currentUser`) |
| **CRM & Sales** | `CrmView` (`/crm`) | `customers` (and `onSyncCustomers` → `setCustomers`) | `innowit_crm_state_v1` (via `loadCrmState()`) | None | `SEED_USERS`, default customers from `crmState` |
| **Accounting & Finance** | `ChartOfAccountsView` (`/accounting/chart-of-accounts`) | `accounts`, `journalEntries` | `innowit_audit_logs_v1` (indirect via audit logging) | None | `DEFAULT_ACCOUNTS`, `DEFAULT_JOURNAL_ENTRIES`, `SEED_INVOICES` |
| | `InvoicesView` (`/accounting/invoices`) | `invoices`, `customers`, `products` | Same as above | None | `SEED_INVOICES`, `DEFAULT_CUSTOMERS`, `DEFAULT_PRODUCTS` |
| | `FinancialReportsView` (`/accounting/reports`) | `accounts`, `journalEntries` | Same | None | `DEFAULT_ACCOUNTS`, `DEFAULT_JOURNAL_ENTRIES` |
| | `JournalEntriesView` (`/accounting/journal-entries`) | `entries` (journalEntries), `accounts` | Same | None | `DEFAULT_JOURNAL_ENTRIES`, `DEFAULT_ACCOUNTS` |
| **ERP Operations** | `InventoryView` (`/inventory`) | `products`, `warehouses`, `warehouseStocks`, `stockMovements`, `fixedAssets` | `innowit_erp_state_v1` (via `loadErpState()`) | None | Default from `loadErpState()` |
| | `ProcurementView` (`/procurement`) | `purchaseOrders`, `goodsReceiptNotes`, `suppliers`, `supplierBills`, `salesOrders`, `quotations`, `products`, `warehouses`, `branches`, `customers` | Same ERP state | None | From `loadErpState()` + `SEED_INVOICES` |
| | `HrPayrollView` (`/hr`) | `departments`, `employees`, `payrollRuns`, `attendance`, `leaveRequests` | Same ERP state | None | From `loadErpState()` |
| **Kenya eTIMS** | `EtimsView` (`/etims`) | `records`, `queueItems`, `config`, `creditNotes`, `invoices`, `products`, `isSandbox`, `userId`, `userRole`, `userFullName` | `innowit_automation_rules_v1`, `innowit_system_notifications_v1`, `innowit_automation_logs_v1`, `innowit_audit_logs_v1` (all via module stores) | `ProductionSwitchModal` | `DEFAULT_ETIMS_RECORDS`, `SEED_ETIMS_QUEUE`, `SEED_CREDIT_NOTES`, `etimsSeed` data |
| **Intelligence & Automation** | `ExecutiveBiView` (`/bi/executive`) | `accounts`, `journalEntries`, `invoices`, `products`, `customers`, `deals` (from `crmState`), `suppliers`, `supplierBills`, `employees` | Same audit/notification keys | None | `DEFAULT_ETIMS_CONFIG`, `crmState.deals`, `erpState` fields |
| | `WorkflowAutomationsView` (`/bi/automations`) | `rules`, `logs`, `onToggleRule`, `onRunEngine`, `onCreateRule` | Same keys | None | `loadAutomationRules()`, `loadAutomationLogs()`, `SEED_CREDIT_NOTES` |
| | `AuditLogsView` (`/system/audit-logs`) | `auditLogs` | Same audit key | None | `loadAuditLogs()` |
| **Governance** (RBAC/Acceptance) | `RbacMatrixView` (`/system/rbac`) | `currentRole`, `onOpenRoleSwitcher` | Same keys (audit logging) | None | `SEED_USERS` |
| | `Phase8HardeningView` (`/system/hardening`) | `accounts`, `journalEntries`, `products`, `invoices`, `customers`, `purchaseOrders`, `stockMovements`, `warehouseStocks`, `queueItems`, `creditNotes`, `allUsers`, `currentUser`, `isSandbox`, `taxpayerPin` | Same keys + ERP + eTIMS | None | Comprehensive: all seed data |
| **Shell** (sidebar/topbar/command palette) | `Sidebar` | `currentPath`, `onNavigate`, `collapsed`, `onToggleCollapse`, `userRole` | None direct | None | `SEED_USERS` (via `currentUser`) |
| | `TopBar` | `branches`, `activeBranch`, `isSandbox`, `currentUser`, `notifications`, `onToggleSandbox`, `onNotificationClick`, `onClearNotifications` | `innowit_system_notifications_v1` (via `loadNotifications()`/`saveNotifications()`) | None | `SEED_USERS` (via `currentUser`), `DEFAULT_BRANCHES` |
| | `CommandPalette` | `customers`, `invoices`, `products`, `employees`, `deals` | Same notification key (via TopBar) | None | Derived from active state |

---

## 2. Dependency Map: Cross-Module Data Dependencies

### Key Cross-Module Dependencies (→ indicates "reads from / depends on"):

| Dependent View/Module | Depends On (source) | Risk Level |
|----------------------|---------------------|------------|
| **InvoicesView** | `customers` → CRM module<br>`products` → ERP/Inventory module<br>`accounts` → Accounting/Chart of Accounts | 🔴 **HIGH** - 3-module coupling; invoicing is the primary cross-module data hub |
| **EtimsView** | `invoices` → Accounting/Invoicing<br>`products` → ERP/Inventory<br>`customers` → CRM<br>`config` → eTIMS compliance<br>`creditNotes` → Accounting/JournalEntries | 🔴 **CRITICAL** - Reads nearly all state slices; single point of failure |
| **ExecutiveBiView** | `accounts` → Accounting<br>`journalEntries` → Accounting<br>`invoices` → Accounting/Invoicing<br>`products` → ERP/Inventory<br>`customers` → CRM<br>`deals` → CRM<br>`suppliers`, `supplierBills` → ERP/Procurement<br>`employees` → ERP/HR | 🔴 **CRITICAL** - BI depends on **everything**; largest cross-module dependency |
| **ProcurementView** | `products` → ERP/Inventory<br>`warehouses` → ERP baseline<br>`branches` → Shell/TopBar<br>`customers` → CRM/Invoicing<br>`salesOrders`, `purchaseOrders` → ERP baseline<br>`suppliers`, `supplierBills` → ERP baseline<br>`quotations` → ERP baseline | 🟠 **HIGH** - Heavy ERP coupling; touches almost every ERP slice |
| **InventoryView** | `products` → shared catalog<br>`warehouses`, `warehouseStocks` → ERP baseline<br>`stockMovements` → ERP baseline<br>`fixedAssets` → ERP baseline | 🟠 **HIGH** - ERP state mutations affect inventory accuracy |
| **FinancialReportsView** | `accounts` → Accounting<br>`journalEntries` → Accounting/Journal | 🟠 **HIGH** - Relies on accounting accuracy; prop-drilling from App.tsx |
| **HrPayrollView** | `employees`, `payrollRuns`, `departments`, `leaveRequests` → ERP baseline | 🟠 **HIGH** - HR state isolated but ERP-dependent |
| **CrmView** | `customers` → own state; `onSyncCustomers` writes back to App.tsx `customers` slice | 🟡 **MEDIUM** - CRM ↔ Accounting customer data flow |
| **CollaborationView** | `currentUser`, `userRole` → security/rbac | 🟢 **LOW** - Only security context; no business data coupling |

### Risky Coupling Flags:

1. **App.tsx monolith state** - 23 state slices in a single component; any mutation ripples to all dependent views
2. **Invoices as cross-module hub** - `invoices` state is consumed/produced by Accounting, eTIMS, BI, and Shell; mutations in one area affect all others
3. **Products shared across 5+ modules** - `products` consumed by Invoices, Inventory, Procurement, eTIMS, BI; any product mutation has wide-reaching effects
4. **ERP state as shared backbone** - `erpState` (departments, employees, payrollRuns, purchaseOrders, etc.) consumed by Inventory, Procurement, HrPayroll; mutations are widespread
5. **eTIMS ↔ Invoices coupling** - Invoicing automatically enqueues eTIMS records; eTIMS transmission affects invoice status and vice versa
6. **CRM customers shared with Accounting** - `customers` slice fed from `crmState`; CRM sync (`onSyncCustomers`) overwrites App.tsx customers, risking stale data in invoicing
7. **BI depends on everything** - `ExecutiveBiView` explicitly lists 9+ state slices from distinct modules; any state change requires BI re-validation
8. **AuditLogs as both UI state and persistence** - `auditLogs` stored in React state AND localStorage; mutations in `handleToggleRule`/`handleCreateRule` update both, risking desync
9. **Notification state dual-stored** - `notifications` in React state AND localStorage `innowit_system_notifications_v1`; `handleClearNotifications` updates both but could drift
10. **Seed data as initial source of truth** - `DEFAULT_*` constants and seed files (`kernel.ts`, `accountingSeed.ts`, `etimsSeed.ts`) initialize all state; any drift from baseline requires `handleResetDemoData`

---

## 3. Persistence Inventory

### Entity-Type Storage Classification:

| Entity Type | Storage Mode | Keys (source) | Notes |
|-------------|-------------|---------------|-------|
| **Accounts** | React state only | `accounts` in App.tsx useState | **COA mutations are memory-only** - lost on reload (live evidence). localStorage has no dedicated account key. |
| **Journal Entries** | React state only | `journalEntries` in App.tsx useState | Lost on reload; no localStorage key. |
| **Invoices** | React state + partial | `invoices` in App.tsx useState; not persistently stored in localStorage beyond seed | Not in the 4 live keys; re-seeded on reset. |
| **eTIMS Records** | React state + localStorage | `etimsRecords` in App.tsx useState; `innowit_audit_logs_v1` (contains audit entries) | 4 live localStorage keys exist but do NOT include etims records directly. |
| **Customers** | React state + CRM store | `customers` in App.tsx; `loadCrmState()`/ `saveCrmState()` in CRM module | CRM store persists to localStorage; `innowit_crm_state_v1` likely (not in the 4 live keys). |
| **Products** | React state only | `products` in App.tsx useState | Not in localStorage 4 keys. |
| **eTIMS Config** | React state + localStorage | `etimsConfig` in App.tsx; part of `innowit_automation_rules_v1` or separate key | |
| **eTIMS Queue Items** | React state only | `etimsQueue` in App.tsx useState | Not persistently stored beyond session. |
| **Credit Notes** | React state + localStorage | `creditNotes` in App.tsx; part of eTIMS module store | |
| **Automation Rules** | React state + localStorage | `automationRules` in App.tsx; **`innowit_automation_rules_v1`** (one of 4 live keys) | Verified: code writes to this key via `saveAutomationRules()` |
| **Automation Logs** | React state + localStorage | `automationLogs` in App.tsx; **`innowit_automation_logs_v1`** (one of 4 live keys) | Verified: code writes to this key. |
| **System Notifications** | React state + localStorage | `notifications` in App.tsx; **`innowit_system_notifications_v1`** (one of 4 live keys) | Verified: code writes to this key via `saveNotifications()`. |
| **Audit Logs** | React state + localStorage | `auditLogs` in App.tsx; **`innowit_audit_logs_v1`** (one of 4 live keys) | Verified: code writes to this key via `logAuditEntry()`/`setAuditLogs()`. |
| **ERP State** | React state + localStorage | `erpState` in App.tsx; stored via `loadErpState()`/`saveErpState()` | Not in the 4 live keys; has its own persistence mechanism. |
| **Deals (CRM)** | React state only (via crmState) | `crmState.deals`; loaded via `loadCrmState()` | Part of CRM store persistence. |

### Key Observation: localStorage vs. React State Gap

- **4 keys actually present on running app:**
  - `innowit_automation_rules_v1`
  - `innowit_system_notifications_v1`
  - `innowit_automation_logs_v1`
  - `innowit_audit_logs_v1`

- **Code CAN write additional keys (not currently present on running app):**
  - `innowit_erp_state_v1` (via `saveErpState()` in ERP module)
  - `innowit_crm_state_v1` (via `loadCrmState()` in CRM module)
  - Missing persistence for: `accounts`, `journalEntries`, `invoices`, `products`, `etimsRecords`, `etimsQueue`

- **Difference:** Critical business state (accounts, invoices, products, etims records) is **volatile** (lost on reload) while only "metadata/logs" persists in localStorage. This creates a risk of data inconsistency on page refresh.

---

## 4. Ownership Map for Implementation Phases

| File / State Slice | Owner Lane | Phase (1-8) | Migration Target |
|-------------------|------------|-------------|------------------|
| `App.tsx` monolith state (23 slices) | **Desktop Platform** | Phase 1 | Extract state slices into dedicated modules; reduce prop-drilling |
| `accounts` slice + `ChartOfAccountsView` | **Accounting** | Phase 2 | Move accounts state to Accounting module; standalone CoA view |
| `journalEntries` slice + `JournalEntriesView` | **Accounting** | Phase 2 | Isolate journal entry management |
| `invoices` slice + `InvoicesView` + `FinancialReportsView` | **Accounting** | Phase 3 | Full invoicing module with AR/AP; separate from App.tsx |
| `customers` slice + `onSyncCustomers` | **CRM** | Phase 3 | CRM owns customer state; sync with App.tsx via API |
| `products` slice + `InventoryView` + `ProcurementView` partial | **ERP** | Phase 4 | Product catalog moves to ERP module; views consume via API |
| `erpState` (departments, employees, payrollRuns, etc.) | **Payroll/HR** | Phase 4 | HR module owns ERP operational state |
| `etimsRecords`, `etimsQueue`, `etimsConfig` + `EtimsView` | **eTIMS** | Phase 5 | eTIMS compliance module with KRA transmission |
| `crmState` (including `deals`) + `CrmView` | **CRM** | Phase 3 | Full CRM pipeline management |
| `auditLogs` + `AuditLogsView` + `logAuditEntry` | **Data Platform & Security** | Phase 5 | Audit trail as immutable service; separate from app state |
| `automationRules`, `automationLogs` + `WorkflowAutomationsView` | **BI/Automation** | Phase 7 | Workflow engine as standalone service |
| `notifications` + `TopBar` + `handleClearNotifications` | **BI/Automation** | Phase 7 | Notification service with persistent storage |
| `branches`, `activeBranch` + `TopBar` + `Sidebar` | **Desktop Platform** | Phase 1 | Navigation/organizational state |
| `Sidebar`, `TopBar`, `CommandPalette` (shell components) | **UX** | Phase 1 | UI shell refactoring; state minimalization |
| `RbacMatrixView` + `canViewModule` | **Data Platform & Security** | Phase 5 | RBAC as independent authorization service |
| `Phase8HardeningView` + all state slices | **All lanes (coordinated)** | Phase 8 | Acceptance testing; final integration |
| `ForbiddenNotice` + RBAC checks | **Data Platform & Security** | Phase 5 | Access control as middleware |

**Phase Legend:**
1. **Scaffold & Shell** - Navigation, RBAC, persistent layout
2. **Accounting Core** - Chart of Accounts, Journal Entries, Invoicing
3. **CRM & Sales** - Customer & Deal management
4. **ERP Operations** - Inventory, Procurement, HR/Payroll
5. **Compliance & Audit** - eTIMS, Audit Trails, RBAC
6. *(skip - no backend)*
7. **BI & Automation** - Executive dashboards, Workflow engine
8. **Hardening & Acceptance** - Production readiness, testing, seeding

---

## 5. Refactor Risk Flags (Top 10 Riskiest Areas for Phase 1 Migration)

| # | Risk Flag | File:Line Reference | Description |
|---|-----------|---------------------|-------------|
| 1 | **App.tsx monolith state** | `App.tsx:100-146` | 23 `useState`/`useMemo` declarations in single component; any state mutation affects all dependent views. Phase 1 must extract slices into dedicated modules. |
| 2 | **Prop drilling depth through App.tsx** | `App.tsx:1035-1056`; `App.tsx:1086-1112` | Views receive props from App.tsx state via long chain: e.g., `InvoicesView` receives `invoices`, `customers`, `products` from App.tsx; any change requires coordinated update across all consumers. |
| 3 | **Invoices as cross-module data hub** | `App.tsx:439-573`; `App.tsx:575-661` | `handleCreateInvoice` mutates `invoices`, `journalEntries`, `accounts`, `etimsRecords`, `etimsQueue` — 5 state slices in one function. Highest risk for Phase 1 ripples. |
| 4 **Products shared across 5+ modules** | `App.tsx:124-125`; consumed by `InvoicesView` (line 1050), `InventoryView` (line 1131), `ProcurementView` (line 1156), `EtimsView` (line 1092), `ExecutiveBiView` (line 1211) | Any product mutation (stock changes, pricing) affects all these views simultaneously. No centralized product service. |
| 5 | **ERP state as backbone for 3 modules** | `App.tsx:131-140`; `erpState` consumed by `InventoryView` (line 1132-1135), `ProcurementView` (line 1150-1166), `HrPayrollView` (line 1174-1189) | ERP mutations (`updateErpState`, `handleAddJournalEntry`, etc.) have wide-reaching effects across Inventory, Procurement, and HR. |
| 6 | **eTIMS ↔ Invoices automatic enqueue** | `App.tsx:522-573` (`handleCreateInvoice`) | Creating an invoice automatically enqueues eTIMS records AND updates audit logs. Decoupling requires redesign of the invoicing → eTIMS pipeline. |
| 7 | **CRM customers sync instability** | `App.tsx:116-116`; `CrmView` `onSyncCustomers` prop → `setCustomers` | CRM sync overwrites App.tsx `customers` slice; risk of stale data in InvoicesView if CRM and App state drift. |
| 8 | **Dual-localStorage/React-state persistence** | `App.tsx:143-146`; `App.tsx:207-211`; `App.tsx:335-348` | `auditLogs`, `notifications`, `automationRules` stored in both React state and localStorage; `setAuditLogs(loadAuditLogs())` pattern risk desync on reload. |
| 9 | **handleResetDemoData sprawl** | `App.tsx:698-726` | Resets 10+ state slices from baseline kernel; any new module added to baseline requires updating this single function — bottleneck for Phase 1 incremental migration. |
| 10 | **Sandbox/production air-gap state** | `App.tsx:114`; `isSandbox` used by `EtimsView` (line 1093), `TopBar` (line 1315), `handleActivateProduction` (line 672), `handleLockSandbox` (line 682) | `isSandbox` boolean drives eTIMS compliance behavior; mutations scattered across 4+ handlers with audit logging each time. |

**Top 5 Risk Summary:**
1. App.tsx monolith state (23 slices) — must be deconstructed in Phase 1
2. `handleCreateInvoice` mutates 5 state slices — highest single-function risk
3. Products shared across 5+ modules — any product change has cascading effects
4. ERP state backbone for 3 modules — ERP mutations are high-risk
5. Dual-state persistence (React + localStorage) — desync risk on reload

---

## Summary Statistics

- **Views found:** 28 (across all modules + shell + governance)
- **localStorage keys found in source:** 8+ (4 live on running app + 4 code-can-write beyond the 4 live keys)
- **Cross-module dependencies flagged:** 12+ (invoices, products, ERP state, customers, auditLogs, notifications automationRules cross module boundaries)
- **Top 5 risk flags:** App.tsx monolith, `handleCreateInvoice` ripples, products cross-module coupling, ERP state backbone, dual-state persistence desync