# Innowit One Workspace — Baseline Audit

Date: 2026-11-17 · Branch: `work/innowit-one-build` (checkpoint tag `baseline-20261117` from `main`)

## Environment

- Windows x64, Node/npm verified via install run.
- Repo: `C:\Users\thee-keem\Projects\Innowit-one-workspace`, remote `origin/main`.
- Initial state: `main` clean except untracked `package-lock.json` (regenerated during install, see below).

## Baseline commands (captured 2026-11-17)

| Command | Result | Notes |
|---|---|---|
| `npm install --no-audit --no-fund` | **PASS** (after 1 fix) | First attempt failed with `ERESOLVE`: `vite@8.3.8` requires peerOptional `esbuild@^0.27.0 \|\| ^0.28.0` but `package.json` pinned `esbuild@^0.25.0`. **Fix applied:** bumped devDependency `esbuild` to `^0.28.2`. Second install succeeded (removed 7 packages, changed 2). npm warned 3 install scripts not in allowScripts (`@google/genai`, `protobufjs`, `esbuild`) — esbuild platform binary resolves via optionalDependencies; build run confirms it works. |
| `npm run lint` (actually `tsc --noEmit`) | **PASS** | Zero type errors. Note: script name `lint` is misleading — it is a typecheck (master prompt §11 asks to flag this). |
| `npm test` (`tsx src/tests/runner.ts`) | **PASS** | 5 gates, 19 assertions, all passed, 2078 ms. Gate details below. |
| `npm run build` (`vite build`) | **PASS** | 1732 modules transformed; `dist/assets/index-ruYufjmP.js` = **896.53 kB** (gzip 206 kB) — large single bundle, code-splitting candidate. |

## Test gate results (from `npm test`)

All 5 mandatory acceptance gates passed:

1. **Accounting Core & GL Integrity** — double-entry balance, unbalanced-entry rejection guard, reversing lineage, trial balance equality (13,300,000 == 13,300,000 across 11 accounts).
2. **Inventory Ledger & Multi-Warehouse** — non-negative stock, immutable movement types, 3 warehouses (WH-NBO-01, WH-MSA-02, WH-KSM-03) reconcile to catalog.
3. **Order-to-Cash Continuity** — KRA PIN format, invoice→customer FK continuity, AR balance math, PO line/VAT aggregation.
4. **eTIMS Compliance & Air-Gap Sandbox** — idempotency keys, credit-note lineage, production network lock, dual-step production activation guard.
5. **RBAC Enforcement** — 12-role matrix, least-privilege boundaries, 12 demo persona accounts.

**Critical caveat (per master prompt §0.5):** these gates run against in-memory/domain-layer state via `tsx` inside the renderer's own data model. Passing does **not** prove durable persistence, server-side authorization, or real KRA integration. They are domain-invariant tests only. Status of persistence: *Missing/partial* until Phase 1 API+PostgreSQL layer exists.

## Known defects / flags from baseline (to confirm against source in defect register)

