# Agent Control Plane — Project Reference

## Overview

Full-stack pnpm monorepo implementing Phases 1–4 + Security Audit of an AI Agent Deployment System. Provides a tenant-aware registry, policy enforcement (4-outcome default-deny engine), approval gating with self-approval prevention, action ledger evidence trail, and audit — all exposed via a RESTful API with a React control-plane UI. The first productization pass adds an agent-oriented dashboard: reusable agent templates, structured version manifests, guided client deployment, config snapshot resolution, approval continuation so approved deployment actions actually execute, and a Docker-first local runtime adapter that records provisioned runtime health/evidence on deployments. Phase 4 adds production hardening: Zod validation on all mutations, rate limiting, enhanced healthz, React error boundary, toast feedback, and seed data. Security audit (post-Phase 4) resolved all dependency CVEs and added CORS restriction and actor privilege-escalation protection.

## Architecture

```
artifacts/
  api-server/       — Express 5 REST API (port 8080, /api prefix)
  control-plane/    — React + Vite admin UI (port 24565, / prefix)
lib/
  db/               — Drizzle ORM schema + migrations (11 tables)
  api-spec/         — OpenAPI spec + Orval codegen config
  api-client-react/ — Generated React Query hooks (from codegen)
  api-zod/          — Generated Zod validators (from codegen)
scripts/
  src/seed-phase3.ts — Seeds policy_decisions + action_ledger for demo tenant
```

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24
- **TypeScript**: 5.9
- **API**: Express 5 + Pino logging + express-rate-limit
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (v4) — centralised in `api-server/src/lib/validation.ts`
- **API codegen**: Orval v8 from OpenAPI 3.1 spec
- **Frontend**: React + Vite + TanStack Query + shadcn/ui + Tailwind v4 + wouter
- **Testing**: Vitest + supertest (api-server only)

## Database Tables (11)

| Table | ID Prefix | Purpose |
|-------|-----------|---------|
| tenants | `ten_` | Root org unit |
| workspaces | `wrk_` | Tenant subdivision |
| environments | `env_` | dev/staging/prod per workspace |
| packages | `pkg_` | Agent package registry |
| package_versions | `pkgv_` | Immutable versioned manifests |
| deployments | `dep_` | Package version → environment mapping |
| config_snapshots | `cfg_` | Resolved config at deploy time |
| audit_events | `aud_` | Immutable audit trail |
| action_ledger | `act_` | Action evidence trail (Phase 3) |
| approval_requests | `apr_` | Approval workflow records |
| policy_decisions | `pdec_` | Persisted policy evaluation records (Phase 3) |

## Key Architecture Invariants

1. **Tenant isolation**: Every resource carries `tenantId`; all queries filter by it. Cross-tenant reads return 404.
2. **Default-deny policy**: `evaluatePolicy()` in `lib/policy.ts` is the ONLY place policy decisions are made. Phase 3 rules: system → allow; user + deployment:create → require_approval; agent + deployment:create → deny; user + deployment:status_update → require_approval; agent + deployment:status_update → deny; unmatched → deny.
3. **Policy decision persistence**: Every `evaluatePolicy()` call on a protected mutation stores a `pdec_` row via `storePolicyDecision()`. Every interactive `POST /policy/evaluate` call also stores a `pdec_` row.
4. **Protected mutations evaluate policy first**: Both `POST /environments/:envId/deployments` and `PATCH /deployments/:id` (when status changes) read `X-Actor-Id`/`X-Actor-Type` headers, evaluate policy, write `pdec_` + `act_`, then branch: allow → proceed, deny → 403, require_approval → 202 + creates `apr_`. Metadata-only PATCH updates bypass the gate.
5. **Action ledger lifecycle**: `act_` entries progress through: attempted → blocked | approval_required | executed | cancelled | failed. Approval decisions resume supported actions (`deployment:create`, `deployment:status_update`) or cancel them.
6. **Approval gating**: When policy returns `require_approval`, an `apr_` record is created and execution halts at 202 until an authorized decision is recorded. The `apr_` links back to the `act_` via `actionLedgerEntryId`; approval now continues the suspended deployment action instead of only marking it approved.
7. **Self-approval prevention**: `POST /approvals/:id/decision` rejects with 403/SELF_APPROVAL_DENIED if `reviewerId === requesterId`. The attempt is audited.
8. **Audit foundation**: `emitAuditEvent()` in `lib/audit.ts` is the ONLY path for creating audit records.
9. **Zod validation (Phase 4)**: ALL POST/PATCH route bodies are validated via schemas in `api-server/src/lib/validation.ts`. Invalid requests return `{ error, code: "VALIDATION_ERROR", details }` with HTTP 400.
10. **Rate limiting (Phase 4)**: 500 req/15 min per IP via `express-rate-limit`. Skipped in test environment.
11. **Global error handler (Phase 4)**: 4-arg Express middleware in `app.ts` catches all unhandled errors. Never leaks stack traces in production.
12. **Prefixed IDs**: All IDs generated via `lib/ids.ts` using `customAlphabet` nanoid.

