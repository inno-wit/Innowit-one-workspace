# Implementation Status — Innowit One

Updated after every phase per master prompt §7. Last update: 2026-11-17 (Phase 0 in progress).
Branch: `work/innowit-one-build` (checkpoint tag `baseline-20261117`).

Status vocabulary (master prompt §0.5): **Verified working** / **Partially working** / **UI-demo only** / **Missing** / **Blocked-unverified**.

---

## Phase 0 — Evidence, triage and decisions (IN PROGRESS)

### Deliverable status

| Deliverable | Status | Location / Evidence |
|---|---|---|
| Baseline audit (install, lint, test, build) | **Verified working** | `docs/audit/BASELINE.md` — npm install PASS (after esbuild fix), typecheck PASS, 5 test gates PASS (in-memory only), vite build PASS (896.53 kB bundle) |
| Reproducible defect list | **Verified working** | `docs/audit/DEFECT_REGISTER.md` (D-001…D-017, P0/P1/P2) |
| Live app launch + navigation inspection | **Partially working** | `docs/audit/BASELINE.md §Live app inspection` — all 23 nav destinations clicked (47/47 steps OK); 5 high-risk views render with real content, zero console errors; **persistence round-trip complete: account created via real UI is lost on reload** (memory-only state, live evidence `ev_afe9a375…`/`ev_5d8cb24e…`). Narrow viewport still open |
| Spec requirements matrix | **Verified working** | `docs/audit/SPEC_ANALYSIS.md` — 7 aistudio spec docs consolidated; prescribed Prisma model; 11 architecture discrepancies; design tokens |
| REA inspection report (Innowit app) | **Verified working** | `docs/audit/REA_INNOWIT_INSPECTION.md` — live click-through, persistence round-trip, per-view spot checks, evidence IDs, REA tooling contract notes |
| QuickBooks feature benchmark | **In progress** | `docs/research/QUICKBOOKS_FEATURE_BENCHMARK.md` — research lane dispatched (public official sources only, no paid access per revised master prompt §3; evidence classes A–D) |
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

Phase 0 gate (orchestrator + agents agree on architecture, boundaries, acceptance criteria before large refactors): **not yet closed**. Remaining: finish live click-through, QuickBooks benchmark evidence, ADR completion (offline/migration), dependency & ownership map.

---

## Phase 1 — Desktop foundation, identity, data platform, design system — NOT STARTED

Planned scope (per master prompt): Tauri 2 host (Windows dev + release config, installable build); API service with health/readiness; PostgreSQL + Prisma schema/migrations + deterministic seeding; real auth/session lifecycle; server-enforced tenant/branch RBAC; replace localStorage authoritative stores with API-backed repositories (+ migration wizard with dry-run/backup); preserve and refine shell/sidebar/top bar/command palette/search/notifications/branch selector; design-system tokens from `docs/audit/SPEC_ANALYSIS.md` (teal `#00B3C8`, orange `#E8631A`, dark `#1A1A1A`, sidebar `#1E1B2E`, Inter / JetBrains Mono).

Closes defects: D-001, D-002, D-004, D-015, D-016 (fixed already).

Gate: packaged desktop build launches; real sign-in; expired/revoked session denied; unauthorized direct API calls denied; tenant/branch cross-access fails safely; core entities survive restart and are visible to a second client; migration + seed repeatable/idempotent.

---

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
