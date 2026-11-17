# System Overview — Innowit One

C4-style architecture and trust boundaries. Target state per ADR-0001..0006. Status labels follow master prompt §0.6. Written 2026-11-17 (Phase 0); updated per phase.

---

## 1. Context (C1) — what the system is

Innowit One is a **Windows-first desktop Business OS** for Kenyan SMEs: a Tauri 2 desktop client (existing React 19 + Vite + Tailwind v4 renderer preserved) talking to a **separately deployable Node.js API service** backed by **PostgreSQL (Prisma)**. Six connected modules — Collaboration, CRM & Sales, Accounting, ERP Operations, Kenya eTIMS, Intelligence & Automation — share identity, organization/branch context, permissions, master data, audit, and transactional services.

External systems:
- **KRA eTIMS** (OSCU/VSCU) — sandbox first; production transmit dual-controlled and disabled by default (Phase 6).
- **M-Pesa / banks** — payment reconciliation via authorized provider integrations; manual statement import as reliable fallback (Phase 6+).
- **OS** — Tauri native bridge: secure storage (tokens), file pickers, print/PDF, notifications, menus.

Current reality (baseline): the renderer exists and renders all 22+ destinations; **no API, no DB, no auth** — business state is React state (memory-only for accounting/invoicing/products; localStorage for logs/notifications/automation/CRM/ERP stores). Label: **Partially working** shell over **Missing** backend.

## 2. Containers (C2) — target architecture

| Container | Tech | Responsibility | Status |
|---|---|---|---|
| Desktop client | Tauri 2 + existing React/Vite renderer | UI, command palette, local UI preferences only; never authoritative state | Renderer **Partially working**; Tauri host **Missing** |
| Node API service | Node.js, versioned REST (+ realtime transport where needed) | AuthN/AuthZ, tenant/branch scoping, domain services, validation, audit, outbox, structured logs | **Missing** |
| PostgreSQL | Prisma migrations | Authoritative data; decimal-safe money; expand/contract migrations (ADR-0006) | **Missing** |
| Background worker | Scheduler + outbox processor | eTIMS retries, reminders, automation, reconciliation, reports | **Missing** |
| Desktop local cache | Encrypted, labelled pending/offline queue + UI prefs | Draft replay through server validation; never financial authority (ADR-0005) | **Missing** |

Trust boundaries:
1. **Renderer ↔ API:** every request authenticated (short-lived token from OS secure storage, ADR-0002); renderer holds zero secrets; `VITE_*` never carries privileged credentials.
2. **API ↔ DB:** single connection plane; row-level tenant/branch scoping enforced in services (and defense-in-depth at queries). Client cannot reach DB.
3. **API ↔ KRA:** backend-only adapter, allowlisted hosts, environment-specific credentials, certificates server-side. Renderer never sends KRA requests. Sandbox/production isolation is a server-side control (§6) — client flags are not security.
4. **Worker ↔ DB/outbox:** transactional outbox with idempotency keys; bounded retry/backoff; dead-letter handling.
5. **Desktop ↔ OS:** minimal Tauri capabilities, strict CSP, validated IPC, no arbitrary shell from renderer.

## 3. Components (C3) — API domain services

| Service | Owns | Key invariants | Phase |
|---|---|---|---|
| Identity & sessions | users, sessions, invitations, password reset | No seeded Super Admin in production; revocable sessions | 1 |
| Authorization | roles, permissions, record/field scope | Server-enforced at endpoint+service; UI hiding is usability only | 1 |
| Tenant/branch context | organizations, branches, scoping policy | Every record carries org scope; branch-scoped or explicit all-branches | 1 |
| Accounting engine | COA, journals, posting, AR/AP, banks, reports | Balanced posting in single DB transaction; posted entries immutable; ledger is report source of truth; no synthetic multipliers | 4 |
| CRM & sales | leads, customers, contacts, deals, quotes→SO | Canonical identities shared cross-module; closed-won ≠ cash | 3 |
| Inventory & procurement | stock ledger, valuation, P2P, fulfilment | Append-only movements; totals reconcile; no silent negative stock; 3-way match | 5 |
| Payroll & HR | employees, rules (effective-dated), runs, payslips | Versioned statutory rules with sources; runs reconcile to GL; no legal-compliance claim until verified | 6 |
| eTIMS adapter | device config, outbox, submissions, reconciliation | State machine PENDING→IN_FLIGHT→ACCEPTED/REJECTED/RETRY_SCHEDULED/FAILED; never fabricate acks; production disabled by default | 6 |
| Collaboration | channels, messages, notes, files | Server authz; signed file URLs; realtime | 2 |
| Intelligence & automation | dashboards, report builder, rules, forecasts | BI reconciles to source queries; idempotent scheduled runs; AI scoped, no unrestricted SQL | 7 |
| Audit | append-only event log | Server-generated, tamper-resistant, covers auth/data/approvals/exports/integrations | 1+ |
| Backup/restore | encrypted backups, point-in-time restore | Restore preview + approval + immutable audit | 8 |

Domain services own all accounting/tax/inventory rules. **UI components must not contain authoritative business rules.**

## 4. Data ownership map (points to DEPENDENCY_MAP.md)

Canonical entities and their owning service follow `docs/architecture/DEPENDENCY_MAP.md` §4 owner lanes, remapped to master prompt phases (correction note in that file). Canonical cross-module identities: Customer, Product/SKU, Supplier, Account, Employee, Branch, Organization. Every cross-module reference is a foreign key to the canonical record — no per-module copies (the current `customers` sync-overwrite risk, dependency map §2 flag 7, is the anti-pattern being removed).

## 5. Migration of existing client state (ADR-0006)

Source keys verified live: `innowit_automation_rules_v1`, `innowit_system_notifications_v1`, `innowit_automation_logs_v1`, `innowit_audit_logs_v1`; code-can-write keys also seen in source (`innowit_erp_state_v1`, `innowit_crm_state_v1`). Accounting/invoicing/products are memory-only (proven). The Phase 1 import wizard: dry-run parse → schema validation → mapping/conflict report → timestamped backup → explicit approval → idempotent import keyed by content hash. localStorage never authoritative afterward.

## 6. Deployment & environments

- **Development:** `tauri dev` + local Node API + local PostgreSQL; eTIMS `DEMO SIMULATION` only, clearly labelled.
- **Sandbox:** real KRA sandbox host via adapter; credentials server-side; identical code path as production minus host/credentials.
- **Production:** signed installer (Phase 8), API deployable, PostgreSQL backups encrypted, restore drill. Signed update channel only when release infra ready; no unsigned auto-update.

## 7. Current defect pressure (from DEFECT_REGISTER.md)

P0 open: D-001 (seeded Super Admin), D-002 (client-only RBAC), D-003 (simulated eTIMS acceptance), D-004 (durable persistence — live-proven memory-only), D-005 (GL posting outside transactions), D-015. Phase 1 closes D-001/002/004/015(+016 fixed); Phase 4 closes D-005; Phase 6 closes D-003.
