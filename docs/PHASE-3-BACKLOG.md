# PHASE 3 BACKLOG: INNOWIT ONE CRM & SALES PIPELINE

**Document Version:** 1.0.0  
**Date:** 2026-11-19  
**Status:** As-Built / Post-Release  

---

## 1. Completed (Phase 3 Waves 3.0-3.8)

| ID | Item | Wave | Status |
|---|---|---|---|
| CRM-001 | Database schema & migration | 3.1 | ✅ Done |
| CRM-002 | Customer & Contact CRUD API | 3.2 | ✅ Done |
| CRM-003 | Customer duplicate detection | 3.2 | ✅ Done |
| CRM-004 | Customer lifecycle (LEAD/ACTIVE/INACTIVE) | 3.2 | ✅ Done |
| CRM-005 | Primary contact enforcement | 3.2 | ✅ Done |
| CRM-006 | Deal CRUD + 6-stage pipeline | 3.3 | ✅ Done |
| CRM-007 | Deal stage transitions (drag-drop + buttons) | 3.3 | ✅ Done |
| CRM-008 | Mandatory Won/Lost outcome | 3.3 | ✅ Done |
| CRM-009 | Deal stage history audit trail | 3.3 | ✅ Done |
| CRM-010 | Optimistic locking on deals | 3.3 | ✅ Done |
| CRM-011 | Quotation generation from won deal | 3.3 | ✅ Done |
| CRM-012 | Task CRUD with cross-entity links | 3.4 | ✅ Done |
| CRM-013 | Task reminders & snooze | 3.4 | ✅ Done |
| CRM-014 | CRM Activity timeline | 3.4 | ✅ Done |
| CRM-015 | Sales Rep performance API | 3.5 | ✅ Done |
| CRM-016 | Quota management (CRUD + attainment) | 3.5 | ✅ Done |
| CRM-017 | Commission rules (FLAT/TIERED) | 3.5 | ✅ Done |
| CRM-018 | Commission calculation (idempotent) | 3.5 | ✅ Done |
| CRM-019 | Commission approval workflow | 3.5 | ✅ Done |
| CRM-020 | Dashboard metrics API | 3.6 | ✅ Done |
| CRM-021 | Pipeline analytics API | 3.6 | ✅ Done |
| CRM-022 | Rep performance analytics | 3.6 | ✅ Done |
| CRM-023 | Customer analytics API | 3.6 | ✅ Done |
| CRM-024 | Activity analytics API | 3.6 | ✅ Done |
| CRM-025 | Saved views (CRUD + default/shared) | 3.7 | ✅ Done |
| CRM-028 | Custom field definitions (6 types) | 3.7 | ✅ Done |
| CRM-029 | Custom field values (validation) | 3.7 | ✅ Done |
| CRM-030 | Import/Export (dry-run, idempotent) | 3.7 | ✅ Done |
| CRM-031 | Workflow automation (trigger/action) | 3.7 | ✅ Done |
| CRM-032 | Integration & regression testing | 3.8 | ✅ Done |
| CRM-033 | Documentation complete | 3.8 | ✅ Done |
| CRM-034 | Deal stage transitions (`/stage`, `/reopen`, `/stage-history`) | 3.3 | ✅ Done (Remediated) |
| FE-001 | Wire Customer Directory to `/api/customers` | R3 | ✅ Done (Remediated) |
| FE-002 | Wire Customer Detail Drawer to server | R3 | ✅ Done (Remediated) |
| FE-003 | Wire Deals Kanban to `/api/deals` | R3 | ✅ Done (Remediated) |
| FE-004 | Wire Deal Outcome Modal to API | R3 | ✅ Done (Remediated) |
| FE-005 | Wire Tasks Manager to `/api/tasks` | R3 | ✅ Done (Remediated) |
| FE-006 | Wire CRM Dashboard to server sync | R3 | ✅ Done (Remediated) |
| TD-001 | Replace localStorage CRM store with server sync | R3 | ✅ Done (Remediated) |

---

## 2. Deferred (Post-Phase 3 / Phase 4+)

### 2.1 Frontend UI Expansion (Priority: MEDIUM)

| ID | Item | Description | Dependencies |
|---|---|---|---|
| FE-007 | Wire Dedicated Sales Rep Performance View | Dedicated Quotas, commissions UI | CRM-015-019 |
| FE-008 | Saved Views UI | Save/load/delete views | CRM-025 |
| FE-009 | Custom Fields UI | Define fields, render in forms | CRM-028, CRM-029 |
| FE-010 | Import/Export UI | File upload, mapping, dry-run | CRM-030 |
| FE-011 | Workflow Builder UI | Visual rule builder | CRM-031 |

### 2.2 Real-time Integration (Priority: HIGH)

| ID | Item | Description | Dependencies |
|---|---|---|---|
| RT-001 | Connect CRM to Phase 2 RealtimeGateway | Socket.IO events for CRM | Phase 2 complete |
| RT-002 | Subscribe to `org:{orgId}:crm` room | Auto on CRM page load | RT-001 |
| RT-003 | Handle `crm.deal.stage.changed` | Update Kanban optimistically | RT-002 |
| RT-004 | Handle `crm.task.completed` | Update task lists | RT-002 |
| RT-005 | Handle `crm.notification` | Toast notifications | RT-002 |
| RT-006 | Reconnection sync | Request missed events | RT-002 |

