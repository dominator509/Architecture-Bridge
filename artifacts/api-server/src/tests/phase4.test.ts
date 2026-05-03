/**
 * Phase 4 production readiness tests.
 *
 * §1  PATCH /deployments — policy gate for status transitions
 *     1a. System actor (default headers) → allow → 200
 *     1b. User actor (X-Actor-Type: user) → require_approval → 202
 *     1c. Agent actor (X-Actor-Type: agent) → deny → 403
 *     1d. Metadata-only PATCH → 200 (bypasses gate, no pdec_ written)
 *     1e. Same-status PATCH → 200 (bypasses gate, no pdec_ written)
 *
 * §2  Input validation (Zod schemas on all POST/PATCH routes)
 *     2a. POST /tenants with missing name → 400 VALIDATION_ERROR
 *     2b. POST /tenants with invalid slug chars → 400 VALIDATION_ERROR
 *     2c. POST /workspaces with missing slug → 400 VALIDATION_ERROR
 *     2d. POST /approvals with missing requesterId → 400 VALIDATION_ERROR
 *     2e. POST /approvals/:id/decision with invalid decision value → 400 VALIDATION_ERROR
 *     2f. POST /environments with invalid type → 400 VALIDATION_ERROR
 *
 * §3  Enhanced health check
 *     3a. GET /healthz returns { status: "ok", db: "ok" }
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import {
  db,
  tenantsTable,
  workspacesTable,
  environmentsTable,
  packagesTable,
  packageVersionsTable,
  deploymentsTable,
  actionLedgerTable,
  policyDecisionsTable,
  approvalRequestsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  newTenantId,
  newWorkspaceId,
  newEnvironmentId,
  newPackageId,
  newPackageVersionId,
} from "../lib/ids";

const TENANT_ID = newTenantId();
const WS_ID = newWorkspaceId();
const ENV_ID = newEnvironmentId();
const PKG_ID = newPackageId();
const PKGV_ID = newPackageVersionId();

const BASE = `/api/tenants/${TENANT_ID}`;

let deploymentId: string;

beforeAll(async () => {
  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "Phase4 Test Tenant",
    slug: `phase4-test-${TENANT_ID}`,
    status: "active",
    metadata: {},
  });

  await db.insert(workspacesTable).values({
    id: WS_ID,
    tenantId: TENANT_ID,
    name: "Phase4 WS",
    slug: `phase4-ws-${WS_ID}`,
    status: "active",
    metadata: {},
  });

  await db.insert(environmentsTable).values({
    id: ENV_ID,
    tenantId: TENANT_ID,
    workspaceId: WS_ID,
    name: "Phase4 Env",
    slug: `phase4-env-${ENV_ID}`,
    type: "staging",
    status: "active",
    metadata: {},
  });

  await db.insert(packagesTable).values({
    id: PKG_ID,
    tenantId: TENANT_ID,
    name: "Phase4 Pkg",
    slug: `phase4-pkg-${PKG_ID}`,
    status: "active",
    metadata: {},
  });

  await db.insert(packageVersionsTable).values({
    id: PKGV_ID,
    tenantId: TENANT_ID,
    packageId: PKG_ID,
    version: "1.0.0",
    manifest: { entry: "index.js" },
    status: "published",
  });

  // Create a deployment as system actor (allow) to use in PATCH tests
  const depRes = await request(app)
    .post(`${BASE}/environments/${ENV_ID}/deployments`)
    .send({ packageVersionId: PKGV_ID });

  expect(depRes.status).toBe(201);
  deploymentId = depRes.body.id;
});

afterAll(async () => {
  await db.delete(actionLedgerTable).where(eq(actionLedgerTable.tenantId, TENANT_ID));
  await db.delete(policyDecisionsTable).where(eq(policyDecisionsTable.tenantId, TENANT_ID));
  await db.delete(approvalRequestsTable).where(eq(approvalRequestsTable.tenantId, TENANT_ID));
  await db.delete(deploymentsTable).where(eq(deploymentsTable.tenantId, TENANT_ID));
  await db.delete(packageVersionsTable).where(eq(packageVersionsTable.tenantId, TENANT_ID));
  await db.delete(packagesTable).where(eq(packagesTable.tenantId, TENANT_ID));
  await db.delete(environmentsTable).where(eq(environmentsTable.tenantId, TENANT_ID));
  await db.delete(workspacesTable).where(eq(workspacesTable.tenantId, TENANT_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

// ── §1 PATCH /deployments — policy gate ───────────────────────────────────────

describe("§1 PATCH /deployments — policy gate for status transitions", () => {
  it("1a. system actor (default) → allow → 200 with updated deployment", async () => {
    const res = await request(app)
      .patch(`${BASE}/deployments/${deploymentId}`)
      .send({ status: "stopped" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("stopped");

    // act_ entry should be executed
    const acts = await db
      .select()
      .from(actionLedgerTable)
      .where(
        and(
          eq(actionLedgerTable.tenantId, TENANT_ID),
          eq(actionLedgerTable.deploymentId, deploymentId),
          eq(actionLedgerTable.actionType, "deployment:status_update"),
        ),
      );
    expect(acts.length).toBeGreaterThan(0);
    expect(acts[acts.length - 1]!.status).toBe("executed");
  });

  it("1b. user actor → require_approval → 202 with approvalRequestId", async () => {
    // First restore to a different status so the gate fires
    await request(app)
      .patch(`${BASE}/deployments/${deploymentId}`)
      .send({ status: "active" });

    const res = await request(app)
      .patch(`${BASE}/deployments/${deploymentId}`)
      .set("X-Actor-Type", "user")
      .set("X-Actor-Id", "usr_test_reviewer")
      .send({ status: "stopped" });

    expect(res.status).toBe(202);
    expect(res.body.outcome).toBe("require_approval");
    expect(res.body.approvalRequestId).toMatch(/^apr_/);
    expect(res.body.actionLedgerEntryId).toMatch(/^act_/);
    expect(res.body.policyDecisionId).toMatch(/^pdec_/);

    // Deployment status should be unchanged (approval pending)
    const [dep] = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.id, deploymentId));
    expect(dep!.status).toBe("active");

    // act_ entry should be approval_required
    const [act] = await db
      .select()
      .from(actionLedgerTable)
      .where(eq(actionLedgerTable.id, res.body.actionLedgerEntryId));
    expect(act!.status).toBe("approval_required");
  });

  it("1c. agent actor → deny → 403 with POLICY_DENIED code", async () => {
    const res = await request(app)
      .patch(`${BASE}/deployments/${deploymentId}`)
      .set("X-Actor-Type", "agent")
      .set("X-Actor-Id", "agt_test_agent")
      .send({ status: "stopped" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("POLICY_DENIED");
    expect(res.body.policyDecisionId).toMatch(/^pdec_/);
    expect(res.body.actionLedgerEntryId).toMatch(/^act_/);

    // Deployment status should be unchanged
    const [dep] = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.id, deploymentId));
    expect(dep!.status).toBe("active");

    // act_ entry should be blocked
    const [act] = await db
      .select()
      .from(actionLedgerTable)
      .where(eq(actionLedgerTable.id, res.body.actionLedgerEntryId));
    expect(act!.status).toBe("blocked");
  });

  it("1d. metadata-only PATCH → 200 (bypasses policy gate, no new pdec_)", async () => {
    const beforeCount = await db
      .select()
      .from(policyDecisionsTable)
      .where(eq(policyDecisionsTable.tenantId, TENANT_ID));

    const res = await request(app)
      .patch(`${BASE}/deployments/${deploymentId}`)
      .set("X-Actor-Type", "user")
      .set("X-Actor-Id", "usr_test_user")
      .send({ metadata: { tag: "phase4-test" } });

    expect(res.status).toBe(200);
    expect(res.body.metadata).toMatchObject({ tag: "phase4-test" });

    const afterCount = await db
      .select()
      .from(policyDecisionsTable)
      .where(eq(policyDecisionsTable.tenantId, TENANT_ID));

    // No new policy decision should have been created
    expect(afterCount.length).toBe(beforeCount.length);
  });

  it("1e. same-status PATCH (status unchanged) → 200, bypasses gate", async () => {
    const [current] = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.id, deploymentId));
    const currentStatus = current!.status;

    const beforeCount = await db
      .select()
      .from(policyDecisionsTable)
      .where(eq(policyDecisionsTable.tenantId, TENANT_ID));

    const res = await request(app)
      .patch(`${BASE}/deployments/${deploymentId}`)
      .set("X-Actor-Type", "user")
      .send({ status: currentStatus });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(currentStatus);

    const afterCount = await db
      .select()
      .from(policyDecisionsTable)
      .where(eq(policyDecisionsTable.tenantId, TENANT_ID));

    expect(afterCount.length).toBe(beforeCount.length);
  });
});

// ── §2 Input validation ────────────────────────────────────────────────────────

describe("§2 Input validation — Zod schemas on all POST/PATCH routes", () => {
  it("2a. POST /tenants missing name → 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .post("/api/tenants")
      .send({ slug: "no-name-slug" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details).toBeDefined();
  });

  it("2b. POST /tenants with invalid slug chars (uppercase) → 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .post("/api/tenants")
      .send({ name: "Test", slug: "INVALID_SLUG" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("2c. POST /workspaces missing slug → 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .post(`${BASE}/workspaces`)
      .send({ name: "No Slug Workspace" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("2d. POST /approvals missing requesterId → 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .post(`${BASE}/approvals`)
      .send({ resourceType: "deployment", resourceId: "dep_x", action: "promote" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("2e. POST /approvals/:id/decision invalid decision value → 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .post(`${BASE}/approvals/apr_fake/decision`)
      .send({ decision: "maybe", reviewerId: "reviewer_001" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("2f. POST /environments with invalid type → 400 VALIDATION_ERROR", async () => {
    const res = await request(app)
      .post(`${BASE}/workspaces/${WS_ID}/environments`)
      .send({ name: "Bad Env", slug: "bad-env", type: "invalid_type" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});

// ── §3 Health check ────────────────────────────────────────────────────────────

describe("§3 Enhanced health check", () => {
  it("3a. GET /healthz returns status ok and db ok", async () => {
    const res = await request(app).get("/api/healthz");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.db).toBe("ok");
    expect(typeof res.body.uptime).toBe("number");
  });
});
