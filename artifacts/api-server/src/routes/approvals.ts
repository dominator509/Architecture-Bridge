import { Router, type IRouter } from "express";
import { db, approvalRequestsTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { newApprovalRequestId } from "../lib/ids";
import { emitAuditEvent, auditEventTypes } from "../lib/audit";
import {
  resolveTenantContext,
  requireActiveTenant,
} from "../lib/tenantContext";

const router: IRouter = Router({ mergeParams: true });
const AET = auditEventTypes();
const SYSTEM_ACTOR = { actorId: "system", actorType: "system" as const };

router.use(resolveTenantContext);
router.use(requireActiveTenant);

router.post("/", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { resourceType, resourceId, action, requesterId, requestPayload, expiresAt } =
      req.body as {
        resourceType?: string;
        resourceId?: string;
        action?: string;
        requesterId?: string;
        requestPayload?: Record<string, unknown>;
        expiresAt?: string;
      };

    if (!resourceType || !resourceId || !action || !requesterId) {
      res
        .status(400)
        .json({ error: "resourceType, resourceId, action, and requesterId are required" });
      return;
    }

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

router.get("/", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { status, requesterId, resourceType } = req.query as Record<
      string,
      string | undefined
    >;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const offset = Number(req.query["offset"] ?? 0);

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

router.post("/:approvalId/decision", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { approvalId } = req.params;
    const { decision, reviewerId, decisionPayload } = req.body as {
      decision?: string;
      reviewerId?: string;
      decisionPayload?: Record<string, unknown>;
    };

    if (!decision || !reviewerId) {
      res.status(400).json({ error: "decision and reviewerId are required" });
      return;
    }

    if (decision !== "approved" && decision !== "rejected") {
      res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
      return;
    }

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

    const now = new Date();
    const [updated] = await db
      .update(approvalRequestsTable)
      .set({
        status: decision as "approved" | "rejected",
        reviewerId,
        decisionPayload,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(approvalRequestsTable.id, approvalId))
      .returning();

    await emitAuditEvent({
      tenantId,
      actorId: reviewerId,
      actorType: "user",
      eventType: AET.approval.decided,
      resourceType: "approval_request",
      resourceId: approvalId,
      payload: { decision, resourceType: existing.resourceType, resourceId: existing.resourceId },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
