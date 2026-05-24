import { Router, type IRouter } from "express";
import { db, auditEventsTable } from "@workspace/db";
import { eq, and, count, gte, lte, desc } from "drizzle-orm";
import {
  resolveTenantContext,
  requireActiveTenant,
} from "../lib/tenantContext";
import { parseDateQueryParam, parsePaginationQuery } from "../lib/queryParams";

const router: IRouter = Router({ mergeParams: true });

router.use(resolveTenantContext);
router.use(requireActiveTenant);

router.get("/", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const {
      resourceType,
      resourceId,
      actorId,
      eventType,
    } = req.query as Record<string, string | undefined>;
    const pagination = parsePaginationQuery(req, res, {
      defaultLimit: 100,
      maxLimit: 500,
    });
    if (!pagination) return;
    const sinceDate = parseDateQueryParam(req, res, "since");
    if (sinceDate === null) return;
    const untilDate = parseDateQueryParam(req, res, "until");
    if (untilDate === null) return;
    const { limit, offset } = pagination;

    const conditions = [eq(auditEventsTable.tenantId, tenantId)];
    if (resourceType)
      conditions.push(eq(auditEventsTable.resourceType, resourceType));
    if (resourceId)
      conditions.push(eq(auditEventsTable.resourceId, resourceId));
    if (actorId) conditions.push(eq(auditEventsTable.actorId, actorId));
    if (eventType) conditions.push(eq(auditEventsTable.eventType, eventType));
    if (sinceDate) conditions.push(gte(auditEventsTable.createdAt, sinceDate));
    if (untilDate) conditions.push(lte(auditEventsTable.createdAt, untilDate));

    const where = and(...conditions);

    const [items, [{ total }]] = await Promise.all([
      db
        .select()
        .from(auditEventsTable)
        .where(where)
        .orderBy(desc(auditEventsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(auditEventsTable).where(where),
    ]);

    res.json({ items, total: Number(total), limit, offset });
  } catch (err) {
    next(err);
  }
});

export default router;
