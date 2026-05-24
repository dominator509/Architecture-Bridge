/**
 * Approvals router.
 *
 * Phase 3 hardening on POST /:approvalId/decision:
 *   1. Self-approval prevention: reviewerId must differ from requesterId.
 *      A self-approve attempt emits an audit event and returns 403.
 *   2. On approved/rejected decision: resumes or cancels the linked action
 *      (via actionLedgerEntryId) and records the final ledger status.
 *   3. Emits audit event for every decision (including failed self-approve).
 *
 * Phase 4: Zod validation on all request bodies.
 */

import { Router, type IRouter } from "express";
import {
  db,
  approvalRequestsTable,
  actionLedgerTable,
  deploymentsTable,
  environmentsTable,
  packageVersionsTable,
} from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { newApprovalRequestId, newDeploymentId } from "../lib/ids";
import { emitAuditEvent, auditEventTypes } from "../lib/audit";
import {
  resolveTenantContext,
  requireActiveTenant,
} from "../lib/tenantContext";
import {
  CreateApprovalBody,
  ApprovalDecisionBody,
  parseBody,
} from "../lib/validation";
import {
  applyRuntimeLifecycleForStatus,
  type DeploymentStatus,
} from "../lib/runtimeLifecycle";
import { parsePaginationQuery } from "../lib/queryParams";

const router: IRouter = Router({ mergeParams: true });
const AET = auditEventTypes();

type ApprovalRequestRow = typeof approvalRequestsTable.$inferSelect;

