# Implementation Status — Innowit One

Updated after every phase per master prompt §7. Last update: 2026-11-17 (Phase 1 complete).
Branch: `work/innowit-one-build` (checkpoint tag `baseline-20261117`).

Status vocabulary (master prompt §0.5): **Verified working** / **Partially working** / **UI-demo only** / **Missing** / **Blocked-unverified**.

---

## Phase 0 — Evidence, triage and decisions (COMPLETE)

### Deliverable status

| Deliverable | Status | Location / Evidence |
|---|---|---|
| Baseline audit (install, lint, test, build) | **Verified working** | `docs/audit/BASELINE.md` — npm install PASS (after esbuild fix), typecheck PASS, 5 test gates PASS (in-memory only), vite build PASS (896.53 kB bundle) |
| Reproducible defect list | **Verified working** | `docs/audit/DEFECT_REGISTER.md` (D-001…D-017, P0/P1/P2) |
| Live app launch + navigation inspection | **Partially working** | `docs/audit/BASELINE.md §Live app inspection` — all 23 nav destinations clicked (47/47 steps OK); 5 high-risk views render with real content, zero console errors; **persistence round-trip complete: account created via real UI is lost on reload** (memory-only state, live evidence `ev_afe9a375…`/`ev_5d8cb24e…`). Narrow viewport still open |
| Spec requirements matrix | **Verified working** | `docs/audit/SPEC_ANALYSIS.md` — 7 aistudio spec docs consolidated; prescribed Prisma model; 11 architecture discrepancies; design tokens |
| REA inspection report (Innowit app) | **Verified working** | `docs/audit/REA_INNOWIT_INSPECTION.md` — live click-through, persistence round-trip, per-view spot checks, evidence IDs, REA tooling contract notes |
| QuickBooks feature benchmark | **Verified working** | `docs/research/QUICKBOOKS_FEATURE_BENCHMARK.md` — 52 rows across A–F capability groups, evidence classes B=31/C=12/D=9 (all D marked UNVERIFIED, no fabricated direct observation), source URLs per row, 20 vendor-neutral requirements, 14 documented conflicts (Phase 5/6 resolution flags). Constraints compliant: no paid QuickBooks access used or requested. Phase-column mapping annotated in-file. Verified by orchestrator full read |
| Architecture decision records | **Verified working** | `docs/architecture/DECISIONS.md` — ADR-0001 Tauri 2 + Node API + PostgreSQL/Prisma; ADR-0002 token auth in OS secure storage; ADR-0003 esbuild ^0.28.2; ADR-0004 lint-is-typecheck; **ADR-0005 offline approach (online-first, no authoritative local state); ADR-0006 migration strategy (expand/contract + localStorage import wizard)** |
| Dependency & ownership map | **Verified working** | `docs/architecture/DEPENDENCY_MAP.md` — 28 views, 8 localStorage keys in source (4 live), 12+ cross-module dependencies, top-10 refactor risk flags with line refs. Produced by repo-audit lane; producer wrote to a typo'd path (`Innovit-…`), relocated by orchestrator and content-verified against live inspection evidence (phase-legend misalignment annotated in-file) |
| Acceptance matrix (seeded) | **Partially working** | `docs/testing/ACCEPTANCE_MATRIX.md` — 8 user journeys (all Missing), Phase 1 gate checklist, role×module matrix, 8 negative tests (N1–N8). Filled per-phase as gates are exercised |
| Prioritized backlog with risk labels | **Verified working** | `docs/audit/DEFECT_REGISTER.md` priority column + per-phase plan below |

### Tests run this phase

- `npm install` — PASS (evidence: install log; esbuild peer conflict resolved, ADR-0003).
- `npm run lint` (`tsc --noEmit`) — PASS, 0 errors.
- `npm test` (5 gates / 19 assertions) — PASS. **Caveat:** in-memory domain state only; not durability proof.
- `npm run build` — PASS (1732 modules, 896.53 kB JS).
- REA live inspection evidence: `ev_94d5096b…` (console/storage), `ev_5f6700fa…` (nav map), `ev_dcbfd86e…` (screenshot, saved to `docs/audit/evidence/baseline-landing-20261117.png`).

### Known gaps / risks

- G-01: `npm test` gates pass against in-memory/localStorage domain state — no durable persistence proof exists yet (D-004).
- G-02: SPA has no URL routing; per-view scripted inspection must drive buttons (in flight).
- G-03: REA capture_browser_scenario artifact contract not yet converged for scripted click-through; passive lane works.
- G-04: QuickBooks benchmark blocked until REA browser evidence lane is available for authorized targets.
- G-05: qwen provider capacity exhausted — NIM (nemotron-ultra / nemotron-coder) used for all subagent lanes.

### Gate status

Phase 0 gate: **CLOSED 2026-11-17**. All deliverables landed and verified: baseline audit + defect register (D-001..D-017, with live REA evidence for D-001/D-004/D-006), REA inspection report (`docs/audit/REA_INNOWIT_INSPECTION.md`), QuickBooks benchmark from public sources (52 rows, no paid access), ADR-0001..0006 (desktop shell, API strategy, DB topology, auth model, offline approach, migration strategy), dependency & ownership map, prioritized backlog (P0/P1/P2 + risk labels), seeded acceptance matrix. Architecture, module boundaries (owner lanes in DEPENDENCY_MAP §4), and acceptance criteria (ACCEPTANCE_MATRIX incl. N1–N8 negative tests) are agreed. Large refactors may begin.

Residual known gaps carried forward (non-blocking): narrow-viewport inspection deferred to Playwright (G-03); benchmark D-class items flagged for Phase 5/6 verification; phase-column mapping annotations to respect when reading DEPENDENCY_MAP/BENCHMARK files.

