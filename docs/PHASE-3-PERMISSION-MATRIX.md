# PHASE 3 PERMISSION MATRIX: INNOWIT ONE CRM & SALES PIPELINE

**Document Version:** 1.0.0  
**Date:** 2026-11-19  
**Status:** As-Built  

---

## 1. Role Hierarchy

| Level | Role | Description |
|---|---|---|
| 1 | `SUPER_ADMIN` | Platform owner, all access |
| 2 | `ADMIN` | Organization admin, full org access |
| 3 | `EXECUTIVE` | C-level, read-all, approve |
| 4 | `SALES_MANAGER` | Sales team lead, team management |
| 5 | `FINANCE_MANAGER` | Finance lead, accounting access |
| 6 | `ACCOUNTANT` | Accounting operations |
| 7 | `SALES_REP` | Individual contributor |
| 8 | `PROCUREMENT_OFFICER` | Purchasing |
| 9 | `INVENTORY_MANAGER` | Stock management |
| 10 | `HR_MANAGER` | Human resources |
| 11 | `PROJECT_MANAGER` | Project delivery |
| 12 | `EMPLOYEE` | Basic access |

---

## 2. CRM Permission Matrix

### 2.1 Customers

| Permission | SUPER_ADMIN | ADMIN | EXECUTIVE | SALES_MANAGER | FINANCE_MANAGER | SALES_REP | Others |
|---|---|---|---|---|---|---|---|
| `crm.customers.view.own` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `crm.customers.view.branch` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `crm.customers.view.organization` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `crm.customers.create` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |
| `crm.customers.update.own` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |
| `crm.customers.update.assigned` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `crm.customers.archive` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `crm.customers.import` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `crm.customers.export` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `crm.customers.checkDuplicates` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |

**Scope Rules:**
- `view.own`: SALES_REP sees customers in their branch (or assigned)
- `view.branch`: SALES_MANAGER+ sees all customers in their branch
- `view.organization`: ADMIN+ sees all org customers

### 2.2 Contacts

| Permission | SUPER_ADMIN | ADMIN | EXECUTIVE | SALES_MANAGER | FINANCE_MANAGER | SALES_REP |
|---|---|---|---|---|---|---|
| `crm.contacts.view` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅* |
| `crm.contacts.create` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| `crm.contacts.update` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| `crm.contacts.delete` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `crm.contacts.setPrimary` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |

*SALES_REP: only for customers they own/assigned

### 2.3 Deals

| Permission | SUPER_ADMIN | ADMIN | EXECUTIVE | SALES_MANAGER | FINANCE_MANAGER | SALES_REP |
|---|---|---|---|---|---|---|
| `crm.deals.view.own` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `crm.deals.view.team` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `crm.deals.view.branch` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `crm.deals.view.organization` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `crm.deals.create` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| `crm.deals.update.own` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| `crm.deals.update.assigned` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `crm.deals.assign` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `crm.deals.close` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅* |
| `crm.deals.reopen` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `crm.deals.createQuotation` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅* |

*SALES_REP: only for deals they own/assigned

**Close Rules:**
- SALES_REP: Can close own deals to WON/LOST
- SALES_MANAGER+: Can close any deal in org
- Reopen: SALES_MANAGER+ only, requires reason

### 2.4 Tasks

| Permission | SUPER_ADMIN | ADMIN | EXECUTIVE | SALES_MANAGER | FINANCE_MANAGER | SALES_REP | HR_MANAGER | PROJECT_MANAGER |
|---|---|---|---|---|---|---|---|---|
| `crm.tasks.view.own` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| `crm.tasks.view.team` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| `crm.tasks.create` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ |
| `crm.tasks.update.own` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ |
| `crm.tasks.update.assigned` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| `crm.tasks.assign` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| `crm.tasks.complete` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅* | ✅ | ✅ |

*SALES_REP: only own tasks

### 2.5 Activities

| Permission | SUPER_ADMIN | ADMIN | EXECUTIVE | SALES_MANAGER | FINANCE_MANAGER | SALES_REP |
|---|---|---|---|---|---|---|
| `crm.activities.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅* |
| `crm.activities.create` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |

*SALES_REP: only for customers/deals they own

### 2.6 Sales Reps & Quotas

| Permission | SUPER_ADMIN | ADMIN | EXECUTIVE | SALES_MANAGER | FINANCE_MANAGER | SALES_REP |
|---|---|---|---|---|---|---|
| `crm.reps.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅* |
| `crm.quotas.view` | ✅ | ✅ | ✅ | ✅ | ✅ | own |
| `crm.quotas.create` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `crm.quotas.update` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `crm.quotas.delete` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |

*SALES_REP: sees own quota only

### 2.7 Commissions