- No Tauri/Electron host, no Prisma/DB driver, no browser E2E framework in `package.json` (matches master prompt's snapshot; will re-verify from full inventory).
- `esbuild` peer conflict fixed in this baseline (recorded above).
- Single 896 kB JS bundle — no route-level code splitting.
- `npm run lint` is a typecheck, not a linter.

## Live app inspection (evidence-led, 2026-11-17) — Partially working

Method: Vite dev server + Chrome with dedicated temp profile via CDP (`--remote-debugging-port=9222`); observation via REA passive inspection (`list_browser_targets`, `inspect_web_page`, `capture_web_screenshot`). Evidence IDs and screenshots below.

- **Target:** `http://localhost:3002/` (port 3000/3001 were occupied by earlier vite instances). Title: "Innowit One Workspace". Viewport 1424×805.
- **Landing view:** Chart of Accounts (Accounting & Finance group) with category filter buttons ALL/ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE, Export CSV, Add New Account. Sidebar identity banner: **"KM Kimani SUPER ADMIN"** (auto-seeded Super Admin — confirms D-001) and an **"ETIMS SANDBOX TEST"** badge (sandbox mode visible in UI).
- **Console at load:** clean — only `[vite] connecting.../connected.` and the React DevTools info notice. No errors or warnings at initial render. (Observation window covers attach-onward only; prior-load activity unavailable.)
- **Persistence fingerprint (localStorage, origin `http://localhost:3002`):** 4 keys seeded on first run — `innowit_automation_rules_v1`, `innowit_system_notifications_v1`, `innowit_automation_logs_v1`, `innowit_audit_logs_v1`; IndexedDB and CacheStorage: none; sessionStorage: none. **Confirms D-004:** business/automation/audit state lives in localStorage, not a server database. Values redacted by the collector; fingerprints captured (SHA-256 of key and value identities, complete).
- **Navigation map (live accessibility tree, 22 destinations across 6 groups):**
  - COLLABORATION: Channels & Chat · Notes & Living Docs · Workspace Files & Vault
  - CRM & SALES: CRM Dashboard · Customers · Deals Pipeline · Tasks & Activities
  - ACCOUNTING & FINANCE: Chart of Accounts · Journal Entries · Sales Invoices · Financial Reports
  - ERP OPERATIONS: Inventory & Stock · Purchase Orders · HR & Payroll
  - TAX COMPLIANCE: eTIMS Setup · Submission Queue · Credit Notes · 3-Way Reconciliation
  - BUSINESS INTELLIGENCE & AUTOMATIONS: Executive BI Dashboard · Workflow Automations
  - SYSTEM GOVERNANCE & AUDIT: System Audit Trail · 12-Role RBAC Matrix · Acceptance & Hardening
  - Plus: global search ("Search accounts, invoices, deals... Ctrl+K"), branch switcher ("Branch: HQ - Nairobi Branch (00)"), sidebar collapse.
- **Screenshot:** `docs/audit/evidence/baseline-landing-20261117.png` (173,129 bytes, SHA-256 `b17ae91d720b111948f5b849f04eece7b3539b74e2ace520b8d7bead26e82017`, captured 2026-11-17T15:38:58Z).
- **Evidence IDs (REA):** targets `ev_17bd7acc…`, page/console/storage `ev_94d5096b…`, accessibility/nav `ev_5f6700fa…`, screenshot `ev_dcbfd86e…`.
- **Full click-through (verified):** scripted scenario `ev_811899f7…` clicked all **23** sidebar destinations (3 COLLABORATION + 4 CRM + 4 ACCOUNTING + 3 ERP + 4 TAX + 2 BI + 3 GOVERNANCE) — 47/47 steps completed, zero step failures. Spot-checked renders with clean console (no errors/warnings on any): HR & Payroll → "Human Resources & Statutory Kenyan Payroll" (November 2026 payroll run labelled `APPROVED / UNPOSTED TO GL`); eTIMS Setup → "Kenya eTIMS Tax Compliance Engine (OSCU / VSCU)" (4 config sections); Submission Queue → same eTIMS engine view (queue is a sub-view, not a separate page); Executive BI Dashboard → "Executive Business Intelligence" (sections: Monthly Financial Performance, Debtors Aging, Top-Selling Products, Commercial Sales Team Leaderboard — visible hardcoded-KPI surface, D-006); Financial Reports → "GAAP Financial Statements & Audit Reports"; Acceptance & Hardening → "Production Hardening & Acceptance Verification". Per-view evidence: `ev_966ba16b…`, `ev_231d1319…`, `ev_97af3ddc…`, `ev_5d5490b3…`, `ev_67fef6c1…`.
- **Persistence round-trip (verified — data-loss defect confirmed):** full UI mutation flow scripted via `ev_afe9a375…` — navigated to Chart of Accounts, opened "Add New Account" modal, filled all 6 fields (code 1030, ASSET, title "Audit Test Account 2026-11-17", opening balance 250,000 KES, description), selected account type, clicked "Save Account to Ledger" (13/13 steps completed). Account rendered in the table immediately (evidence `ev_181fd62e…`). localStorage after save still held only the same 4 keys — chart-of-accounts state is **not written to localStorage** (only the audit-log value hash changed). Page reload (`ev_5d8cb24e…`): **"Audit Test Account 2026-11-17" is gone**. Conclusion: Chart of Accounts mutations are memory-only — data loss on every reload, worse than the localStorage defect anticipated for this entity (D-004 upgraded with live evidence). Note: scenario runs navigate to `start_url` and thereby reload the SPA — modal/UI state does not survive between scenario calls.
- **Still open for §1:** narrow-viewport (mobile) render inspection, and deeper in-view interaction (create/edit flows) — these continue into Phase 0 closeout.

**Label: Partially working** — app launches, renders, and is navigable; no console errors at load; durability and per-view behavior still unproven.

## Pending (in flight)

- QuickBooks benchmark from public official sources (research lane in progress; no paid access per revised master prompt §3).
- Dependency & ownership map (repo audit lane in progress → `docs/architecture/DEPENDENCY_MAP.md`).
- Narrow-viewport (mobile) render inspection — deferred to Playwright (REA scenario browser has no viewport option).
