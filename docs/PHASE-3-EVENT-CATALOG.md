# PHASE 3 EVENT CATALOG: INNOWIT ONE CRM & SALES PIPELINE

**Document Version:** 1.0.0  
**Date:** 2026-11-19  
**Status:** As-Built  
**Transport:** Socket.IO via Phase 2 `RealtimeGateway`  
**Namespace:** `/crm`  

---

## 1. Event Structure

All CRM events follow a standard envelope:

```typescript
interface CrmEvent<T = any> {
  event: string;           // Event type identifier
  payload: T;              // Event-specific data
  meta: {
    eventId: string;       // UUID v4
    timestamp: string;     // ISO 8601
    organizationId: string;
    actorId: string;       // User who triggered
    correlationId?: string; // For tracing related events
  };
}
```

---

## 2. Customer Events

### 2.1 `crm.customer.created`
**Trigger:** Customer created via API  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "customerId": "uuid",
  "customerCode": "CUST-001",
  "name": "Safaricom PLC",
  "lifecycle": "LEAD",
  "type": "CORPORATE",
  "assignedToId": "uuid"
}
```

### 2.2 `crm.customer.updated`
**Trigger:** Customer profile updated  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "customerId": "uuid",
  "changes": {
    "name": { "old": "Old Name", "new": "New Name" },
    "creditLimit": { "old": "1000000", "new": "2000000" }
  }
}
```

### 2.3 `crm.customer.lifecycle.changed`
**Trigger:** Customer lifecycle transition  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "customerId": "uuid",
  "from": "LEAD",
  "to": "ACTIVE",
  "reason": "First deal won"
}
```

### 2.4 `crm.customer.archived`
**Trigger:** Customer set to INACTIVE (soft delete)  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "customerId": "uuid",
  "reason": "Customer inactive for 12 months"
}
```

---

## 3. Contact Events

### 3.1 `crm.contact.created`
**Trigger:** Contact added to customer  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "contactId": "uuid",
  "customerId": "uuid",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@doe.com",
  "isPrimary": true
}
```

### 3.2 `crm.contact.updated`
**Trigger:** Contact details modified  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "contactId": "uuid",
  "customerId": "uuid",
  "changes": { "phone": { "old": "+254 700 000 000", "new": "+254 711 111 111" } }
}
```

### 3.3 `crm.contact.primary.changed`
**Trigger:** Primary contact designation changed  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "customerId": "uuid",
  "oldPrimaryContactId": "uuid|null",
  "newPrimaryContactId": "uuid"
}
```

### 3.4 `crm.contact.deleted`
**Trigger:** Contact removed  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "contactId": "uuid",
  "customerId": "uuid",
  "wasPrimary": true,
  "promotedContactId": "uuid|null"
}
```

---

## 4. Deal Events

### 4.1 `crm.deal.created`
**Trigger:** New deal created  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "dealId": "uuid",
  "customerId": "uuid",
  "customerName": "Safaricom PLC",
  "assignedToId": "uuid",
  "assignedToName": "Kevin Mutiso",
  "title": "Enterprise License Renewal",
  "value": "5000000",
  "currency": "KES",
  "stage": "NEW_LEAD",
  "winProbability": 20,
  "expectedCloseDate": "2026-12-31T00:00:00.000Z"
}
```

### 4.2 `crm.deal.updated`
**Trigger:** Deal fields updated (non-stage)  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "dealId": "uuid",
  "changes": {
    "expectedCloseDate": { "old": "2026-12-31", "new": "2027-01-15" },
    "winProbability": { "old": 60, "new": 75 }
  }
}
```

### 4.3 `crm.deal.stage.changed`
**Trigger:** Deal moves between stages  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "dealId": "uuid",
  "fromStage": "QUALIFIED",
  "toStage": "PROPOSAL",
  "closeOutcome": null,
  "winProbability": 75,
  "changedById": "uuid",
  "reason": "Client approved proposal"
}
```

### 4.4 `crm.deal.closed`
**Trigger:** Deal reaches CLOSED stage  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "dealId": "uuid",
  "customerId": "uuid",
  "customerName": "Safaricom PLC",
  "outcome": "WON",
  "value": "5000000",
  "currency": "KES",
  "closedAt": "2026-11-15T14:30:00.000Z",
  "commissionCalculated": true,
  "quotationGenerated": true
}
```