| Permission | SUPER_ADMIN | ADMIN | EXECUTIVE | SALES_MANAGER | FINANCE_MANAGER | SALES_REP |
|---|---|---|---|---|---|---|
| `crm.commissions.rules.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `crm.commissions.rules.manage` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `crm.commissions.records.view` | ✅ | ✅ | ✅ | ✅ | ✅ | own |
| `crm.commissions.records.calculate` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `crm.commissions.records.approve` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

### 2.8 Analytics

| Permission | SUPER_ADMIN | ADMIN | EXECUTIVE | SALES_MANAGER | FINANCE_MANAGER | SALES_REP |
|---|---|---|---|---|---|---|
| `crm.analytics.dashboard` | ✅ | ✅ | ✅ | ✅ | ✅ | own+team |
| `crm.analytics.pipeline` | ✅ | ✅ | ✅ | ✅ | ❌ | own |
| `crm.analytics.repPerformance` | ✅ | ✅ | ✅ | ✅ | ❌ | own |
| `crm.analytics.customers` | ✅ | ✅ | ✅ | ✅ | ❌ | own |
| `crm.analytics.export` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |

### 2.9 Premium Capabilities

| Permission | SUPER_ADMIN | ADMIN | EXECUTIVE | SALES_MANAGER | FINANCE_MANAGER | SALES_REP |
|---|---|---|---|---|---|---|
| `crm.savedViews.manage` | ✅ | ✅ | ❌ | ✅ | ❌ | own+shared |
| `crm.customFields.definitions.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `crm.customFields.values.manage` | ✅ | ✅ | ❌ | ✅ | ❌ | own |
| `crm.import.execute` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `crm.export.execute` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `crm.workflows.rules.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `crm.workflows.execute` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 3. Scope Resolution Logic

### 3.1 Customer/Deal Visibility
```typescript
function getCustomerScope(user: User): Prisma.CustomerWhereInput {
  if (isSuperAdminOrAdmin(user)) {
    return { organizationId: user.organizationId };
  }
  if (isSalesManager(user)) {
    return { organizationId: user.organizationId, branchId: user.branchId };
  }
  // SALES_REP, etc.
  return { organizationId: user.organizationId, branchId: user.branchId };
}
```

### 3.2 Deal Ownership
```typescript
function canAccessDeal(user: User, deal: Deal): boolean {
  if (isSuperAdminOrAdminOrExecutive(user)) return true;
  if (isSalesManager(user)) return deal.customer.branchId === user.branchId;
  return deal.assignedToId === user.userId;
}
```

### 3.3 Task Assignment
```typescript
function canAssignTask(user: User, targetUserId: string): boolean {
  if (isSuperAdminOrAdmin(user)) return true;
  if (isSalesManagerOrHRManagerOrProjectManager(user)) return true;
  return false; // SALES_REP cannot assign to others
}
```

---

## 4. Cross-Entity Access Control

| Entity Link | Validation |
|---|---|
| Task → Customer | Customer must be in user's org (and branch if non-manager) |
| Task → Deal | Deal's customer must be in user's org |
| Task → Project | Project must be in user's org |
| Task → SalesOrder | SalesOrder's customer must be in user's org |
| Quotation → Deal | Deal must be CLOSED/WON, in user's org |
| CommissionRecord → Deal | Deal must be in user's org |
| CustomFieldValue → Entity | Entity must be in user's org |

---

## 5. Default Permission Seeding

### 5.1 Role-Based Defaults
```sql
-- Seeded on organization creation
INSERT INTO "Permission" (role, resource, action, scope) VALUES
  -- SUPER_ADMIN
  ('SUPER_ADMIN', 'crm.customers', '*', 'organization'),
  ('SUPER_ADMIN', 'crm.deals', '*', 'organization'),
  ('SUPER_ADMIN', 'crm.tasks', '*', 'organization'),
  -- SALES_MANAGER
  ('SALES_MANAGER', 'crm.customers', 'view', 'branch'),
  ('SALES_MANAGER', 'crm.customers', 'create', 'branch'),
  ('SALES_MANAGER', 'crm.deals', 'view', 'branch'),
  ('SALES_MANAGER', 'crm.deals', 'close', 'branch'),
  ('SALES_MANAGER', 'crm.deals', 'reopen', 'branch'),
  -- SALES_REP
  ('SALES_REP', 'crm.customers', 'view', 'branch'),
  ('SALES_REP', 'crm.customers', 'create', 'branch'),
  ('SALES_REP', 'crm.deals', 'view', 'own'),
  ('SALES_REP', 'crm.deals', 'create', 'own'),
  ('SALES_REP', 'crm.deals', 'close', 'own'),
  ('SALES_REP', 'crm.tasks', 'view', 'own'),
  ('SALES_REP', 'crm.tasks', 'create', 'own'),
  -- FINANCE_MANAGER
  ('FINANCE_MANAGER', 'crm.analytics', 'view', 'organization'),
  -- EXECUTIVE
  ('EXECUTIVE', 'crm.*', 'view', 'organization');
```

---

## 6. Audit & Compliance

### 6.1 Permission Changes Audited
All permission grants/revokes logged to `AuditLog` with:
- Actor, target user, resource, action, timestamp
- Previous and new state (JSON)

### 6.2 Access Logs
Failed authorization attempts logged (403 responses) for security monitoring.

### 6.3 Data Export Controls
- Export endpoints require explicit `crm.*.export` permission
- Exports respect same scope as list views
- Sensitive fields (KRA PIN, credit limit) included but flagged