import { Router, type IRouter } from "express";
import { db, workspacesTable, tenantsTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { newWorkspaceId } from "../lib/ids";
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
    const { name, slug, metadata } = req.body as {
      name?: string;
      slug?: string;
      metadata?: Record<string, unknown>;
    };

    if (!name || !slug) {
      res.status(400).json({ error: "name and slug are required" });
      return;
    }

    const existing = await db
      .select({ id: workspacesTable.id })
      .from(workspacesTable)
      .where(
        and(
          eq(workspacesTable.tenantId, tenantId),
          eq(workspacesTable.slug, slug),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      res
        .status(409)
        .json({ error: "Slug already taken within this tenant", code: "SLUG_CONFLICT" });
      return;
    }

    const id = newWorkspaceId();
    const [workspace] = await db
      .insert(workspacesTable)
      .values({ id, tenantId, name, slug, metadata: metadata ?? {} })
      .returning();

    await emitAuditEvent({
      tenantId,
      ...SYSTEM_ACTOR,
      eventType: AET.workspace.created,
      resourceType: "workspace",
      resourceId: id,
      payload: { name, slug },
    });

    res.status(201).json(workspace);
  } catch (err) {
    next(err);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const status = req.query["status"] as string | undefined;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const offset = Number(req.query["offset"] ?? 0);

    const conditions = [eq(workspacesTable.tenantId, tenantId)];
    if (status) {
      conditions.push(
        eq(workspacesTable.status, status as "active" | "archived"),
      );
    }
    const where = and(...conditions);

    const [items, [{ total }]] = await Promise.all([
      db
        .select()
        .from(workspacesTable)
        .where(where)
        .orderBy(workspacesTable.createdAt)
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(workspacesTable).where(where),
    ]);

    res.json({ items, total: Number(total), limit, offset });
  } catch (err) {
    next(err);
  }
});

router.get("/:workspaceId", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { workspaceId } = req.params;

    const [workspace] = await db
      .select()
      .from(workspacesTable)
      .where(
        and(
          eq(workspacesTable.id, workspaceId),
          eq(workspacesTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!workspace) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }
    res.json(workspace);
  } catch (err) {
    next(err);
  }
});

router.patch("/:workspaceId", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { workspaceId } = req.params;
    const { name, status, metadata } = req.body as {
      name?: string;
      status?: string;
      metadata?: Record<string, unknown>;
    };

    const updates: Partial<typeof workspacesTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (name !== undefined) updates.name = name;
    if (status !== undefined)
      updates.status = status as "active" | "archived";
    if (metadata !== undefined) updates.metadata = metadata;

    const [updated] = await db
      .update(workspacesTable)
      .set(updates)
      .where(
        and(
          eq(workspacesTable.id, workspaceId),
          eq(workspacesTable.tenantId, tenantId),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }

    await emitAuditEvent({
      tenantId,
      ...SYSTEM_ACTOR,
      eventType: AET.workspace.updated,
      resourceType: "workspace",
      resourceId: workspaceId,
      payload: updates,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