### 2.3 Advanced CRM Features (Priority: MEDIUM)

| ID | Item | Description | Phase |
|---|---|---|---|
| ADV-001 | Lead scoring algorithm | ML-based or rule-based | Phase 4 |
| ADV-002 | Email integration (send/receive) | Track emails in timeline | Phase 4 |
| ADV-003 | Calendar integration | Sync meetings/tasks | Phase 4 |
| ADV-004 | Document attachment on deals | Link files to deals | Phase 4 |
| ADV-005 | Territory management | Geographic assignment | Phase 4 |
| ADV-006 | Forecast categories | Best case / commit / pipeline | Phase 4 |
| ADV-007 | Deal aging alerts | Auto-create overdue tasks | Phase 4 |
| ADV-008 | Competitor tracking | On deals lost | Phase 4 |
| ADV-009 | Quote templates | Reusable quotation templates | Phase 4 |
| ADV-010 | Approval workflows on deals | Multi-level approval | Phase 4 |

### 2.4 Mobile/Desktop (Priority: MEDIUM)

| ID | Item | Description | Phase |
|---|---|---|---|
| MOB-001 | Responsive CRM layout | Mobile-first responsive | Phase 4 |
| MOB-002 | Tauri mobile build | iOS/Android app | Phase 5 |
| MOB-003 | Offline-first CRM | Cache + sync on reconnect | Phase 5 |
| MOB-004 | Push notifications | Native push for tasks/deals | Phase 5 |

### 2.5 Advanced Analytics (Priority: LOW)

| ID | Item | Description | Phase |
|---|---|---|---|
| ANL-001 | Cohort analysis | Customer retention by cohort | Phase 5 |
| ANL-002 | Churn prediction | ML-based churn scoring | Phase 6 |
| ANL-003 | Revenue forecasting | Time-series forecasting | Phase 5 |
| ANL-004 | Custom report builder | Drag-drop report designer | Phase 5 |
| ANL-005 | Embedded BI | Metabase/Apache Superset | Phase 6 |

---

## 3. Technical Debt & Refactoring

| ID | Item | Description | Priority |
|---|---|---|---|
| TD-001 | Replace localStorage CRM store with server sync | Complete (server sync + fallback) | ✅ RESOLVED |
| TD-002 | Add database indexes for custom field queries | Performance | MEDIUM |
| TD-003 | Add pagination cursor for large datasets | Offset pagination has limits | MEDIUM |
| TD-004 | Implement cache invalidation for analytics | Currently no cache | MEDIUM |
| TD-005 | Add request/response logging middleware | Observability | LOW |
| TD-006 | Add OpenAPI/Swagger documentation | Auto-generated from Zod | LOW |
| TD-007 | Add E2E tests (Playwright) | Critical user flows | HIGH |

---

## 4. Blocked Items

| ID | Item | Blocker | Resolution |
|---|---|---|---|
| BLK-001 | Desktop multi-client QA | Tauri multi-window not verified | Separate QA cycle |
| BLK-002 | Huddles/SFU media | BACK-26: No SFU provisioned | Separate infrastructure |
| BLK-003 | eTIMS production cert | No paid KRA access | Sandbox only |
| BLK-004 | Email provider integration | No provider configured | Phase 4 |
| BLK-005 | Calendar provider integration | No provider configured | Phase 4 |

---

## 5. Known Limitations (Documented)

| Limitation | Impact | Mitigation |
|---|---|---|
| No email sending | Can't send actual emails from CRM | Use "Email Logged" activity type |
| No calendar sync | Meetings not synced to external | Manual entry |
| No mobile app | Desktop only | Tauri build exists but not tested on mobile |
| Commission not in payroll | Manual transfer needed | Documented process |
| No custom report builder | Pre-defined analytics only | Planned Phase 5 |
| Single currency per deal | No multi-currency deals | Use separate deals per currency |
| No territory management | Geographic assignment manual | Planned Phase 4 |

---

## 6. Phase 4 Readiness Checklist

| Area | Ready | Notes |
|---|---|---|
| Backend API | ✅ | All endpoints implemented & tested |
| Database Schema | ✅ | Migration applied, additive only |
| Authentication | ✅ | Uses existing JWT + tenant |
| Authorization | ✅ | RBAC + tenant isolation |
| Real-time | ⏳ | Needs frontend subscription |
| Frontend | ⏳ | Currently localStorage only |
| Mobile | ⏳ | Tauri config exists |
| Documentation | ✅ | Complete |
| Migration path | ✅ | Additive migration |

---

## 7. Phase 3 Sign-off

**All committed items: DONE**  
**Deferred items: Documented in backlog**  
**Blockers: Documented & tracked separately**  
**Technical debt: Prioritized for Phase 4**

**Phase 3 CRM & Sales Pipeline: COMPLETE** ✅