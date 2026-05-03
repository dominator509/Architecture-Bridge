/**
 * Deployments router.
 *
 * Phase 3 hardening on POST /environments/:environmentId/deployments:
 *   1. Read actor from X-Actor-Id / X-Actor-Type request headers.
 *      Default: system (backwards-compatible for callers that omit headers).
 *   2. Evaluate policy → store pdec_ record.
 *   3. Write action_ledger entry (status: attempted) linked to pdec_.
 *   4. Branch on outcome:
 *        allow             → create deployment, update act_ to executed, 201
 *        deny              → update act_ to blocked, 403
 *        require_approval  → create apr_, update act_ to approval_required, 202
 *        require_escalation→ same as require_approval with escalation flag, 202
 *   5. Emit audit event for every branch.
 */

import { Router, type IRouter } from "express";
import {
  db,
  deploymentsTable,
  environmentsTable,
  packageVersionsTable,
  configSnapshotsTable,
  actionLedgerTable,
  approvalRequestsTable,
} from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import {
  newDeploymentId,
  newConfigSnapshotId,
  newActionLedgerId,
  newApprovalRequestId,
} from "../lib/ids";
import { emitAuditEvent, auditEventTypes } from "../lib/audit";
import { evaluatePolicy, storePolicyDecision } from "../lib/policy";
import {
  CreateDeploymentBody,
  UpdateDeploymentBody,
  CreateConfigSnapshotBody,
  parseBody,
} from "../lib/validation";
import {
  resolveTenantContext,
  requireActiveTenant,
} from "../lib/tenantContext";
import { resolveActor } from "../lib/actorContext";

const router: IRouter = Router({ mergeParams: true });
const AET = auditEventTypes();
const SYSTEM_ACTOR = { actorId: "system", actorType: "system" as const };

router.use(resolveTenantContext);
router.use(requireActiveTenant);

// ── GET /tenants/:tenantId/deployments ────────────────────────────────────────
router.get("/deployments", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const status = req.query["status"] as string | undefined;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const offset = Number(req.query["offset"] ?? 0);

    const conditions = [eq(deploymentsTable.tenantId, tenantId)];
    if (status) {
      conditions.push(
        eq(
          deploymentsTable.status,
          status as "pending" | "active" | "failed" | "stopped",
        ),
      );
    }
    const where = and(...conditions);

    const [items, [{ total }]] = await Promise.all([
      db
        .select()
        .from(deploymentsTable)
        .where(where)
        .orderBy(desc(deploymentsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(deploymentsTable).where(where),
    ]);

    res.json({ items, total: Number(total), limit, offset });
  } catch (err) {
    next(err);
  }
});

