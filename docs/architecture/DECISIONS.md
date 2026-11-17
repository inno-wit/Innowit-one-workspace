# Architecture Decision Records — Innowit One

Append-only. Format: `[YYYY-MM-DD] DECISION: ... | REASONING: ... | CONTEXT: ...`

---

## ADR-0001 — Desktop shell: Tauri 2 around existing Vite/React renderer (not Next.js rewrite)

**[2026-11-17] DECISION:** Implement a Tauri 2 desktop shell around the existing React 19 + Vite + Tailwind v4 renderer, with a separately deployable Node.js API service and PostgreSQL + Prisma as the authoritative data layer. Do **not** migrate the renderer to Next.js 15. | **REASONING:** The 02-TECHNICAL-REQUIREMENTS document prescribes Next.js 15 App Router / Docker, but the actual repository is a Vite/React SPA (verified: `vite build` passes, 1732 modules). Master prompt §4 directs Tauri 2 as the default unless a concrete blocker is proven, and forbids Next.js migration solely because the earlier web TRD named it. The existing renderer is valuable and must be preserved (§0.4). Next.js SSR/Server Actions have no equivalent in a Tauri WebView client. | **CONTEXT:** Discrepancy items #1, #2, #9, #11 in `docs/audit/SPEC_ANALYSIS.md`. The prescribed Prisma schema (05-BACKEND-SCHEMA) remains valid as the starting data model — it is stack-neutral. TanStack Query/Zustand recommendations carry over to the client; Server Actions are replaced by versioned REST endpoints on the Node API.

## ADR-0002 — Auth: token-based sessions for the desktop client, HTTP cookie/JWT hybrid on the API

**[2026-11-17] DECISION:** The desktop client authenticates against the Node API using short-lived access tokens with refresh/session rotation, stored in OS secure storage (Tauri stronghold/keyring), not localStorage. Server-side sessions remain revocable. Demo role switching is compiled out of production builds. | **REASONING:** TRD's HTTP-only cookie model targets a browser; Tauri WebView token handling in OS secure storage is the standard equivalent. Master prompt §6 requires session expiry/revocation and removal of seeded Super Admin as production identity. | **CONTEXT:** Discrepancy #5 in SPEC_ANALYSIS.md.

## ADR-0003 — Baseline environment fixes recorded

**[2026-11-17] DECISION:** `package.json` devDependency `esbuild` bumped `^0.25.0` → `^0.28.2` to resolve the ERESOLVE conflict with `vite@8.3.8` (peerOptional `esbuild ^0.27.0 || ^0.28.0`). No other dependency versions changed. | **REASONING:** Minimal fix for the peer range; avoids `--legacy-peer-deps` silently accepting a broken tree. Verified by successful install + `vite build`. | **CONTEXT:** Baseline install log 2026-11-17; `docs/audit/BASELINE.md`.

## ADR-0004 — `npm run lint` is a typecheck

**[2026-11-17] DECISION:** Treat `npm run lint` as `tsc --noEmit` (typecheck). A real ESLint pass will be added in Phase 1 tooling; until then, reports must label the command as typecheck. | **REASONING:** Master prompt §11 instructs renaming/flagging when the script name misleads. | **CONTEXT:** `package.json` scripts.

## ADR-0005 — Offline approach: local UI-preference cache only; never an authoritative offline ledger

**[2026-11-17] DECISION:** The desktop client operates online-first against the Node API. Local persistence is limited to (a) harmless UI preferences (sidebar state, column preferences, theme) and (b) an optional encrypted, clearly-labelled pending/offline queue for drafted records that replays through normal server-side validation and authorization on reconnect. No financial, tax, payroll, or stock-authoritative state ever lives client-side; conflict handling is server-adjudicated (server wins on authoritative state, client drafts require re-validation and explicit user confirmation on replay). localStorage is never a source of truth (live evidence: COA mutations lost on reload — `ev_afe9a375…`/`ev_5d8cb24e…`). | **REASONING:** Master prompt §4/§6 require multi-branch shared truth and forbid localStorage authority for financial/regulated data; a local-only desktop DB cannot serve multiple branches. An offline-first ledger would create two conflicting authoritative sources and an unacceptable audit/reconciliation burden for a regulated (eTIMS) system. | **CONTEXT:** D-004 live evidence; §6 tenancy invariants; Phase 1 gate "entities survive restart and a second client sees committed changes".

## ADR-0006 — Migration strategy: expand/contract Prisma migrations + one-shot localStorage import wizard

**[2026-11-17] DECISION:** (1) Schema evolution uses Prisma Migrate with expand/contract discipline: additive columns/tables first, backfill in versioned data migrations, destructive changes only after a full release cycle, every migration reversible-in-development and tested against a restored copy of production-shaped data. (2) Existing browser data is migrated via a one-shot import wizard in Phase 1: enumerate localStorage keys (currently `innowit_*` — 4 verified live), dry-run parse + validate against the Prisma schema, produce a mapping/conflict report and a timestamped JSON backup download, then import only after explicit user approval; server-side validation and authorization apply identically to imported records. Import is idempotent (keyed by content hash) and never auto-deletes source keys until import is verified. | **REASONING:** Master prompt §7 Phase 1 requires an explicit migration/import wizard with dry-run, mapping report and backup; §11 requires migration tests against existing seed state and localStorage fixtures. Expand/contract avoids downtime and allows rollback drills required by Phase 8. | **CONTEXT:** SPEC_ANALYSIS prescribed Prisma model; D-004; Phase 1 gate "schema migration and seed are repeatable and idempotent".
