# Agent Control Plane — Project Reference

## Overview

Full-stack pnpm monorepo implementing Phase 1–3 of an AI Agent Deployment System. Provides a tenant-aware registry, policy enforcement (4-outcome default-deny engine), approval gating with self-approval prevention, action ledger evidence trail, and audit — all exposed via a RESTful API with a React control-plane UI.

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
```

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24
- **TypeScript**: 5.9
- **API**: Express 5 + Pino logging
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (v4), drizzle-zod
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
2. **Default-deny policy**: `evaluatePolicy()` in `lib/policy.ts` is the ONLY place policy decisions are made. Phase 3 rules: system → allow; user + deployment:create → require_approval; agent + deployment:create → deny; unmatched → deny.
3. **Policy decision persistence**: Every `evaluatePolicy()` call on a protected mutation stores a `pdec_` row via `storePolicyDecision()`. Every interactive `POST /policy/evaluate` call also stores a `pdec_` row.
4. **Protected mutations evaluate policy first**: `POST /environments/:envId/deployments` reads `X-Actor-Id`/`X-Actor-Type` headers, evaluates policy, writes `pdec_` + `act_`, then branches: allow → 201, deny → 403, require_approval → 202 + creates `apr_`.
5. **Action ledger lifecycle**: `act_` entries progress through: attempted → blocked | approval_required | executed. Approval decisions transition approval_required → approved | cancelled.
6. **Approval gating**: When policy returns `require_approval`, an `apr_` record is created and execution halts at 202 until an authorized decision is recorded. The `apr_` links back to the `act_` via `actionLedgerEntryId`.
7. **Self-approval prevention**: `POST /approvals/:id/decision` rejects with 403/SELF_APPROVAL_DENIED if `reviewerId === requesterId`. The attempt is audited.
8. **Audit foundation**: `emitAuditEvent()` in `lib/audit.ts` is the ONLY path for creating audit records. All tenant-mutating routes and Phase 3 events (policy decisions, action ledger writes, approval decisions, self-approve attempts) call it fire-and-forget.
9. **Prefixed IDs**: All IDs generated via `lib/ids.ts` using `customAlphabet` nanoid. New Phase 3 prefixes: `pdec_` (policy decisions), `aprd_` (approval decision audit reference).

## API Routes (38 endpoints)

```
GET  /api/healthz

POST /api/tenants
GET  /api/tenants
GET  /api/tenants/:tenantId
PATCH /api/tenants/:tenantId
GET  /api/tenants/:tenantId/summary

POST /api/tenants/:tenantId/workspaces
GET  /api/tenants/:tenantId/workspaces
GET  /api/tenants/:tenantId/workspaces/:workspaceId
PATCH /api/tenants/:tenantId/workspaces/:workspaceId

POST /api/tenants/:tenantId/workspaces/:workspaceId/environments
GET  /api/tenants/:tenantId/workspaces/:workspaceId/environments
GET  /api/tenants/:tenantId/workspaces/:workspaceId/environments/:environmentId
PATCH /api/tenants/:tenantId/workspaces/:workspaceId/environments/:environmentId

POST /api/tenants/:tenantId/packages
GET  /api/tenants/:tenantId/packages
GET  /api/tenants/:tenantId/packages/:packageId
POST /api/tenants/:tenantId/packages/:packageId/versions
GET  /api/tenants/:tenantId/packages/:packageId/versions
GET  /api/tenants/:tenantId/packages/:packageId/versions/:versionId

GET  /api/tenants/:tenantId/deployments
POST /api/tenants/:tenantId/environments/:environmentId/deployments  ← Phase 3 protected
GET  /api/tenants/:tenantId/environments/:environmentId/deployments
GET  /api/tenants/:tenantId/deployments/:deploymentId
PATCH /api/tenants/:tenantId/deployments/:deploymentId
POST /api/tenants/:tenantId/deployments/:deploymentId/config-snapshot
GET  /api/tenants/:tenantId/deployments/:deploymentId/config-snapshot

GET  /api/tenants/:tenantId/audit-events
GET  /api/tenants/:tenantId/action-ledger

POST /api/tenants/:tenantId/approvals
GET  /api/tenants/:tenantId/approvals
GET  /api/tenants/:tenantId/approvals/:approvalId
POST /api/tenants/:tenantId/approvals/:approvalId/decision  ← Phase 3 self-approve check

