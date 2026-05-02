import { Router, type IRouter } from "express";
import { db, actionLedgerTable } from "@workspace/db";
import { eq, and, count, gte, desc } from "drizzle-orm";
import {
  resolveTenantContext,
  requireActiveTenant,
} from "../lib/tenantContext";

const router: IRouter = Router({ mergeParams: true });

router.use(resolveTenantContext);
router.use(requireActiveTenant);

router.get("/", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const {
      deploymentId,
      actorId,
      status,
      since,
    } = req.query as Record<string, string | undefined>;
    const limit = Math.min(Number(req.query["limit"] ?? 100), 500);
    const offset = Number(req.query["offset"] ?? 0);

    const conditions = [eq(actionLedgerTable.tenantId, tenantId)];
    if (deploymentId)
      conditions.push(eq(actionLedgerTable.deploymentId, deploymentId));
    if (actorId) conditions.push(eq(actionLedgerTable.actorId, actorId));
    if (status)
      conditions.push(
        eq(
          actionLedgerTable.status,
          status as "pending" | "succeeded" | "failed" | "cancelled",
        ),
      );
    if (since)
      conditions.push(gte(actionLedgerTable.createdAt, new Date(since)));

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