// ── POST /tenants/:tenantId/environments/:environmentId/deployments ────────────
// Phase 3 protected mutation: policy evaluation required before execution.
router.post(
  "/environments/:environmentId/deployments",
  async (req, res, next) => {
    try {
      const tenantId = res.locals.tenantId!;
      const { environmentId } = req.params;
      const body = parseBody(CreateDeploymentBody, req.body, res);
      if (!body) return;
      const { packageVersionId, metadata } = body;

      // ── 1. Resolve actor identity from request headers ──────────────────────
      const { actorId, actorType } = resolveActor(req);

      // ── 2. Validate environment + package version belong to this tenant ─────
      const [env] = await db
        .select({ id: environmentsTable.id })
        .from(environmentsTable)
        .where(
          and(
            eq(environmentsTable.id, environmentId),
            eq(environmentsTable.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!env) {
        res.status(404).json({ error: "Environment not found" });
        return;
      }

      const [pkgVersion] = await db
        .select({ id: packageVersionsTable.id })
        .from(packageVersionsTable)
        .where(
          and(
            eq(packageVersionsTable.id, packageVersionId),
            eq(packageVersionsTable.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!pkgVersion) {
        res.status(404).json({ error: "Package version not found" });
        return;
      }

      // ── 3. Evaluate policy ──────────────────────────────────────────────────
      const policyResult = evaluatePolicy({
        principal: { id: actorId, type: actorType },
        action: "deployment:create",
        resource: { type: "environment", id: environmentId },
      });

      // ── 4. Persist policy decision (pdec_) ──────────────────────────────────
      const policyDecisionId = await storePolicyDecision({
        tenantId,
        principal: { id: actorId, type: actorType },
        action: "deployment:create",
        resource: { type: "environment", id: environmentId },
        result: policyResult,
        context: { packageVersionId },
      });

      await emitAuditEvent({
        tenantId,
        actorId,
        actorType,
        eventType: AET.policyDecision.stored,
        resourceType: "policy_decision",
        resourceId: policyDecisionId,
        payload: {
          action: "deployment:create",
          outcome: policyResult.outcome,
          matchedRule: policyResult.matchedRule,
        },
      });

      // ── 5. Write initial action ledger entry (act_) ─────────────────────────
      const actionLedgerId = newActionLedgerId();
      await db.insert(actionLedgerTable).values({
        id: actionLedgerId,
        tenantId,
        actionType: "deployment:create",
        actorId,
        actorType,
        status: "attempted",
        policyDecisionId,
        requestPayload: { environmentId, packageVersionId },
      });

      await emitAuditEvent({
        tenantId,
        actorId,
        actorType,
        eventType: AET.actionLedger.written,
        resourceType: "action_ledger_entry",
        resourceId: actionLedgerId,
        payload: { actionType: "deployment:create", status: "attempted" },
      });

      // ── 6. Branch on policy outcome ─────────────────────────────────────────

      // DENY
      if (policyResult.outcome === "deny") {
        await db
          .update(actionLedgerTable)
          .set({ status: "blocked", completedAt: new Date() })
          .where(eq(actionLedgerTable.id, actionLedgerId));

        await emitAuditEvent({
          tenantId,
          actorId,
          actorType,
          eventType: AET.deployment.blocked,
          resourceType: "environment",
          resourceId: environmentId,
          payload: {
            reason: policyResult.reason,
            policyDecisionId,
            actionLedgerEntryId: actionLedgerId,
          },
        });

        res.status(403).json({
          error: "Policy denied",
          code: "POLICY_DENIED",
          reason: policyResult.reason,
          matchedRule: policyResult.matchedRule,
          policyDecisionId,
          actionLedgerEntryId: actionLedgerId,
        });
        return;
      }

      // REQUIRE_APPROVAL or REQUIRE_ESCALATION
      if (
        policyResult.outcome === "require_approval" ||
        policyResult.outcome === "require_escalation"
      ) {
        const approvalId = newApprovalRequestId();
        const [approvalRequest] = await db
          .insert(approvalRequestsTable)
          .values({
            id: approvalId,
            tenantId,
            resourceType: "environment",
            resourceId: environmentId,
            action: "deployment:create",
            requesterId: actorId,
            requestPayload: { packageVersionId, metadata: metadata ?? {} },
            actionLedgerEntryId: actionLedgerId,
            status: "pending",
          })
          .returning();

        await db
          .update(actionLedgerTable)
          .set({ status: "approval_required", approvalRequestId: approvalId })
          .where(eq(actionLedgerTable.id, actionLedgerId));

        await emitAuditEvent({
          tenantId,
          actorId,
          actorType,
          eventType: AET.deployment.approvalRequired,
          resourceType: "approval_request",
          resourceId: approvalId,
          payload: {
            outcome: policyResult.outcome,
            environmentId,
            packageVersionId,
            policyDecisionId,
            actionLedgerEntryId: actionLedgerId,
          },
        });

        res.status(202).json({
          message:
            policyResult.outcome === "require_escalation"
              ? "Escalation required before deployment can proceed"
              : "Approval required before deployment can proceed",
          outcome: policyResult.outcome,
          approvalRequestId: approvalId,
          approvalRequest,
          actionLedgerEntryId: actionLedgerId,
          policyDecisionId,
        });
        return;
      }

      // ALLOW — create the deployment
      const id = newDeploymentId();
      const [deployment] = await db
        .insert(deploymentsTable)
        .values({
          id,
          environmentId,
          packageVersionId,
          tenantId,
          status: "pending",
          metadata: metadata ?? {},
        })
        .returning();

      await db
        .update(actionLedgerTable)
        .set({
          status: "executed",
          deploymentId: id,
          completedAt: new Date(),
          responsePayload: { deploymentId: id },
        })
        .where(eq(actionLedgerTable.id, actionLedgerId));

      await emitAuditEvent({
        tenantId,
        actorId,
        actorType,
        eventType: AET.deployment.created,
        resourceType: "deployment",
        resourceId: id,
        payload: {
          environmentId,
          packageVersionId,
          policyDecisionId,
          actionLedgerEntryId: actionLedgerId,
        },
      });

      res.status(201).json(deployment);
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /tenants/:tenantId/environments/:environmentId/deployments ─────────────
router.get(
  "/environments/:environmentId/deployments",
  async (req, res, next) => {
    try {
      const tenantId = res.locals.tenantId!;
      const { environmentId } = req.params;
      const status = req.query["status"] as string | undefined;
      const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
      const offset = Number(req.query["offset"] ?? 0);

      const conditions = [
        eq(deploymentsTable.environmentId, environmentId),
        eq(deploymentsTable.tenantId, tenantId),
      ];
      if (status) {
        conditions.push(
          eq(
            deploymentsTable.status,
            status as "pending" | "active" | "failed" | "stopped",
          ),
        );
      }
      const where = and(...conditions);

      const [items, [{ total }]] = await Promise.all([
        db
          .select()
          .from(deploymentsTable)
          .where(where)
          .orderBy(desc(deploymentsTable.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(deploymentsTable).where(where),
      ]);

      res.json({ items, total: Number(total), limit, offset });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /tenants/:tenantId/deployments/:deploymentId ──────────────────────────
router.get("/deployments/:deploymentId", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { deploymentId } = req.params;

    const [deployment] = await db
      .select()
      .from(deploymentsTable)
      .where(
        and(
          eq(deploymentsTable.id, deploymentId),
          eq(deploymentsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }
    res.json(deployment);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /tenants/:tenantId/deployments/:deploymentId ────────────────────────
// Phase 3 hardening: status transitions are policy-gated.
// Metadata-only updates bypass the policy gate (non-sensitive change).
router.patch("/deployments/:deploymentId", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { deploymentId } = req.params;
    const body = parseBody(UpdateDeploymentBody, req.body, res);
    if (!body) return;
    const { status, metadata } = body;

    // ── Actor identity from request headers (with privilege-escalation guard) ─
    const { actorId, actorType } = resolveActor(req);

    // ── Fetch existing deployment (needed for policy gate + audit delta) ─────
    const [existing] = await db
      .select()
      .from(deploymentsTable)
      .where(
        and(
          eq(deploymentsTable.id, deploymentId),
          eq(deploymentsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    // ── Policy gate: only for status transitions, not metadata-only updates ──
    if (status !== undefined && status !== existing.status) {
      const policyResult = evaluatePolicy({
        principal: { id: actorId, type: actorType },
        action: "deployment:status_update",
        resource: { type: "deployment", id: deploymentId },
      });

      const policyDecisionId = await storePolicyDecision({
        tenantId,
        principal: { id: actorId, type: actorType },
        action: "deployment:status_update",
        resource: { type: "deployment", id: deploymentId },
        result: policyResult,
        context: { fromStatus: existing.status, toStatus: status },
      });

      await emitAuditEvent({
        tenantId,
        actorId,
        actorType,
        eventType: AET.policyDecision.stored,
        resourceType: "policy_decision",
        resourceId: policyDecisionId,
        payload: {
          action: "deployment:status_update",
          outcome: policyResult.outcome,
          matchedRule: policyResult.matchedRule,
        },
      });

      const actionLedgerId = newActionLedgerId();
      await db.insert(actionLedgerTable).values({
        id: actionLedgerId,
        tenantId,
        actionType: "deployment:status_update",
        actorId,
        actorType,
        status: "attempted",
        policyDecisionId,
        deploymentId,
        requestPayload: {
          deploymentId,
          fromStatus: existing.status,
          toStatus: status,
        },
      });

      await emitAuditEvent({
        tenantId,
        actorId,
        actorType,
        eventType: AET.actionLedger.written,
        resourceType: "action_ledger_entry",
        resourceId: actionLedgerId,
        payload: { actionType: "deployment:status_update", status: "attempted" },
      });

      // DENY
      if (policyResult.outcome === "deny") {
        await db
          .update(actionLedgerTable)
          .set({ status: "blocked", completedAt: new Date() })
          .where(eq(actionLedgerTable.id, actionLedgerId));

        await emitAuditEvent({
          tenantId,
          actorId,
          actorType,
          eventType: AET.deployment.statusUpdateBlocked,
          resourceType: "deployment",
          resourceId: deploymentId,
          payload: {
            reason: policyResult.reason,
            policyDecisionId,
            actionLedgerEntryId: actionLedgerId,
          },
        });

        res.status(403).json({
          error: "Policy denied",
          code: "POLICY_DENIED",
          reason: policyResult.reason,
          matchedRule: policyResult.matchedRule,
          policyDecisionId,
          actionLedgerEntryId: actionLedgerId,
        });
        return;
      }

      // REQUIRE_APPROVAL or REQUIRE_ESCALATION
      if (
        policyResult.outcome === "require_approval" ||
        policyResult.outcome === "require_escalation"
      ) {
        const approvalId = newApprovalRequestId();
        const [approvalRequest] = await db
          .insert(approvalRequestsTable)
          .values({
            id: approvalId,
            tenantId,
            resourceType: "deployment",
            resourceId: deploymentId,
            action: "deployment:status_update",
            requesterId: actorId,
            requestPayload: {
              fromStatus: existing.status,
              toStatus: status,
              metadata: metadata ?? {},
            },
            actionLedgerEntryId: actionLedgerId,
            status: "pending",
          })
          .returning();

        await db
          .update(actionLedgerTable)
          .set({ status: "approval_required", approvalRequestId: approvalId })
          .where(eq(actionLedgerTable.id, actionLedgerId));

        await emitAuditEvent({
          tenantId,
          actorId,
          actorType,
          eventType: AET.deployment.statusUpdateApprovalRequired,
          resourceType: "approval_request",
          resourceId: approvalId,
          payload: {
            outcome: policyResult.outcome,
            deploymentId,
            fromStatus: existing.status,
            toStatus: status,
            policyDecisionId,
            actionLedgerEntryId: actionLedgerId,
          },
        });

        res.status(202).json({
          message:
            policyResult.outcome === "require_escalation"
              ? "Escalation required before status update can proceed"
              : "Approval required before status update can proceed",
          outcome: policyResult.outcome,
          approvalRequestId: approvalId,
          approvalRequest,
          actionLedgerEntryId: actionLedgerId,
          policyDecisionId,
        });
        return;
      }

      // ALLOW — mark act_ as executed before applying the update
      await db
        .update(actionLedgerTable)
        .set({
          status: "executed",
          completedAt: new Date(),
          responsePayload: {
            deploymentId,
            fromStatus: existing.status,
            toStatus: status,
          },
        })
        .where(eq(actionLedgerTable.id, actionLedgerId));
    }

    // ── Apply the update ─────────────────────────────────────────────────────
    const updates: Partial<typeof deploymentsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (status !== undefined)
      updates.status = status as "pending" | "active" | "failed" | "stopped";
    if (metadata !== undefined) updates.metadata = metadata;

    const [updated] = await db
      .update(deploymentsTable)
      .set(updates)
      .where(
        and(
          eq(deploymentsTable.id, deploymentId),
          eq(deploymentsTable.tenantId, tenantId),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    await emitAuditEvent({
      tenantId,
      actorId,
      actorType,
      eventType: AET.deployment.statusUpdated,
      resourceType: "deployment",
      resourceId: deploymentId,
      payload: updates,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── Config Snapshot routes ─────────────────────────────────────────────────────

router.post(
  "/deployments/:deploymentId/config-snapshot",
  async (req, res, next) => {
    try {
      const tenantId = res.locals.tenantId!;
      const { deploymentId } = req.params;
      const body = parseBody(CreateConfigSnapshotBody, req.body, res);
      if (!body) return;
      const { configOverrides, schemaVersion } = body;

      const [deployment] = await db
        .select()
        .from(deploymentsTable)
        .where(
          and(
            eq(deploymentsTable.id, deploymentId),
            eq(deploymentsTable.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!deployment) {
        res.status(404).json({ error: "Deployment not found" });
        return;
      }

      const [pkgVersion] = await db
        .select({ manifest: packageVersionsTable.manifest })
        .from(packageVersionsTable)
        .where(eq(packageVersionsTable.id, deployment.packageVersionId))
        .limit(1);

      const resolvedConfig = {
        ...(pkgVersion?.manifest ?? {}),
        ...(configOverrides ?? {}),
      };

      const id = newConfigSnapshotId();
      const [snapshot] = await db
        .insert(configSnapshotsTable)
        .values({
          id,
          deploymentId,
          tenantId,
          resolvedConfig,
          schemaVersion: schemaVersion ?? "1.0",
        })
        .returning();

      await db
        .update(deploymentsTable)
        .set({ configSnapshotId: id, updatedAt: new Date() })
        .where(eq(deploymentsTable.id, deploymentId));

      await emitAuditEvent({
        tenantId,
        ...SYSTEM_ACTOR,
        eventType: AET.configSnapshot.resolved,
        resourceType: "config_snapshot",
        resourceId: id,
        payload: { deploymentId, schemaVersion: schemaVersion ?? "1.0" },
      });

      res.status(201).json(snapshot);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/deployments/:deploymentId/config-snapshot",
  async (req, res, next) => {
    try {
      const tenantId = res.locals.tenantId!;
      const { deploymentId } = req.params;

      const [snapshot] = await db
        .select()
        .from(configSnapshotsTable)
        .where(
          and(
            eq(configSnapshotsTable.deploymentId, deploymentId),
            eq(configSnapshotsTable.tenantId, tenantId),
          ),
        )
        .orderBy(desc(configSnapshotsTable.createdAt))
        .limit(1);

      if (!snapshot) {
        res
          .status(404)
          .json({ error: "No config snapshot found for this deployment" });
        return;
      }
      res.json(snapshot);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
