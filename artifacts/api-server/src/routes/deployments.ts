import { Router, type IRouter } from "express";
import {
  db,
  deploymentsTable,
  environmentsTable,
  packageVersionsTable,
  configSnapshotsTable,
} from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import {
  newDeploymentId,
  newConfigSnapshotId,
} from "../lib/ids";
import { emitAuditEvent, auditEventTypes } from "../lib/audit";
import {
  resolveTenantContext,
  requireActiveTenant,
} from "../lib/tenantContext";

// Mounted at /tenants/:tenantId — all route paths here are relative to that prefix.
const router: IRouter = Router({ mergeParams: true });
const AET = auditEventTypes();
const SYSTEM_ACTOR = { actorId: "system", actorType: "system" as const };

router.use(resolveTenantContext);
router.use(requireActiveTenant);

// ── GET /tenants/:tenantId/deployments ────────────────────────────────────────
// List all deployments across all environments for a tenant
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

// ── POST /tenants/:tenantId/environments/:environmentId/deployments ───────────
router.post(
  "/environments/:environmentId/deployments",
  async (req, res, next) => {
    try {
      const tenantId = res.locals.tenantId!;
      const { environmentId } = req.params;
      const { packageVersionId, metadata } = req.body as {
        packageVersionId?: string;
        metadata?: Record<string, unknown>;
      };

      if (!packageVersionId) {
        res.status(400).json({ error: "packageVersionId is required" });
        return;
      }

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

      await emitAuditEvent({
        tenantId,
        ...SYSTEM_ACTOR,
        eventType: AET.deployment.created,
        resourceType: "deployment",
        resourceId: id,
        payload: { environmentId, packageVersionId },
      });

      res.status(201).json(deployment);
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /tenants/:tenantId/environments/:environmentId/deployments ────────────
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

// ── GET /tenants/:tenantId/deployments/:deploymentId ─────────────────────────
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

// ── PATCH /tenants/:tenantId/deployments/:deploymentId ───────────────────────
router.patch("/deployments/:deploymentId", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { deploymentId } = req.params;
    const { status, metadata } = req.body as {
      status?: string;
      metadata?: Record<string, unknown>;
    };

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
      ...SYSTEM_ACTOR,
      eventType: AET.deployment.updated,
      resourceType: "deployment",
      resourceId: deploymentId,
      payload: updates,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── Config Snapshot routes ────────────────────────────────────────────────────

router.post(
  "/deployments/:deploymentId/config-snapshot",
  async (req, res, next) => {
    try {
      const tenantId = res.locals.tenantId!;
      const { deploymentId } = req.params;
      const { configOverrides, schemaVersion } = req.body as {
        configOverrides?: Record<string, unknown>;
        schemaVersion?: string;
      };

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