interface ApprovedExecutionResult {
  status: "approved" | "executed" | "failed";
  deploymentId?: string;
  responsePayload: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

async function executeApprovedAction({
  tenantId,
  approval,
  reviewerId,
  decidedAt,
}: {
  tenantId: string;
  approval: ApprovalRequestRow;
  reviewerId: string;
  decidedAt: Date;
}): Promise<ApprovedExecutionResult> {
  const payload = asRecord(approval.requestPayload);

  if (
    approval.action === "deployment:create" &&
    approval.resourceType === "environment"
  ) {
    const packageVersionId = readString(payload, "packageVersionId");
    if (!packageVersionId) {
      return {
        status: "failed",
        responsePayload: {
          decision: "approved",
          reviewerId,
          decidedAt: decidedAt.toISOString(),
          error: "Missing packageVersionId in approval payload",
        },
      };
    }

    const deploymentId = newDeploymentId();
    const metadata = asRecord(payload["metadata"]);

    const [environment] = await db
      .select({ id: environmentsTable.id })
      .from(environmentsTable)
      .where(
        and(
          eq(environmentsTable.id, approval.resourceId),
          eq(environmentsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!environment) {
      return {
        status: "failed",
        responsePayload: {
          decision: "approved",
          reviewerId,
          decidedAt: decidedAt.toISOString(),
          error: "Environment not found",
        },
      };
    }

    const [packageVersion] = await db
      .select({ id: packageVersionsTable.id })
      .from(packageVersionsTable)
      .where(
        and(
          eq(packageVersionsTable.id, packageVersionId),
          eq(packageVersionsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!packageVersion) {
      return {
        status: "failed",
        responsePayload: {
          decision: "approved",
          reviewerId,
          decidedAt: decidedAt.toISOString(),
          error: "Package version not found",
        },
      };
    }

    await db.insert(deploymentsTable).values({
      id: deploymentId,
      tenantId,
      environmentId: approval.resourceId,
      packageVersionId,
      status: "pending",
      metadata,
    });

    await emitAuditEvent({
      tenantId,
      actorId: reviewerId,
      actorType: "user",
      eventType: AET.deployment.created,
      resourceType: "deployment",
      resourceId: deploymentId,
      payload: {
        approvedFromRequest: approval.id,
        environmentId: approval.resourceId,
        packageVersionId,
      },
    });

    return {
      status: "executed",
      deploymentId,
      responsePayload: {
        decision: "approved",
        reviewerId,
        decidedAt: decidedAt.toISOString(),
        deploymentId,
        executedAfterApproval: true,
      },
    };
  }

  if (
    approval.action === "deployment:status_update" &&
    approval.resourceType === "deployment"
  ) {
    const toStatus = readString(payload, "toStatus") as
      | DeploymentStatus
      | undefined;

    if (!toStatus) {
      return {
        status: "failed",
        deploymentId: approval.resourceId,
        responsePayload: {
          decision: "approved",
          reviewerId,
          decidedAt: decidedAt.toISOString(),
          error: "Missing toStatus in approval payload",
        },
      };
    }

    const [existingDeployment] = await db
      .select()
      .from(deploymentsTable)
      .where(
        and(
          eq(deploymentsTable.id, approval.resourceId),
          eq(deploymentsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!existingDeployment) {
      return {
        status: "failed",
        deploymentId: approval.resourceId,
        responsePayload: {
          decision: "approved",
          reviewerId,
          decidedAt: decidedAt.toISOString(),
          error: "Deployment not found",
        },
      };
    }

    const hasExplicitMetadata = payload["metadata"] !== undefined;
    const baseMetadata = hasExplicitMetadata
      ? asRecord(payload["metadata"])
      : existingDeployment.metadata;
    let lifecycle:
      | Awaited<ReturnType<typeof applyRuntimeLifecycleForStatus>>
      | undefined;

    if (toStatus !== existingDeployment.status) {
      try {
        lifecycle = await applyRuntimeLifecycleForStatus({
          metadata: baseMetadata,
          status: toStatus,
          now: decidedAt,
        });
      } catch (err) {
        const details = err instanceof Error ? err.message : "Unknown error";

        await emitAuditEvent({
          tenantId,
          actorId: reviewerId,
          actorType: "user",
          eventType: AET.runtime.lifecycleFailed,
          resourceType: "deployment",
          resourceId: approval.resourceId,
          payload: {
            approvedFromRequest: approval.id,
            fromStatus: existingDeployment.status,
            toStatus,
            error: details,
          },
        });

        return {
          status: "failed",
          deploymentId: approval.resourceId,
          responsePayload: {
            decision: "approved",
            reviewerId,
            decidedAt: decidedAt.toISOString(),
            deploymentId: approval.resourceId,
            toStatus,
            error: "Runtime lifecycle update failed",
            details,
          },
        };
      }
    }

    const updates: Partial<typeof deploymentsTable.$inferInsert> = {
      status: toStatus,
      updatedAt: decidedAt,
    };
    if (lifecycle?.runtimeChanged) {
      updates.metadata = lifecycle.metadata;
    } else if (hasExplicitMetadata) {
      updates.metadata = asRecord(payload["metadata"]);
    }

    const [deployment] = await db
      .update(deploymentsTable)
      .set(updates)
      .where(
        and(
          eq(deploymentsTable.id, approval.resourceId),
          eq(deploymentsTable.tenantId, tenantId),
        ),
      )
      .returning({ id: deploymentsTable.id });

    if (!deployment) {
      return {
        status: "failed",
        deploymentId: approval.resourceId,
        responsePayload: {
          decision: "approved",
          reviewerId,
          decidedAt: decidedAt.toISOString(),
          error: "Deployment not found",
        },
      };
    }

    if (lifecycle?.runtimeChanged) {
      await emitAuditEvent({
        tenantId,
        actorId: reviewerId,
        actorType: "user",
        eventType: AET.runtime.lifecycleUpdated,
        resourceType: "deployment",
        resourceId: approval.resourceId,
        payload: {
          approvedFromRequest: approval.id,
          fromStatus: existingDeployment.status,
          toStatus,
          runtimeAction: lifecycle.action,
          runtime: lifecycle.runtime,
        },
      });
    }

    await emitAuditEvent({
      tenantId,
      actorId: reviewerId,
      actorType: "user",
      eventType: AET.deployment.statusUpdated,
      resourceType: "deployment",
      resourceId: approval.resourceId,
      payload: {
        approvedFromRequest: approval.id,
        ...updates,
      },
    });

    return {
      status: "executed",
      deploymentId: approval.resourceId,
      responsePayload: {
        decision: "approved",
        reviewerId,
        decidedAt: decidedAt.toISOString(),
        deploymentId: approval.resourceId,
        toStatus,
        executedAfterApproval: true,
        ...(lifecycle?.runtimeChanged
          ? {
              runtimeAction: lifecycle.action,
              runtime: lifecycle.runtime,
            }
          : {}),
      },
    };
  }

  return {
    status: "approved",
    responsePayload: {
      decision: "approved",
      reviewerId,
      decidedAt: decidedAt.toISOString(),
      executionSkipped: true,
      reason: "No executable handler for approval action",
    },
  };
}

router.use(resolveTenantContext);
router.use(requireActiveTenant);

// ── POST /tenants/:tenantId/approvals ──────────────────────────────────────────
router.post("/", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const body = parseBody(CreateApprovalBody, req.body, res);
    if (!body) return;
    const {
      resourceType,
      resourceId,
      action,
      requesterId,
      requestPayload,
      expiresAt,
    } = body;

    const id = newApprovalRequestId();
    const [approval] = await db
      .insert(approvalRequestsTable)
      .values({
        id,
        tenantId,
        resourceType,
        resourceId,
        action,
        requesterId,
        requestPayload,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        status: "pending",
      })
      .returning();

    await emitAuditEvent({
      tenantId,
      actorId: requesterId,
      actorType: "user",
      eventType: AET.approval.created,
      resourceType: "approval_request",
      resourceId: id,
      payload: { resourceType, resourceId, action },
    });

    res.status(201).json(approval);
  } catch (err) {
    next(err);
  }
});

// ── GET /tenants/:tenantId/approvals ───────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { status, requesterId, resourceType } = req.query as Record<
      string,
      string | undefined
    >;
    const pagination = parsePaginationQuery(req, res, {
      defaultLimit: 50,
      maxLimit: 200,
    });
    if (!pagination) return;
    const { limit, offset } = pagination;

    const conditions = [eq(approvalRequestsTable.tenantId, tenantId)];
    if (status)
      conditions.push(
        eq(
          approvalRequestsTable.status,
          status as "pending" | "approved" | "rejected" | "expired",
        ),
      );
    if (requesterId)
      conditions.push(eq(approvalRequestsTable.requesterId, requesterId));
    if (resourceType)
      conditions.push(eq(approvalRequestsTable.resourceType, resourceType));

    const where = and(...conditions);

    const [items, [{ total }]] = await Promise.all([
      db
        .select()
        .from(approvalRequestsTable)
        .where(where)
        .orderBy(desc(approvalRequestsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(approvalRequestsTable).where(where),
    ]);

    res.json({ items, total: Number(total), limit, offset });
  } catch (err) {
    next(err);
  }
});

// ── GET /tenants/:tenantId/approvals/:approvalId ───────────────────────────────
router.get("/:approvalId", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { approvalId } = req.params;

    const [approval] = await db
      .select()
      .from(approvalRequestsTable)
      .where(
        and(
          eq(approvalRequestsTable.id, approvalId),
          eq(approvalRequestsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!approval) {
      res.status(404).json({ error: "Approval request not found" });
      return;
    }
    res.json(approval);
  } catch (err) {
    next(err);
  }
});

// ── POST /tenants/:tenantId/approvals/:approvalId/decision ────────────────────
// Phase 3: self-approval prevention + action ledger update on decision.
router.post("/:approvalId/decision", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { approvalId } = req.params;

    const body = parseBody(ApprovalDecisionBody, req.body, res);
    if (!body) return;
    const { decision, reviewerId, decisionPayload } = body;

    const [existing] = await db
      .select()
      .from(approvalRequestsTable)
      .where(
        and(
          eq(approvalRequestsTable.id, approvalId),
          eq(approvalRequestsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Approval request not found" });
      return;
    }

    if (existing.status !== "pending") {
      res
        .status(409)
        .json({ error: "Decision already recorded", code: "ALREADY_DECIDED" });
      return;
    }

    // ── Phase 3: Self-approval prevention ──────────────────────────────────────
    if (reviewerId === existing.requesterId) {
      await emitAuditEvent({
        tenantId,
        actorId: reviewerId,
        actorType: "user",
        eventType: AET.approval.selfApproveAttempted,
        resourceType: "approval_request",
        resourceId: approvalId,
        payload: {
          reviewerId,
          requesterId: existing.requesterId,
          action: existing.action,
          resourceType: existing.resourceType,
          resourceId: existing.resourceId,
        },
      });

      res.status(403).json({
        error: "Self-approval is not permitted",
        code: "SELF_APPROVAL_DENIED",
        requesterId: existing.requesterId,
      });
      return;
    }

    const now = new Date();
    const [updated] = await db
      .update(approvalRequestsTable)
      .set({
        status: decision,
        reviewerId,
        decisionPayload,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(approvalRequestsTable.id, approvalId))
      .returning();

    // ── Phase 3: Update linked action ledger entry ─────────────────────────────
    if (existing.actionLedgerEntryId) {
      const execution =
        decision === "approved"
          ? await executeApprovedAction({
              tenantId,
              approval: existing,
              reviewerId,
              decidedAt: now,
            })
          : {
              status: "cancelled" as const,
              responsePayload: {
                decision,
                reviewerId,
                decidedAt: now.toISOString(),
              },
            };

      const ledgerUpdate: Partial<typeof actionLedgerTable.$inferInsert> = {
        status: execution.status,
        completedAt: now,
        responsePayload: execution.responsePayload,
      };

      if ("deploymentId" in execution && execution.deploymentId) {
        ledgerUpdate.deploymentId = execution.deploymentId;
      }

      await db
        .update(actionLedgerTable)
        .set(ledgerUpdate)
        .where(eq(actionLedgerTable.id, existing.actionLedgerEntryId));

      await emitAuditEvent({
        tenantId,
        actorId: reviewerId,
        actorType: "user",
        eventType: AET.actionLedger.written,
        resourceType: "action_ledger_entry",
        resourceId: existing.actionLedgerEntryId,
        payload: { status: execution.status, approvalId },
      });
    }

    await emitAuditEvent({
      tenantId,
      actorId: reviewerId,
      actorType: "user",
      eventType: AET.approval.decided,
      resourceType: "approval_request",
      resourceId: approvalId,
      payload: {
        decision,
        resourceType: existing.resourceType,
        resourceId: existing.resourceId,
        actionLedgerEntryId: existing.actionLedgerEntryId,
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