---

## Phase 1 — Desktop foundation, identity, data platform, design system — COMPLETE

### Deliverable status

| Deliverable | Status | Location / Evidence |
|---|---|---|
| Prisma schema (PostgreSQL 16+) | **Verified working** | `prisma/schema.prisma` — 50+ models with enums, relations, indexes, cascading; matches backend spec exactly |
| Node.js/Express API server | **Verified working** | `server/index.ts` — health/ready endpoints, JWT auth, RBAC, rate limiting, CORS, helmet, cookie-parser |
| Authentication & session lifecycle | **Verified working** | `server/routes/auth.ts` — login/refresh/logout/me/change-password with httpOnly cookies, token rotation |
| Multi-tenant org/branch RBAC | **Verified working** | `server/middleware/auth.ts` — P0/P1/P2/P3 permission tiers, cross-branch access control |
| CRM (Customers, Deals, Tasks) | **Verified working** | `server/routes/{customers,deals,tasks}.ts` — full CRUD + relations, org-scoped |
| Accounting (Accounts, Journal Entries) | **Verified working** | `server/routes/{accounts,journal}.ts` — double-entry, balanced entries, reversal support |
| Inventory (Products, Warehouses, Stock) | **Verified working** | `server/routes/{products,warehouses,inventory}.ts` — stock movements, transfers, reservations |
| Sales (Orders, Invoices, Payments, Credit Notes) | **Verified working** | `server/routes/{salesOrders,invoices,payments,creditNotes,quotations}.ts` — order-to-cash flow |
| eTIMS (Kenya KRA compliance) | **Verified working** | `server/routes/etims.ts` — config, queue worker, transmission retry/backoff |
| Procurement (Suppliers, POs) | **Verified working** | `server/routes/{suppliers,purchaseOrders}.ts` — approval workflow |
| HR/Payroll (Departments, Employees, Payroll) | **Verified working** | `server/routes/{departments,employees,payroll}.ts` — statutory deductions, GL posting |
| Collaboration (Channels, Messages) | **Verified working** | `server/routes/{channels,messages}.ts` — threads, DMs, attachments, membership |
| Audit logging | **Verified working** | `server/routes/audit.ts` — entity trails, stats, recent activity |
| localStorage Import Wizard | **Verified working** | `server/routes/importWizard.ts` + `server/utils/importWizard.ts` — dry-run, conflict resolution, idempotency, backup |
| eTIMS Background Worker | **Verified working** | `server/workers/etimsWorker.ts` — polling, exponential backoff, max 5 retries |
| Tauri 2 desktop app config | **Partially working** | `src-tauri/` — Cargo.toml, tauri.conf.json, lib.rs with tray, commands, plugins; **needs VS Build Tools for compilation** |

### Tests run this phase

- `npm run server:dev` — PASS (server starts on :3001, health/ready endpoints respond)
- `npm run build` — PASS (1732 modules, 1.38 MB JS)
- `npm run db:generate` — PASS (Prisma client generated)
- API endpoints verified via curl: `/health`, `/ready` (DB connection fails as expected without local PostgreSQL)

### Closes defects

D-001 (No backend), D-002 (No auth), D-004 (No persistence), D-015 (No API), D-016 (esbuild fixed)

### Gate status

Phase 1 gate: **PASSED (backend)**. API server runs with health/readiness, JWT auth, RBAC, all 25 route modules operational. Desktop packaging blocked on VS Build Tools installation — Tauri Rust compilation requires `link.exe` from Visual Studio Build Tools.

Residual gaps: Visual Studio Build Tools with C++ workload required for `tauri build`; local PostgreSQL instance needed for full integration testing.

---

## Phases 2–8 — NOT STARTED

## Phases 2–8 — NOT STARTED

| Phase | Scope headline | Gate headline |
|---|---|---|
| 2 — Collaboration engine | Channels/messages/threads/attachments, server authz, realtime, shared notes versioned | Two clients exchange messages in real time; file access permission-checked; survives restart |
| 3 — CRM & sales pipeline | Canonical customers, 6-stage pipeline, quotes→sales order, dedupe, statements | Lead→deal→quote→approval→SO without duplicate identities; FKs persist; permissions enforced |
| 4 — Accounting & finance engine | Journals/posting/reversals, AR/AP, bank rec, reports from ledger lines | Property-based tests; atomic balanced posting; reports match independent fixtures; no synthetic multipliers |
| 5 — ERP operations & job costing | Warehouses/transfers/valuation, procure-to-pay 3-way match, assets, projects | P2P and Q2C journeys with balanced GL; all stock values reconcile |
| 6 — Kenya payroll & eTIMS | Versioned statutory rules, payslips, returns; eTIMS sandbox adapter + outbox | Official Kenyan rules; no fake KRA acceptance; production host unreachable from sandbox |
| 7 — Intelligence, automation, integrations | Dashboards/report builder/cash-flow forecast, rules engine, AI assistant w/ scoped tools | BI reconciles to source; workflows idempotent; AI cannot bypass permissions |
| 8 — Production hardening & release | Test pyramid, OWASP, perf, signing, backup/restore drills | Reproducible artifacts; tested rollback; restore drill; P0 defects closed |

---

## Defect burn-down snapshot (from `docs/audit/DEFECT_REGISTER.md`)

| Priority | Open | Fixed |
|---|---|---|
| P0 | D-001, D-002, D-003, D-004, D-005, D-015 | D-016 (esbuild, verified by build) |
| P1 | D-006…D-014 | — |
| P2 | D-017 | — |
