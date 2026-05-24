import { Router, type IRouter } from "express";
import { db, environmentsTable, workspacesTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { newEnvironmentId } from "../lib/ids";
import { emitAuditEvent, auditEventTypes } from "../lib/audit";
import {
  resolveTenantContext,
  requireActiveTenant,
} from "../lib/tenantContext";
import {
  CreateEnvironmentBody,
  UpdateEnvironmentBody,
  parseBody,
} from "../lib/validation";
import { parsePaginationQuery } from "../lib/queryParams";

const router: IRouter = Router({ mergeParams: true });
const AET = auditEventTypes();
const SYSTEM_ACTOR = { actorId: "system", actorType: "system" as const };

router.use(resolveTenantContext);
router.use(requireActiveTenant);

router.post("/", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const params = req.params as Record<string, string>;
    const workspaceId = params["workspaceId"]!;

    const body = parseBody(CreateEnvironmentBody, req.body, res);
    if (!body) return;
    const { name, slug, type, metadata } = body;

    const [ws] = await db
      .select({ id: workspacesTable.id })
      .from(workspacesTable)
      .where(
        and(
          eq(workspacesTable.id, workspaceId),
          eq(workspacesTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!ws) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }

    const existing = await db
      .select({ id: environmentsTable.id })
      .from(environmentsTable)
      .where(
        and(
          eq(environmentsTable.workspaceId, workspaceId),
          eq(environmentsTable.slug, slug),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      res
        .status(409)
        .json({ error: "Slug already taken within this workspace", code: "SLUG_CONFLICT" });
      return;
    }

    const id = newEnvironmentId();
    const [environment] = await db
      .insert(environmentsTable)
      .values({
        id,
        workspaceId,
        tenantId,
        name,
        slug,
        type,
        metadata: metadata ?? {},
      })
      .returning();

    await emitAuditEvent({
      tenantId,
      ...SYSTEM_ACTOR,
      eventType: AET.environment.created,
      resourceType: "environment",
      resourceId: id,
      payload: { name, slug, type, workspaceId },
    });

    res.status(201).json(environment);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const params = req.params as Record<string, string>;
    const workspaceId = params["workspaceId"]!;
    const type = req.query["type"] as string | undefined;
    const pagination = parsePaginationQuery(req, res, {
      defaultLimit: 50,
      maxLimit: 200,
    });
    if (!pagination) return;
    const { limit, offset } = pagination;

    const conditions = [
      eq(environmentsTable.workspaceId, workspaceId),
      eq(environmentsTable.tenantId, tenantId),
    ];
    if (type) {
      conditions.push(
        eq(
          environmentsTable.type,
          type as "development" | "staging" | "production",
        ),
      );
    }
    const where = and(...conditions);

    const [items, [{ total }]] = await Promise.all([
      db
        .select()
        .from(environmentsTable)
        .where(where)
        .orderBy(environmentsTable.createdAt)
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(environmentsTable).where(where),
    ]);

    res.json({ items, total: Number(total), limit, offset });
  } catch (err) {
    next(err);
  }
});

router.get("/:environmentId", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const params = req.params as Record<string, string>;
    const workspaceId = params["workspaceId"]!;
    const environmentId = params["environmentId"]!;

    const [environment] = await db
      .select()
      .from(environmentsTable)
      .where(
        and(
          eq(environmentsTable.id, environmentId),
          eq(environmentsTable.workspaceId, workspaceId),
          eq(environmentsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!environment) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }
    res.json(environment);
  } catch (err) {
    next(err);
  }
});

router.patch("/:environmentId", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const params = req.params as Record<string, string>;
    const workspaceId = params["workspaceId"]!;
    const environmentId = params["environmentId"]!;

    const body = parseBody(UpdateEnvironmentBody, req.body, res);
    if (!body) return;
    const { name, status, metadata } = body;

    const updates: Partial<typeof environmentsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (name !== undefined) updates.name = name;
    if (status !== undefined) updates.status = status;
    if (metadata !== undefined) updates.metadata = metadata;

    const [updated] = await db
      .update(environmentsTable)
      .set(updates)
      .where(
        and(
          eq(environmentsTable.id, environmentId),
          eq(environmentsTable.workspaceId, workspaceId),
          eq(environmentsTable.tenantId, tenantId),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Environment not found" });
      return;
    }

    await emitAuditEvent({
      tenantId,
      ...SYSTEM_ACTOR,
      eventType: AET.environment.updated,
      resourceType: "environment",
      resourceId: environmentId,
      payload: updates,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
