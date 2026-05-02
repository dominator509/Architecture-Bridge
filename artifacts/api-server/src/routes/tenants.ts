import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tenantsTable } from "@workspace/db";
import { eq, and, sql, count } from "drizzle-orm";
import { newTenantId } from "../lib/ids";
import { emitAuditEvent, auditEventTypes } from "../lib/audit";
import {
  workspacesTable,
  environmentsTable,
  packagesTable,
  deploymentsTable,
  approvalRequestsTable,
  auditEventsTable,
} from "@workspace/db";

const router: IRouter = Router();
const AET = auditEventTypes();

const SYSTEM_ACTOR = { actorId: "system", actorType: "system" as const };

router.post("/tenants", async (req, res, next) => {
  try {
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
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(eq(tenantsTable.slug, slug))
      .limit(1);

    if (existing.length > 0) {
      res
        .status(409)
        .json({ error: "Slug already taken", code: "SLUG_CONFLICT" });
      return;
    }

    const id = newTenantId();
    const [tenant] = await db
      .insert(tenantsTable)
      .values({ id, name, slug, metadata: metadata ?? {} })
      .returning();

    await emitAuditEvent({
      tenantId: id,
      ...SYSTEM_ACTOR,
      eventType: AET.tenant.created,
      resourceType: "tenant",
      resourceId: id,
      payload: { name, slug },
    });

    res.status(201).json(tenant);
  } catch (err) {
    next(err);
  }
});

router.get("/tenants", async (req, res, next) => {
  try {
    const status = req.query["status"] as string | undefined;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const offset = Number(req.query["offset"] ?? 0);

    const where = status
      ? eq(tenantsTable.status, status as "active" | "suspended" | "deleted")
      : undefined;

    const [items, [{ total }]] = await Promise.all([
      db
        .select()
        .from(tenantsTable)
        .where(where)
        .orderBy(tenantsTable.createdAt)
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(tenantsTable).where(where),
    ]);

    res.json({ items, total: Number(total), limit, offset });
  } catch (err) {
    next(err);
  }
});

router.get("/tenants/:tenantId", async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    res.json(tenant);
  } catch (err) {
    next(err);
  }
});

router.patch("/tenants/:tenantId", async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { name, status, metadata } = req.body as {
      name?: string;
      status?: string;
      metadata?: Record<string, unknown>;
    };

    const updates: Partial<typeof tenantsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (name !== undefined) updates.name = name;
    if (status !== undefined)
      updates.status = status as "active" | "suspended" | "deleted";
    if (metadata !== undefined) updates.metadata = metadata;

    const [updated] = await db
      .update(tenantsTable)
      .set(updates)
      .where(eq(tenantsTable.id, tenantId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    await emitAuditEvent({
      tenantId,
      ...SYSTEM_ACTOR,
      eventType: AET.tenant.updated,
      resourceType: "tenant",
      resourceId: tenantId,
      payload: updates,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.get("/tenants/:tenantId/summary", async (req, res, next) => {
  try {
    const { tenantId } = req.params;

    const [
      [{ workspaceCount }],
      [{ environmentCount }],
      [{ packageCount }],
      [{ activeDeploymentCount }],
      [{ pendingApprovalCount }],
      [{ recentAuditEventCount }],
    ] = await Promise.all([
      db
        .select({ workspaceCount: count() })
        .from(workspacesTable)
        .where(eq(workspacesTable.tenantId, tenantId)),
      db
        .select({ environmentCount: count() })
        .from(environmentsTable)
        .where(eq(environmentsTable.tenantId, tenantId)),
      db
        .select({ packageCount: count() })
        .from(packagesTable)
        .where(eq(packagesTable.tenantId, tenantId)),
      db
        .select({ activeDeploymentCount: count() })
        .from(deploymentsTable)
        .where(
          and(
            eq(deploymentsTable.tenantId, tenantId),
            eq(deploymentsTable.status, "active"),
          ),
        ),
      db
        .select({ pendingApprovalCount: count() })
        .from(approvalRequestsTable)
        .where(
          and(
            eq(approvalRequestsTable.tenantId, tenantId),
            eq(approvalRequestsTable.status, "pending"),
          ),
        ),
      db
        .select({ recentAuditEventCount: count() })
        .from(auditEventsTable)
        .where(
          and(
            eq(auditEventsTable.tenantId, tenantId),
            sql`${auditEventsTable.createdAt} > now() - interval '24 hours'`,
          ),
        ),
    ]);

    res.json({
      tenantId,
      workspaceCount: Number(workspaceCount),
      environmentCount: Number(environmentCount),
      packageCount: Number(packageCount),
      activeDeploymentCount: Number(activeDeploymentCount),
      pendingApprovalCount: Number(pendingApprovalCount),
      recentAuditEventCount: Number(recentAuditEventCount),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