## API Routes (40 endpoints)

```
GET  /api/healthz               ← Phase 4: DB ping, uptime, version

POST /api/tenants               ← Phase 4: Zod validated
GET  /api/tenants
GET  /api/tenants/:tenantId
PATCH /api/tenants/:tenantId    ← Phase 4: Zod validated
GET  /api/tenants/:tenantId/summary

POST /api/tenants/:tenantId/workspaces              ← Phase 4: Zod validated
GET  /api/tenants/:tenantId/workspaces
GET  /api/tenants/:tenantId/workspaces/:workspaceId
PATCH /api/tenants/:tenantId/workspaces/:workspaceId ← Phase 4: Zod validated

POST /api/tenants/:tenantId/workspaces/:workspaceId/environments   ← Phase 4: Zod validated
GET  /api/tenants/:tenantId/workspaces/:workspaceId/environments
GET  /api/tenants/:tenantId/workspaces/:workspaceId/environments/:environmentId
PATCH /api/tenants/:tenantId/workspaces/:workspaceId/environments/:environmentId ← Phase 4: Zod validated

POST /api/tenants/:tenantId/packages               ← Phase 4: Zod validated
GET  /api/tenants/:tenantId/packages
GET  /api/tenants/:tenantId/packages/:packageId
POST /api/tenants/:tenantId/packages/:packageId/versions ← Phase 4: Zod validated
GET  /api/tenants/:tenantId/packages/:packageId/versions
GET  /api/tenants/:tenantId/packages/:packageId/versions/:versionId

GET  /api/tenants/:tenantId/deployments
POST /api/tenants/:tenantId/environments/:environmentId/deployments  ← Phase 3+4 protected
GET  /api/tenants/:tenantId/environments/:environmentId/deployments
GET  /api/tenants/:tenantId/deployments/:deploymentId
PATCH /api/tenants/:tenantId/deployments/:deploymentId              ← Phase 3+4 protected + Zod
POST /api/tenants/:tenantId/deployments/:deploymentId/config-snapshot ← Phase 4: Zod validated
GET  /api/tenants/:tenantId/deployments/:deploymentId/config-snapshot
POST /api/tenants/:tenantId/deployments/:deploymentId/provision       ← Docker/local runtime adapter: resolves config + records runtime health
GET  /api/tenants/:tenantId/deployments/:deploymentId/runtime         ← Runtime status + latest config snapshot

GET  /api/tenants/:tenantId/audit-events
GET  /api/tenants/:tenantId/action-ledger

POST /api/tenants/:tenantId/approvals                        ← Phase 4: Zod validated
GET  /api/tenants/:tenantId/approvals
GET  /api/tenants/:tenantId/approvals/:approvalId
POST /api/tenants/:tenantId/approvals/:approvalId/decision   ← Phase 3+4 self-approve + Zod

POST /api/tenants/:tenantId/policy/evaluate    ← Phase 3+4: pdec_, 4 outcomes, Zod validated
GET  /api/tenants/:tenantId/policy/decisions
```

## Phase 3 Protected Mutation Flow

```
POST /environments/:envId/deployments
  │
  ├─ Zod validate body (Phase 4)
  ├─ Read X-Actor-Id / X-Actor-Type headers (default: system/system)
  ├─ Validate env + pkgVersion belong to tenant
  ├─ evaluatePolicy() → PolicyDecisionResult (4 outcomes)
  ├─ storePolicyDecision() → pdec_ written to DB
  ├─ Emit audit: policy_decision.stored
  ├─ Write act_ entry (status: attempted, policyDecisionId: pdec_)
  ├─ Emit audit: action_ledger.written
  │
  ├─ outcome = deny       → act_ status=blocked, emit audit, 403
  ├─ outcome = require_approval / require_escalation
  │    ├─ Create apr_ (actionLedgerEntryId → act_)
  │    ├─ act_ status=approval_required (approvalRequestId → apr_)
  │    ├─ emit audit: deployment.approval_required
  │    └─ 202 { approvalRequestId, actionLedgerEntryId, policyDecisionId }
  └─ outcome = allow
       ├─ Create dep_
       ├─ act_ status=executed (deploymentId → dep_)
       ├─ emit audit: deployment.created
       └─ 201 deployment
```

## Phase 3 Approval Decision Flow

