# Agent Control Plane — Project Reference

## Overview

Full-stack pnpm monorepo implementing Phase 1-2 of an AI Agent Deployment System. Provides a tenant-aware registry, audit foundation, default-deny policy engine, approval workflows, and action ledger — all exposed via a RESTful API with a React control-plane UI.

## Architecture

```
artifacts/
  api-server/       — Express 5 REST API (port 8080, /api prefix)
  control-plane/    — React + Vite admin UI (port 24565, / prefix)
lib/
  db/               — Drizzle ORM schema + migrations (10 tables)
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

## Database Tables (10)

| Table | ID Prefix | Purpose |
|-------|-----------|---------|
| tenants | `tnt_` | Root org unit |
| workspaces | `wsp_` | Tenant subdivision |
| environments | `env_` | dev/staging/prod per workspace |
| packages | `pkg_` | Agent package registry |
| package_versions | `pkgv_` | Immutable versioned manifests |
| deployments | `dep_` | Package version → environment mapping |
| config_snapshots | `cfg_` | Resolved config at deploy time |
| audit_events | `aud_` | Immutable audit trail |
| action_ledger | `led_` | Agent action log |
| approval_requests | `apr_` | Approval workflow records |

## Key Architecture Invariants

1. **Tenant isolation**: Every resource carries `tenantId`; all queries filter by it. Cross-tenant reads return 404.
2. **Default-deny policy**: `evaluatePolicy()` in `lib/policy.ts` is the ONLY place policy decisions are made. Currently only `system` principal type is allowed.
3. **Audit foundation**: `emitAuditEvent()` in `lib/audit.ts` is the ONLY path for creating audit records. All tenant-mutating routes call it fire-and-forget after successful writes.
4. **Tenant context middleware**: `resolveTenantContext` + `requireActiveTenant` in `lib/tenantContext.ts` gate every tenant-scoped route. Suspended tenants get 403.
5. **Prefixed IDs**: All IDs are generated via `lib/ids.ts` using `customAlphabet` nanoid with architecture-boundary prefixes.

## API Routes (35+ endpoints)

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
POST /api/tenants/:tenantId/environments/:environmentId/deployments
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
POST /api/tenants/:tenantId/approvals/:approvalId/decision
POST /api/tenants/:tenantId/policy/evaluate
```

## Key Commands

```bash
pnpm run typecheck                              # Full typecheck
pnpm --filter @workspace/api-spec run codegen  # Regen hooks + Zod from OpenAPI
pnpm --filter @workspace/db run push           # Push schema (dev only)
pnpm --filter @workspace/api-server test       # Run test suite (10 tests)
```

## Codegen

**IMPORTANT**: The orval `zod` output in `orval.config.ts` uses `mode: "single"` with an absolute `target` path and NO `workspace` option. This prevents orval from regenerating `lib/api-zod/src/index.ts` as a barrel file (which caused duplicate export collisions). Do NOT add a `workspace` option back to the zod output config.

## Tests (10 passing)

- `defaultDeny.test.ts` — 4 tests: policy engine default-deny + system allow
- `tenantIsolation.test.ts` — 4 tests: cross-tenant 404, suspended tenant 403
- `auditEmission.test.ts` — 2 tests: audit events emitted on tenant/workspace create

## Seed Data

The database is seeded with sample data under tenant `tnt_SeedDemo0000000000001` ("Acme Corp"):
- 2 workspaces, 4 environments, 2 packages, 3 package versions
- 3 deployments (active/stopped/pending)
- 2 approval requests (pending/approved)
- 4 audit events

## Routing Notes

- The deployments router is mounted at `/tenants/:tenantId` (not root) so its `resolveTenantContext` middleware has access to the `tenantId` param. All other tenant-scoped routers are mounted at their full path prefix. Do NOT mount routers with no path prefix if they use `resolveTenantContext`.
- In `App.tsx`, `TenantRoutes` wraps all tenant-scoped child routes in `<Router base={/tenants/${tenantId}}>` (wouter nested router). This strips the parent prefix so `<Route path="/">` matches correctly inside the tenant context. Without this, wouter matches the full path and all tenant sub-routes 404.

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
| Deployments | `/tenants/:id/deployments` | Cross-env list via `GET /tenants/:id/deployments` |
| Approvals | `/tenants/:id/approvals` | Pending + decision actions |
| Audit Log | `/tenants/:id/audit` | Immutable event stream |
| Policy Playground | `/tenants/:id/policy` | Evaluate policy interactively |