### 4.5 `crm.deal.reopened`
**Trigger:** Closed deal reopened  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "dealId": "uuid",
  "previousOutcome": "LOST",
  "newStage": "NEGOTIATION",
  "reopenedById": "uuid",
  "reopenReason": "Client renewed interest"
}
```

### 4.6 `crm.deal.commission.calculated`
**Trigger:** Commission record created for won deal  
**Room:** `org:{organizationId}:crm` (private: only commission participants)  
**Payload:**
```json
{
  "commissionRecordId": "uuid",
  "dealId": "uuid",
  "userId": "uuid",
  "amount": "500000",
  "currency": "KES",
  "rateApplied": 10.00,
  "status": "PENDING"
}
```

---

## 5. Task Events

### 5.1 `crm.task.created`
**Trigger:** New task created  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "taskId": "uuid",
  "customerId": "uuid",
  "dealId": "uuid|null",
  "projectId": "uuid|null",
  "salesOrderId": "uuid|null",
  "title": "Send revised SLA",
  "priority": "HIGH",
  "assignedToId": "uuid",
  "dueDate": "2026-12-15T00:00:00.000Z",
  "reminderAt": "2026-12-14T09:00:00.000Z"
}
```

### 5.2 `crm.task.updated`
**Trigger:** Task fields modified  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "taskId": "uuid",
  "changes": {
    "dueDate": { "old": "2026-12-15", "new": "2026-12-20" },
    "priority": { "old": "MEDIUM", "new": "HIGH" }
  }
}
```

### 5.3 `crm.task.completed`
**Trigger:** Task marked complete  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "taskId": "uuid",
  "completedById": "uuid",
  "completedAt": "2026-11-15T10:30:00.000Z"
}
```

### 5.4 `crm.task.reopened`
**Trigger:** Completed task set back to PENDING  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "taskId": "uuid",
  "reopenedById": "uuid",
  "reason": "Additional work required"
}
```

### 5.5 `crm.task.reassigned`
**Trigger:** Task assigned to different user  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "taskId": "uuid",
  "fromUserId": "uuid",
  "toUserId": "uuid",
  "reassignedById": "uuid"
}
```

### 5.6 `crm.task.snoozed`
**Trigger:** Reminder snoozed  
**Room:** `org:{organizationId}:crm` (private: assignee only)  
**Payload:**
```json
{
  "taskId": "uuid",
  "snoozedUntil": "2026-12-16T09:00:00.000Z"
}
```

---

## 6. Quotation Events

### 6.1 `crm.quotation.generated`
**Trigger:** Quotation created from won deal  
**Room:** `org:{organizationId}:crm`  
**Payload:**
```json
{
  "quotationId": "uuid",
  "dealId": "uuid",
  "quotationNumber": "QUO-2026-001",
  "value": "5500000",
  "currency": "KES"
}
```

---

## 7. Commission Events

### 7.1 `crm.commission.calculated`
**Trigger:** Commission record created  
**Room:** `org:{organizationId}:crm` (private: rep + managers)  
**Payload:**
```json
{
  "commissionRecordId": "uuid",
  "dealId": "uuid",
  "dealTitle": "Enterprise License Renewal",
  "userId": "uuid",
  "userName": "Kevin Mutiso",
  "amount": "500000",
  "currency": "KES",
  "basisAmount": "5000000",
  "rateApplied": 10.00,
  "status": "PENDING"
}
```

### 7.2 `crm.commission.approved`
**Trigger:** Commission approved by manager  
**Room:** `org:{organizationId}:crm` (private: rep + managers)  
**Payload:**
```json
{
  "commissionRecordId": "uuid",
  "approvedById": "uuid",
  "approvedAt": "2026-11-15T10:00:00.000Z"
}
```

### 7.3 `crm.commission.paid`
**Trigger:** Commission paid to rep  
**Room:** `org:{organizationId}:crm` (private: rep + finance)  
**Payload:**
```json
{
  "commissionRecordId": "uuid",
  "paidAt": "2026-11-30T00:00:00.000Z",
  "payrollRunId": "uuid|null"
}
```

---

## 8. Analytics & Premium Events