```
POST /approvals/:approvalId/decision
  │
  ├─ Zod validate body (Phase 4)
  ├─ Fetch approval_request
  ├─ Self-approval check: reviewerId === requesterId → 403 SELF_APPROVAL_DENIED + audit
  ├─ Update approval_request: status=approved|rejected, reviewerId, decidedAt
  ├─ If approved + linked deployment:create:
  │    ├─ Create dep_ from stored request payload
  │    └─ Update act_: status=executed, deploymentId, completedAt + emit audit
  ├─ If approved + linked deployment:status_update:
  │    ├─ Apply stored status transition
  │    └─ Update act_: status=executed, deploymentId, completedAt + emit audit
  ├─ If rejected + linked:
  │    └─ Update act_: status=cancelled, completedAt + emit audit
  └─ Emit audit: approval.decided
```

## Key Commands

```bash
pnpm run typecheck                              # Full typecheck (libs + artifacts)
pnpm --filter @workspace/api-spec run codegen  # Regen hooks + Zod from OpenAPI
pnpm --filter @workspace/db run push           # Push schema (dev only)
pnpm --filter @workspace/api-server test       # Run API test suite (requires DATABASE_URL)
pnpm --filter @workspace/scripts run seed-phase3  # Seed Phase 3 demo data
```

## Codegen

**IMPORTANT**: The orval `zod` output in `orval.config.ts` uses `mode: "single"` with an absolute `target` path and NO `workspace` option. This prevents orval from regenerating `lib/api-zod/src/index.ts` as a barrel file (which caused duplicate export collisions). Do NOT add a `workspace` option back to the zod output config.

## Tests (60 passing)

- `defaultDeny.test.ts` — 5 tests: default-deny, Phase 3 require_approval rule, system allow, evaluatedAt
- `tenantIsolation.test.ts` — 4 tests: cross-tenant 404, suspended tenant 403
- `auditEmission.test.ts` — 2 tests: audit events on tenant/workspace create
- `phase3.test.ts` — 37 tests across 8 sections:
  - §1 Policy engine unit (5): all 4 outcomes + evaluatedAt
  - §2 POST /policy/evaluate (4): stores pdec_, returns outcome, emits audit
  - §3 GET /policy/decisions (2): list + outcome filter
  - §4 Agent blocked (4): 403 response, act_ blocked, pdec_ deny, audit
  - §5 User approval gating (11): 202 response, act_ approval_required, pdec_ require_approval, apr_ created + linked, audit, self-approve 403, self-approve audit, state preserved, approve-granted, act_ executed with deploymentId, audit decided, 409 duplicate
  - §6 System allow (3): 201, act_ executed, no-header defaults to system
  - §7 Rejection flow (3): create → reject → act_ cancelled
  - §8 Action ledger (4): list, status filter blocked, status filter executed, all act_ link pdec_
- `phase4.test.ts` — 12 tests across 3 sections (Phase 4):
  - §1 PATCH /deployments policy gate (5): system→200, user→202, agent→403, metadata-only→200, same-status→200
  - §2 Zod validation (6): missing fields, invalid slug, invalid enum, missing required, invalid decision
  - §3 Health check (1): GET /healthz returns status ok, db ok, uptime

## Seed Data

The database is pre-seeded with demo data:

**Seed tenant** `ten_SeedDemo0000000000001` ("Acme Corp") — created by `scripts/seed.ts`:
- 2 workspaces, 4 environments, 2 packages, 3 package versions
- 3 deployments (active/stopped/pending)
- 2 approval requests (pending/approved)
- 4 audit events

**Phase 3 seed** (run via `pnpm --filter @workspace/scripts run seed-phase3`):
- 6 policy decisions (all 4 outcomes, both actions)
- 6 action ledger entries (executed/blocked/approval_required)
- 1 pending approval request linked to an action ledger entry

## Routing Notes

- The deployments router is mounted at `/tenants/:tenantId` (not root) so its `resolveTenantContext` middleware has access to the `tenantId` param. All other tenant-scoped routers are mounted at their full path prefix.
- In `App.tsx`, `TenantRoutes` wraps all tenant-scoped child routes in `<Router base={/tenants/${tenantId}}>` (wouter nested router). This strips the parent prefix so `<Route path="/">` matches correctly inside the tenant context.

## UI Pages

All 13 pages are fully connected to live API data via generated hooks:

| Page | Path | Notes |
|------|------|-------|
| Tenant List | `/` | Grid of tenant cards + toast on create/error (Phase 4) |
| Tenant Overview | `/tenants/:id` | 8-stat dashboard (incl. Phase 3 counts) |
| Workspaces | `/tenants/:id/workspaces` | List + create + toast feedback (Phase 4) |
| Workspace Detail | `/tenants/:id/workspaces/:wid` | Environments list |
| Environment Detail | `/tenants/:id/workspaces/:wid/environments/:eid` | Deployments in env |
| Agents | `/tenants/:id/packages` | Agent template list + create |
| Agent Detail | `/tenants/:id/packages/:pid` | Structured agent version publishing |
| Agent Deployments | `/tenants/:id/deployments` | Guided deploy wizard with client config, Docker-local runtime provisioning, runtime health, and activation |
| Approvals | `/tenants/:id/approvals` | Pending + decision actions; reviewer ID dialog; actionLedgerEntryId column |
| Audit Log | `/tenants/:id/audit` | Immutable event stream |
| Action Ledger | `/tenants/:id/action-ledger` | Status-filtered act_ evidence trail |
| Policy | `/tenants/:id/policy` | Playground (4-outcome) + Decision History tabs |

## Security Audit Summary

Three-scanner audit (dependency CVE, SAST, HoundDog) run post-Phase 4. All findings resolved.

### Findings & Fixes

| Severity | Category | Finding | Fix |
|----------|----------|---------|-----|
| CRITICAL | Architecture | Open CORS — `app.use(cors())` allowed any origin | `ALLOWED_ORIGINS` env-var-driven allowlist; permissive in dev/test, locked in production |
| CRITICAL | Architecture | `X-Actor-Type: system` forgeable via HTTP header | `lib/actorContext.ts` `resolveActor()` — downgrades `system` claims to `user` unless `X-Internal-Token` matches `API_INTERNAL_TOKEN` env var |
| HIGH | Dependency | `lodash@4.17.23` — Code Injection via `_.template` (CVE-2026-4800) | `pnpm-workspace.yaml` override `lodash: >=4.18.0` |
| HIGH | Dependency | `path-to-regexp@8.3.0` — DoS via sequential optional groups (CVE-2026-4926) | override `path-to-regexp: >=8.4.0` |
| HIGH | Dependency | `picomatch@2.3.1 & 4.0.3` — ReDoS via extglob (CVE-2026-33671) | override `picomatch: >=4.0.4` |
| MODERATE | Dependency | `lodash@4.17.23` — Prototype Pollution (CVE-2026-2950) | included in lodash override |
| MODERATE | Dependency | `brace-expansion@2.0.2` — process hang on zero-step (CVE-2026-33750) | override `brace-expansion: >=2.0.3` |
| MODERATE | Dependency | `postcss@8.5.8` — XSS via unescaped `</style>` (CVE-2026-41305) | override `postcss: >=8.5.10` |
| MODERATE | Dependency | `yaml@2.8.2` — Stack Overflow in deeply-nested YAML (CVE-2026-33532) | override `yaml: >=2.8.3` |
| MEDIUM | SAST | `mockup-sandbox/App.tsx` — dynamic object lookup with URL-derived key | Path sanitized with `/^[\w/-]+$/` before use as module key |

### Production Deployment Checklist (Security)

```
API_INTERNAL_TOKEN=<32+ char random secret>   # Enables system-actor protection
ALLOWED_ORIGINS=https://your-app.replit.app   # Locks CORS to known domains
LOG_LEVEL=info                                 # Avoid debug log leakage
NODE_ENV=production                            # Removes dev error detail exposure
```

### Key Security Files

- `artifacts/api-server/src/lib/actorContext.ts` — `resolveActor()` with privilege-escalation guard
- `artifacts/api-server/src/app.ts` — CORS allowlist, rate limiter, global error handler
- `artifacts/api-server/src/lib/audit.ts` — try/catch on every audit write; failures logged, never surfaced
- `pnpm-workspace.yaml` — CVE overrides section

## Phase 4 Production Hardening Summary

| Item | Status |
|------|--------|
| Zod validation on ALL POST/PATCH routes (13 handlers) | ✅ |
| `lib/validation.ts` centralised schema library | ✅ |
| `parseBody()` helper — sends 400 on failure, returns null | ✅ |
| Rate limiting (500/15m, skip in test) | ✅ |
| Global Express error handler (no stack trace leak in prod) | ✅ |
| Enhanced `/healthz` — DB ping + uptime + version | ✅ |
| React `ErrorBoundary` wrapping entire app + tenant routes | ✅ |
| Toast notifications on all mutations (create/error) | ✅ |
| Deployment dialog: policy-gating warning banner | ✅ |
| PATCH /deployments policy gate test coverage (5 cases) | ✅ |
| Zod validation test coverage (6 cases) | ✅ |
| Phase 3 seed script (`scripts/seed-phase3.ts`) | ✅ |
| Zero loose `req.body as {...}` casts remaining | ✅ |
