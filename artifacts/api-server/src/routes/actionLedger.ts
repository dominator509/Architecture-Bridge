/**
 * Action Ledger router.
 *
 * Phase 3: status filter expanded to include new lifecycle values
 * (attempted, blocked, approval_required, approved, executed, cancelled, failed).
 */

import { Router, type IRouter } from "express";
import { db, actionLedgerTable } from "@workspace/db";
import { eq, and, count, gte, desc } from "drizzle-orm";
import {
  resolveTenantContext,
  requireActiveTenant,
} from "../lib/tenantContext";
import { parseDateQueryParam, parsePaginationQuery } from "../lib/queryParams";

const router: IRouter = Router({ mergeParams: true });

router.use(resolveTenantContext);
router.use(requireActiveTenant);

// ── GET /tenants/:tenantId/action-ledger ──────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { deploymentId, actorId, status } = req.query as Record<
      string,
      string | undefined
    >;
    const pagination = parsePaginationQuery(req, res, {
      defaultLimit: 100,
      maxLimit: 500,
    });
    if (!pagination) return;
    const sinceDate = parseDateQueryParam(req, res, "since");
    if (sinceDate === null) return;
    const { limit, offset } = pagination;

    const conditions = [eq(actionLedgerTable.tenantId, tenantId)];
    if (deploymentId)
      conditions.push(eq(actionLedgerTable.deploymentId, deploymentId));
    if (actorId) conditions.push(eq(actionLedgerTable.actorId, actorId));
    if (status)
      conditions.push(
        eq(
          actionLedgerTable.status,
          status as
            | "attempted"
            | "blocked"
            | "approval_required"
            | "approved"
            | "executed"
            | "cancelled"
            | "failed",
        ),
      );
    if (sinceDate) conditions.push(gte(actionLedgerTable.createdAt, sinceDate));

    const where = and(...conditions);

    const [items, [{ total }]] = await Promise.all([
      db
        .select()
        .from(actionLedgerTable)
        .where(where)
        .orderBy(desc(actionLedgerTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(actionLedgerTable).where(where),
    ]);

    res.json({ items, total: Number(total), limit, offset });
  } catch (err) {
    next(err);
  }
});

export default router;
