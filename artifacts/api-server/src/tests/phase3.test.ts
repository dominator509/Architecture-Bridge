/**
 * Phase 3 hardening tests.
 *
 * Covers:
 *   1. Default deny — unknown action/resource combination → deny
 *   2. Agent deployment:create → deny (403), act_ blocked, pdec_ stored
 *   3. User deployment:create → require_approval (202), act_ approval_required, pdec_ stored, apr_ created
 *   4. System deployment:create → allow (201), act_ executed, pdec_ stored
 *   5. Self-approval prevention → 403 with SELF_APPROVAL_DENIED code
 *   6. Approval granted → suspended action executes, audit event emitted
 *   7. Approval rejected → act_ updated to "cancelled"
 *   8. Policy /evaluate endpoint stores pdec_ and returns outcome
 *   9. Audit events emitted for policy decisions, action ledger writes, approvals
 *  10. GET /policy/decisions returns stored decisions
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
  auditEventsTable,
  actionLedgerTable,
  approvalRequestsTable,
  policyDecisionsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  newTenantId,
  newWorkspaceId,
  newEnvironmentId,
  newPackageId,
  newPackageVersionId,
} from "../lib/ids";
import { evaluatePolicy } from "../lib/policy";

const TENANT_ID = newTenantId();
const WS_ID = newWorkspaceId();
const ENV_ID = newEnvironmentId();
const PKG_ID = newPackageId();
const PKGV_ID = newPackageVersionId();

const BASE = `/api/tenants/${TENANT_ID}`;

// ── Test fixtures ─────────────────────────────────────────────────────────────

beforeAll(async () => {
  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "Phase3 Test Tenant",
    slug: `phase3-test-${TENANT_ID}`,
    status: "active",
    metadata: {},
  });

  await db.insert(workspacesTable).values({
    id: WS_ID,
    tenantId: TENANT_ID,
    name: "Phase3 WS",
    slug: `phase3-ws-${TENANT_ID}`,
    status: "active",
  });

  await db.insert(environmentsTable).values({
    id: ENV_ID,
    tenantId: TENANT_ID,
    workspaceId: WS_ID,
    name: "Phase3 Env",
    slug: `phase3-env-${TENANT_ID}`,
    type: "staging",
    status: "active",
  });

  await db.insert(packagesTable).values({
    id: PKG_ID,
    tenantId: TENANT_ID,
    name: "phase3-pkg",
    slug: `phase3-pkg-${TENANT_ID}`,
    description: "Phase 3 test package",
    status: "active",
  });

  await db.insert(packageVersionsTable).values({
    id: PKGV_ID,
    tenantId: TENANT_ID,
    packageId: PKG_ID,
    version: "1.0.0",
    manifest: { name: "phase3-pkg", version: "1.0.0" },
    status: "published",
  });
});

afterAll(async () => {
  // Delete in FK-safe order (children before parents)
  await db.delete(policyDecisionsTable).where(
    eq(policyDecisionsTable.tenantId, TENANT_ID),
  );
  await db.delete(actionLedgerTable).where(
    eq(actionLedgerTable.tenantId, TENANT_ID),
  );
  await db.delete(approvalRequestsTable).where(
    eq(approvalRequestsTable.tenantId, TENANT_ID),
  );
  await db.delete(auditEventsTable).where(
    eq(auditEventsTable.tenantId, TENANT_ID),
  );
  // Deployments must be deleted before package_versions (FK constraint)
  await db.delete(deploymentsTable).where(
    eq(deploymentsTable.tenantId, TENANT_ID),
  );
  await db.delete(packageVersionsTable).where(
    eq(packageVersionsTable.tenantId, TENANT_ID),
  );
  await db.delete(packagesTable).where(eq(packagesTable.tenantId, TENANT_ID));
  await db.delete(environmentsTable).where(
    eq(environmentsTable.tenantId, TENANT_ID),
  );
  await db.delete(workspacesTable).where(
    eq(workspacesTable.tenantId, TENANT_ID),
  );
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

// ── §1  Policy engine unit tests ──────────────────────────────────────────────

describe("§1 Policy engine — unit", () => {
  it("system principal → allow (any action)", () => {
    const result = evaluatePolicy({
      principal: { id: "system", type: "system" },
      action: "any:action",
      resource: { type: "any", id: "any_id" },
    });
    expect(result.outcome).toBe("allow");
    expect(result.allowed).toBe(true);
    expect(result.matchedRule).toBe("system.full_access");
  });

  it("user + deployment:create → require_approval", () => {
    const result = evaluatePolicy({
      principal: { id: "alice", type: "user" },
      action: "deployment:create",
      resource: { type: "environment", id: ENV_ID },
    });
    expect(result.outcome).toBe("require_approval");
    expect(result.allowed).toBe(false);
    expect(result.matchedRule).toBe(
      "user.deployment_create.require_approval",
    );
  });

  it("agent + deployment:create → deny", () => {
    const result = evaluatePolicy({
      principal: { id: "bot-1", type: "agent" },
      action: "deployment:create",
      resource: { type: "environment", id: ENV_ID },
    });
    expect(result.outcome).toBe("deny");
    expect(result.allowed).toBe(false);
    expect(result.matchedRule).toBe("agent.deployment_create.deny");
  });

  it("user + unknown action → default deny", () => {
    const result = evaluatePolicy({
      principal: { id: "alice", type: "user" },
      action: "workspace:delete",
      resource: { type: "workspace", id: WS_ID },
    });
    expect(result.outcome).toBe("deny");
    expect(result.allowed).toBe(false);
    expect(result.matchedRule).toBeNull();
    expect(result.reason).toMatch(/default deny/i);
  });

  it("evaluatedAt is a recent Date", () => {
    const before = new Date();
    const result = evaluatePolicy({
      principal: { id: "system", type: "system" },
      action: "read",
      resource: { type: "env", id: "env_x" },
    });
    expect(result.evaluatedAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    expect(result.evaluatedAt.getTime()).toBeLessThanOrEqual(
      new Date().getTime(),
    );
  });
});

// ── §2  POST /policy/evaluate ─────────────────────────────────────────────────

describe("§2 POST /policy/evaluate — stores pdec_ and returns 4 outcomes", () => {
  it("system actor → allow, stores pdec_", async () => {
    const res = await request(app)
      .post(`${BASE}/policy/evaluate`)
      .send({
        principal: { id: "system", type: "system" },
        action: "deployment:create",
        resource: { type: "environment", id: ENV_ID },
      })
      .expect(200);

    expect(res.body.outcome).toBe("allow");
    expect(res.body.allowed).toBe(true);
    expect(res.body.id).toMatch(/^pdec_/);

    await new Promise((r) => setTimeout(r, 100));
    const [stored] = await db
      .select()
      .from(policyDecisionsTable)
      .where(eq(policyDecisionsTable.id, res.body.id));

    expect(stored).toBeDefined();
    expect(stored!.outcome).toBe("allow");
    expect(stored!.tenantId).toBe(TENANT_ID);
  });

  it("user actor + deployment:create → require_approval, stores pdec_", async () => {
    const res = await request(app)
      .post(`${BASE}/policy/evaluate`)
      .send({
        principal: { id: "alice", type: "user" },
        action: "deployment:create",
        resource: { type: "environment", id: ENV_ID },
      })
      .expect(200);

    expect(res.body.outcome).toBe("require_approval");
    expect(res.body.allowed).toBe(false);
    expect(res.body.id).toMatch(/^pdec_/);
  });

  it("agent actor + deployment:create → deny", async () => {
    const res = await request(app)
      .post(`${BASE}/policy/evaluate`)
      .send({
        principal: { id: "bot-x", type: "agent" },
        action: "deployment:create",
        resource: { type: "environment", id: ENV_ID },
      })
      .expect(200);

    expect(res.body.outcome).toBe("deny");
    expect(res.body.allowed).toBe(false);
  });

  it("stores an audit event for every evaluated policy", async () => {
    const res = await request(app)
      .post(`${BASE}/policy/evaluate`)
      .send({
        principal: { id: "auditor", type: "user" },
        action: "workspace:read",
        resource: { type: "workspace", id: WS_ID },
      })
      .expect(200);

    await new Promise((r) => setTimeout(r, 100));

    const events = await db
      .select()
      .from(auditEventsTable)
      .where(
        and(
          eq(auditEventsTable.tenantId, TENANT_ID),
          eq(auditEventsTable.eventType, "policy_decision.stored"),
          eq(auditEventsTable.resourceId, res.body.id),
        ),
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

// ── §3  GET /policy/decisions ─────────────────────────────────────────────────

describe("§3 GET /policy/decisions — paginated list of stored pdec_", () => {
  it("returns stored policy decisions for the tenant", async () => {
    const res = await request(app)
      .get(`${BASE}/policy/decisions`)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe("number");
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    const ids = res.body.items.map((i: { id: string }) => i.id) as string[];
    expect(ids.every((id) => id.startsWith("pdec_"))).toBe(true);
  });

  it("filters by outcome", async () => {
    const res = await request(app)
      .get(`${BASE}/policy/decisions?outcome=allow`)
      .expect(200);

    expect(res.body.items.every((i: { outcome: string }) => i.outcome === "allow")).toBe(true);
  });
});

// ── §4  POST deployment with agent actor → DENY (403) ─────────────────────────

describe("§4 Protected mutation — agent actor blocked", () => {
  it("agent actor creating deployment gets 403 with POLICY_DENIED code", async () => {
    const res = await request(app)
      .post(`${BASE}/environments/${ENV_ID}/deployments`)
      .set("X-Actor-Type", "agent")
      .set("X-Actor-Id", "bot-1")
      .send({ packageVersionId: PKGV_ID })
      .expect(403);

    expect(res.body.code).toBe("POLICY_DENIED");
    expect(res.body.policyDecisionId).toMatch(/^pdec_/);
    expect(res.body.actionLedgerEntryId).toMatch(/^act_/);
  });

  it("act_ entry has status=blocked after deny", async () => {
    // Send another denied request and check the DB
    const res = await request(app)
      .post(`${BASE}/environments/${ENV_ID}/deployments`)
      .set("X-Actor-Type", "agent")
      .set("X-Actor-Id", "bot-2")
      .send({ packageVersionId: PKGV_ID })
      .expect(403);

    await new Promise((r) => setTimeout(r, 100));

    const [entry] = await db
      .select()
      .from(actionLedgerTable)
      .where(eq(actionLedgerTable.id, res.body.actionLedgerEntryId));

    expect(entry).toBeDefined();
    expect(entry!.status).toBe("blocked");
    expect(entry!.actorType).toBe("agent");
    expect(entry!.policyDecisionId).toMatch(/^pdec_/);
  });

  it("pdec_ record has outcome=deny after agent block", async () => {
    const res = await request(app)
      .post(`${BASE}/environments/${ENV_ID}/deployments`)
      .set("X-Actor-Type", "agent")
      .set("X-Actor-Id", "bot-3")
      .send({ packageVersionId: PKGV_ID })
      .expect(403);

    await new Promise((r) => setTimeout(r, 100));

    const [pdec] = await db
      .select()
      .from(policyDecisionsTable)
      .where(eq(policyDecisionsTable.id, res.body.policyDecisionId));

    expect(pdec).toBeDefined();
    expect(pdec!.outcome).toBe("deny");
    expect(pdec!.principalType).toBe("agent");
    expect(pdec!.action).toBe("deployment:create");
  });

  it("audit event emitted for blocked deployment", async () => {
    const res = await request(app)
      .post(`${BASE}/environments/${ENV_ID}/deployments`)
      .set("X-Actor-Type", "agent")
      .set("X-Actor-Id", "bot-audit")
      .send({ packageVersionId: PKGV_ID })
      .expect(403);

    await new Promise((r) => setTimeout(r, 150));

    const events = await db
      .select()
      .from(auditEventsTable)
      .where(
        and(
          eq(auditEventsTable.tenantId, TENANT_ID),
          eq(auditEventsTable.eventType, "deployment.blocked"),
        ),
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

// ── §5  POST deployment with user actor → REQUIRE_APPROVAL (202) ──────────────

describe("§5 Protected mutation — user actor approval gating", () => {
  let approvalRequestId: string;
  let actionLedgerEntryId: string;
  let policyDecisionId: string;

  it("user actor creating deployment gets 202 with approval request", async () => {
    const res = await request(app)
      .post(`${BASE}/environments/${ENV_ID}/deployments`)
      .set("X-Actor-Type", "user")
      .set("X-Actor-Id", "alice")
      .send({ packageVersionId: PKGV_ID })
      .expect(202);

    expect(res.body.outcome).toBe("require_approval");
    expect(res.body.approvalRequestId).toMatch(/^apr_/);
    expect(res.body.actionLedgerEntryId).toMatch(/^act_/);
    expect(res.body.policyDecisionId).toMatch(/^pdec_/);

    approvalRequestId = res.body.approvalRequestId as string;
    actionLedgerEntryId = res.body.actionLedgerEntryId as string;
    policyDecisionId = res.body.policyDecisionId as string;
  });

  it("act_ entry has status=approval_required", async () => {
    await new Promise((r) => setTimeout(r, 100));
    const [entry] = await db
      .select()
      .from(actionLedgerTable)
      .where(eq(actionLedgerTable.id, actionLedgerEntryId));

    expect(entry).toBeDefined();
    expect(entry!.status).toBe("approval_required");
    expect(entry!.approvalRequestId).toBe(approvalRequestId);
    expect(entry!.policyDecisionId).toBe(policyDecisionId);
  });

  it("pdec_ record has outcome=require_approval", async () => {
    const [pdec] = await db
      .select()
      .from(policyDecisionsTable)
      .where(eq(policyDecisionsTable.id, policyDecisionId));

    expect(pdec).toBeDefined();
    expect(pdec!.outcome).toBe("require_approval");
    expect(pdec!.principalId).toBe("alice");
  });

  it("approval_request is pending with correct requester and links to act_", async () => {
    const [apr] = await db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, approvalRequestId));

    expect(apr).toBeDefined();
    expect(apr!.status).toBe("pending");
    expect(apr!.requesterId).toBe("alice");
    expect(apr!.actionLedgerEntryId).toBe(actionLedgerEntryId);
    expect(apr!.action).toBe("deployment:create");
  });

  it("audit event emitted for approval-required deployment", async () => {
    await new Promise((r) => setTimeout(r, 100));
    const events = await db
      .select()
      .from(auditEventsTable)
      .where(
        and(
          eq(auditEventsTable.tenantId, TENANT_ID),
          eq(auditEventsTable.eventType, "deployment.approval_required"),
          eq(auditEventsTable.resourceId, approvalRequestId),
        ),
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  // ── Self-approval prevention ─────────────────────────────────────────────────

  it("self-approval is rejected with SELF_APPROVAL_DENIED", async () => {
    const res = await request(app)
      .post(`${BASE}/approvals/${approvalRequestId}/decision`)
      .send({ decision: "approved", reviewerId: "alice" })
      .expect(403);

    expect(res.body.code).toBe("SELF_APPROVAL_DENIED");
    expect(res.body.requesterId).toBe("alice");
  });

  it("self-approval attempt emits audit event", async () => {
    await new Promise((r) => setTimeout(r, 100));
    const events = await db
      .select()
      .from(auditEventsTable)
      .where(
        and(
          eq(auditEventsTable.tenantId, TENANT_ID),
          eq(auditEventsTable.eventType, "approval.self_approve_attempted"),
          eq(auditEventsTable.resourceId, approvalRequestId),
        ),
      );
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("approval request remains pending after self-approve attempt", async () => {
    const [apr] = await db
      .select()
      .from(approvalRequestsTable)
      .where(eq(approvalRequestsTable.id, approvalRequestId));
    expect(apr!.status).toBe("pending");
  });

  // ── Approved flow ────────────────────────────────────────────────────────────

  it("different reviewer can approve the request", async () => {
    const res = await request(app)
      .post(`${BASE}/approvals/${approvalRequestId}/decision`)
      .send({ decision: "approved", reviewerId: "bob" })
      .expect(200);

    expect(res.body.status).toBe("approved");
    expect(res.body.reviewerId).toBe("bob");
  });

  it("act_ entry executes and links the deployment after approval", async () => {
    await new Promise((r) => setTimeout(r, 100));
    const [entry] = await db
      .select()
      .from(actionLedgerTable)
      .where(eq(actionLedgerTable.id, actionLedgerEntryId));

    expect(entry).toBeDefined();
    expect(entry!.status).toBe("executed");
    expect(entry!.deploymentId).toMatch(/^dep_/);
    expect(entry!.completedAt).not.toBeNull();

    const [deployment] = await db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.id, entry!.deploymentId!));

    expect(deployment).toBeDefined();
    expect(deployment!.environmentId).toBe(ENV_ID);
    expect(deployment!.packageVersionId).toBe(PKGV_ID);
    expect(deployment!.status).toBe("pending");
  });

  it("audit event emitted for approval decision", async () => {
    const events = await db
      .select()
      .from(auditEventsTable)
      .where(
        and(
          eq(auditEventsTable.tenantId, TENANT_ID),
          eq(auditEventsTable.eventType, "approval.decided"),
          eq(auditEventsTable.resourceId, approvalRequestId),
        ),
      );
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("second decision on same approval returns 409", async () => {
    const res = await request(app)
      .post(`${BASE}/approvals/${approvalRequestId}/decision`)
      .send({ decision: "rejected", reviewerId: "charlie" })
      .expect(409);

    expect(res.body.code).toBe("ALREADY_DECIDED");
  });
});

// ── §6  POST deployment with system actor → ALLOW (201) ───────────────────────

describe("§6 Protected mutation — system actor executes immediately", () => {
  it("system actor creating deployment gets 201", async () => {
    const res = await request(app)
      .post(`${BASE}/environments/${ENV_ID}/deployments`)
      .set("X-Actor-Type", "system")
      .set("X-Actor-Id", "system")
      .send({ packageVersionId: PKGV_ID })
      .expect(201);

    expect(res.body.id).toMatch(/^dep_/);
    expect(res.body.status).toBe("pending");
  });

  it("act_ entry has status=executed after system allow", async () => {
    const res = await request(app)
      .post(`${BASE}/environments/${ENV_ID}/deployments`)
      .set("X-Actor-Type", "system")
      .set("X-Actor-Id", "system")
      .send({ packageVersionId: PKGV_ID })
      .expect(201);

    await new Promise((r) => setTimeout(r, 100));

    const entries = await db
      .select()
      .from(actionLedgerTable)
      .where(
        and(
          eq(actionLedgerTable.tenantId, TENANT_ID),
          eq(actionLedgerTable.status, "executed"),
          eq(actionLedgerTable.actionType, "deployment:create"),
        ),
      );

    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].deploymentId).toMatch(/^dep_/);
  });

  it("no actor headers → defaults to system → 201", async () => {
    const res = await request(app)
      .post(`${BASE}/environments/${ENV_ID}/deployments`)
      .send({ packageVersionId: PKGV_ID })
      .expect(201);

    expect(res.body.id).toMatch(/^dep_/);
  });
});

// ── §7  Approval rejection flow ───────────────────────────────────────────────

describe("§7 Approval rejection — act_ cancelled", () => {
  let rejectApprovalId: string;
  let rejectActId: string;

  it("user actor creates approval-gated deployment", async () => {
    const res = await request(app)
      .post(`${BASE}/environments/${ENV_ID}/deployments`)
      .set("X-Actor-Type", "user")
      .set("X-Actor-Id", "carol")
      .send({ packageVersionId: PKGV_ID })
      .expect(202);

    rejectApprovalId = res.body.approvalRequestId as string;
    rejectActId = res.body.actionLedgerEntryId as string;
  });

  it("reviewer rejects approval", async () => {
    const res = await request(app)
      .post(`${BASE}/approvals/${rejectApprovalId}/decision`)
      .send({ decision: "rejected", reviewerId: "manager" })
      .expect(200);

    expect(res.body.status).toBe("rejected");
  });

  it("act_ entry updated to cancelled after rejection", async () => {
    await new Promise((r) => setTimeout(r, 100));
    const [entry] = await db
      .select()
      .from(actionLedgerTable)
      .where(eq(actionLedgerTable.id, rejectActId));

    expect(entry).toBeDefined();
    expect(entry!.status).toBe("cancelled");
  });
});

// ── §8  Action ledger listing ─────────────────────────────────────────────────

describe("§8 Action ledger — listing and filtering", () => {
  it("GET /action-ledger returns entries for the tenant", async () => {
    const res = await request(app)
      .get(`${BASE}/action-ledger`)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    const statuses = res.body.items.map((i: { status: string }) => i.status) as string[];
    const validStatuses = [
      "attempted",
      "blocked",
      "approval_required",
      "approved",
      "executed",
      "cancelled",
      "failed",
    ];
    expect(statuses.every((s) => validStatuses.includes(s))).toBe(true);
  });

  it("filters by status=blocked returns only blocked entries", async () => {
    const res = await request(app)
      .get(`${BASE}/action-ledger?status=blocked`)
      .expect(200);

    expect(res.body.items.every((i: { status: string }) => i.status === "blocked")).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by status=executed returns only executed entries", async () => {
    const res = await request(app)
      .get(`${BASE}/action-ledger?status=executed`)
      .expect(200);

    expect(res.body.items.every((i: { status: string }) => i.status === "executed")).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it("all act_ entries link to a pdec_ record", async () => {
    const entries = await db
      .select()
      .from(actionLedgerTable)
      .where(eq(actionLedgerTable.tenantId, TENANT_ID));

    for (const entry of entries) {
      expect(entry.policyDecisionId).toMatch(/^pdec_/);
    }
  });
});