### 8.1 `crm.savedView.created`
**Trigger:** User saves a view  
**Room:** `org:{organizationId}:crm` (private: owner)  
**Payload:**
```json
{
  "viewId": "uuid",
  "entityType": "DEAL",
  "name": "My Won Deals",
  "isShared": false
}
```

### 8.2 `crm.customField.created`
**Trigger:** Custom field definition created  
**Room:** `org:{organizationId}:crm` (admin room)  
**Payload:**
```json
{
  "definitionId": "uuid",
  "entityType": "DEAL",
  "fieldKey": "competitor",
  "label": "Competitor Name",
  "fieldType": "SELECT"
}
```

### 8.3 `crm.workflow.triggered`
**Trigger:** Automation rule executed  
**Room:** `org:{organizationId}:crm` (admin room)  
**Payload:**
```json
{
  "executionId": "uuid",
  "ruleId": "uuid",
  "ruleName": "New Deal Alert",
  "trigger": "DEAL_CREATED",
  "matchedEntities": 1,
  "actionsExecuted": ["CREATE_TASK", "CREATE_NOTIFICATION"],
  "status": "SUCCESS"
}
```

### 8.4 `crm.import.started`
**Trigger:** Import job started  
**Room:** `org:{organizationId}:crm` (owner)  
**Payload:**
```json
{
  "importJobId": "uuid",
  "entityType": "CUSTOMER",
  "totalRows": 1000
}
```

### 8.5 `crm.import.completed`
**Trigger:** Import job finished  
**Room:** `org:{organizationId}:crm` (owner)  
**Payload:**
```json
{
  "importJobId": "uuid",
  "status": "COMPLETED",
  "totalRows": 1000,
  "validRows": 950,
  "invalidRows": 30,
  "duplicateRows": 20
}
```

---

## 9. Room & Subscription Model

### 9.1 Room Naming
| Room Pattern | Scope | Auto-Subscribe |
|---|---|---|
| `org:{orgId}:crm` | Organization-wide CRM events | Yes (on CRM page) |
| `org:{orgId}:crm:commissions` | Commission events | On commission page |
| `org:{orgId}:crm:admin` | Admin events (workflows, imports) | Admin users |

### 9.2 Subscription Flow
```typescript
// Client side (on CRM page mount)
socket.emit('subscribe', { room: `org:${orgId}:crm` });

// Server side (RealtimeGateway)
socket.on('subscribe', ({ room }) => {
  if (userCanAccessRoom(socket.user, room)) {
    socket.join(room);
  }
});
```

### 9.3 Authorization
```typescript
function userCanAccessRoom(user: User, room: string): boolean {
  if (room.startsWith('org:')) {
    const orgId = room.split(':')[1];
    return user.organizationId === orgId;
  }
  return false;
}
```

---

## 10. Event Delivery Guarantees

| Property | Guarantee |
|---|---|
| **Ordering** | Per-room FIFO (Socket.IO) |
| **Delivery** | At-least-once (client ACK required for critical) |
| **Persistence** | Events stored in DB (CRMActivity, AuditLog) |
| **Replay** | Client can request missed events on reconnect |
| **Filtering** | Server-side by room; no sensitive data in broadcast |

---

## 11. Integration with Phase 2 Events

| Phase 2 Event | CRM Integration |
|---|---|
| `channel.message.created` | Links to CRM via `SharedNote.linkedEntityType=DEAL` |
| `notification.created` | CRM creates notifications for task reminders, deal updates |
| `presence.user.online` | Shows rep availability in deal view |

---

## 12. Client Implementation Guide

### 12.1 Connection
```javascript
const socket = io('/crm', {
  auth: { token: accessToken }
});
```

### 12.2 Event Handlers
```javascript
socket.on('crm.deal.stage.changed', (event) => {
  // Update Kanban board optimistically
  updateDealPosition(event.payload.dealId, event.payload.toStage);
});

socket.on('crm.task.completed', (event) => {
  // Update task list
  markTaskComplete(event.payload.taskId);
});

socket.on('crm.notification', (event) => {
  // Show toast
  showNotification(event.payload.title, event.payload.body);
});
```

### 12.3 Reconnection
```javascript
socket.on('disconnect', () => {
  // Queue local changes
});

socket.on('connect', () => {
  // Request missed events since lastEventId
  socket.emit('crm.sync', { since: lastEventId });
});
```