POST /api/tenants/:tenantId/policy/evaluate    ← Phase 3: stores pdec_, returns 4 outcomes
GET  /api/tenants/:tenantId/policy/decisions   ← Phase 3: list stored pdec_ records
```

## Phase 3 Protected Mutation Flow

```
POST /environments/:envId/deployments
  │
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
  ├─ Fetch approval_request
  ├─ Self-approval check: reviewerId === requesterId → 403 SELF_APPROVAL_DENIED + audit
  ├─ Update approval_request: status=approved|rejected, reviewerId, decidedAt
  ├─ If actionLedgerEntryId linked:
  │    └─ Update act_: status=approved|cancelled, completedAt + emit audit
  └─ Emit audit: approval.decided
```

## Key Commands

```bash
pnpm run typecheck                              # Full typecheck
pnpm --filter @workspace/api-spec run codegen  # Regen hooks + Zod from OpenAPI
pnpm --filter @workspace/db run push           # Push schema (dev only)
pnpm --filter @workspace/api-server test       # Run test suite (48 tests)
```

## Codegen

**IMPORTANT**: The orval `zod` output in `orval.config.ts` uses `mode: "single"` with an absolute `target` path and NO `workspace` option. This prevents orval from regenerating `lib/api-zod/src/index.ts` as a barrel file (which caused duplicate export collisions). Do NOT add a `workspace` option back to the zod output config.

## Tests (48 passing)

- `defaultDeny.test.ts` — 5 tests: default-deny, Phase 3 require_approval rule, system allow, evaluatedAt
- `tenantIsolation.test.ts` — 4 tests: cross-tenant 404, suspended tenant 403
- `auditEmission.test.ts` — 2 tests: audit events on tenant/workspace create
- `phase3.test.ts` — 37 tests across 8 sections:
  - §1 Policy engine unit (5): all 4 outcomes + evaluatedAt
  - §2 POST /policy/evaluate (4): stores pdec_, returns outcome, emits audit
  - §3 GET /policy/decisions (2): list + outcome filter
  - §4 Agent blocked (4): 403 response, act_ blocked, pdec_ deny, audit
  - §5 User approval gating (11): 202 response, act_ approval_required, pdec_ require_approval, apr_ created + linked, audit, self-approve 403, self-approve audit, state preserved, approve-granted, act_ approved, audit decided, 409 duplicate
  - §6 System allow (3): 201, act_ executed, no-header defaults to system
  - §7 Rejection flow (3): create → reject → act_ cancelled
  - §8 Action ledger (4): list, status filter blocked, status filter executed, all act_ link pdec_

## Seed Data

The database is seeded with sample data under tenant `ten_SeedDemo0000000000001` ("Acme Corp"):
- 2 workspaces, 4 environments, 2 packages, 3 package versions
- 3 deployments (active/stopped/pending)
- 2 approval requests (pending/approved)
- 4 audit events

## Routing Notes

- The deployments router is mounted at `/tenants/:tenantId` (not root) so its `resolveTenantContext` middleware has access to the `tenantId` param. All other tenant-scoped routers are mounted at their full path prefix.
- In `App.tsx`, `TenantRoutes` wraps all tenant-scoped child routes in `<Router base={/tenants/${tenantId}}>` (wouter nested router). This strips the parent prefix so `<Route path="/">` matches correctly inside the tenant context.

## UI Pages

All 12 pages are fully connected to live API data via generated hooks:

| Page | Path | Notes |
|------|------|-------|
| Tenant List | `/` | Grid of tenant cards |
| Tenant Overview | `/tenants/:id` | Summary stats dashboard |
| Workspaces | `/tenants/:id/workspaces` | List + create |
| Workspace Detail | `/tenants/:id/workspaces/:wid` | Environments list |
| Environment Detail | `/tenants/:id/workspaces/:wid/environments/:eid` | Deployments in env |
| Packages | `/tenants/:id/packages` | List + create |
| Package Detail | `/tenants/:id/packages/:pid` | Version list |
| Deployments | `/tenants/:id/deployments` | Cross-env list |
| Approvals | `/tenants/:id/approvals` | Pending + decision actions |
| Audit Log | `/tenants/:id/audit` | Immutable event stream |
| Policy Playground | `/tenants/:id/policy` | Evaluate policy interactively |
