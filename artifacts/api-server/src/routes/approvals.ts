/**
 * Approvals router.
 *
 * Phase 3 hardening on POST /:approvalId/decision:
 *   1. Self-approval prevention: reviewerId must differ from requesterId.
 *      A self-approve attempt emits an audit event and returns 403.
 *   2. On approved/rejected decision: updates the linked action_ledger entry
 *      (via actionLedgerEntryId) to "approved" or "cancelled".
 *   3. Emits audit event for every decision (including failed self-approve).
 */

import { Router, type IRouter } from "express";
import { db, approvalRequestsTable, actionLedgerTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { newApprovalRequestId } from "../lib/ids";
import { emitAuditEvent, auditEventTypes } from "../lib/audit";
import {
  resolveTenantContext,
  requireActiveTenant,
} from "../lib/tenantContext";

const router: IRouter = Router({ mergeParams: true });
const AET = auditEventTypes();

router.use(resolveTenantContext);
router.use(requireActiveTenant);

// ── POST /tenants/:tenantId/approvals ──────────────────────────────────────────
router.post("/", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const {
      resourceType,
      resourceId,
      action,
      requesterId,
      requestPayload,
      expiresAt,
    } = req.body as {
      resourceType?: string;
      resourceId?: string;
      action?: string;
      requesterId?: string;
      requestPayload?: Record<string, unknown>;
      expiresAt?: string;
    };

    if (!resourceType || !resourceId || !action || !requesterId) {
      res.status(400).json({
        error: "resourceType, resourceId, action, and requesterId are required",
      });
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

// ── GET /tenants/:tenantId/approvals ───────────────────────────────────────────
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
    const { decision, reviewerId, decisionPayload } = req.body as {
      decision?: string;
      reviewerId?: string;
      decisionPayload?: Record<string, unknown>;
    };

    if (!decision || !reviewerId) {
      res
        .status(400)
        .json({ error: "decision and reviewerId are required" });
      return;
    }

    if (decision !== "approved" && decision !== "rejected") {
      res
        .status(400)
        .json({ error: "decision must be 'approved' or 'rejected'" });
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
        status: decision as "approved" | "rejected",
        reviewerId,
        decisionPayload,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(approvalRequestsTable.id, approvalId))
      .returning();

    // ── Phase 3: Update linked action ledger entry ─────────────────────────────
    if (existing.actionLedgerEntryId) {
      const ledgerStatus =
        decision === "approved" ? "approved" : "cancelled";
      await db
        .update(actionLedgerTable)
        .set({
          status: ledgerStatus,
          completedAt: now,
          responsePayload: {
            decision,
            reviewerId,
            decidedAt: now.toISOString(),
          },
        })
        .where(eq(actionLedgerTable.id, existing.actionLedgerEntryId));

      await emitAuditEvent({
        tenantId,
        actorId: reviewerId,
        actorType: "user",
        eventType: AET.actionLedger.written,
        resourceType: "action_ledger_entry",
        resourceId: existing.actionLedgerEntryId,
        payload: { status: ledgerStatus, approvalId },
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
