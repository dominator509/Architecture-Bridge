import { Router, type IRouter } from "express";
import {
  db,
  packagesTable,
  packageVersionsTable,
} from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { newPackageId, newPackageVersionId } from "../lib/ids";
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

// ── Packages ──────────────────────────────────────────────────────────────────

router.post("/", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { name, slug, description, metadata } = req.body as {
      name?: string;
      slug?: string;
      description?: string;
      metadata?: Record<string, unknown>;
    };

    if (!name || !slug) {
      res.status(400).json({ error: "name and slug are required" });
      return;
    }

    const existing = await db
      .select({ id: packagesTable.id })
      .from(packagesTable)
      .where(
        and(
          eq(packagesTable.tenantId, tenantId),
          eq(packagesTable.slug, slug),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "Slug already taken", code: "SLUG_CONFLICT" });
      return;
    }

    const id = newPackageId();
    const [pkg] = await db
      .insert(packagesTable)
      .values({ id, tenantId, name, slug, description, metadata: metadata ?? {} })
      .returning();

    await emitAuditEvent({
      tenantId,
      ...SYSTEM_ACTOR,
      eventType: AET.package.created,
      resourceType: "package",
      resourceId: id,
      payload: { name, slug },
    });

    res.status(201).json(pkg);
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

    const conditions = [eq(packagesTable.tenantId, tenantId)];
    if (status) {
      conditions.push(
        eq(packagesTable.status, status as "active" | "deprecated" | "archived"),
      );
    }
    const where = and(...conditions);

    const [items, [{ total }]] = await Promise.all([
      db
        .select()
        .from(packagesTable)
        .where(where)
        .orderBy(packagesTable.createdAt)
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(packagesTable).where(where),
    ]);

    res.json({ items, total: Number(total), limit, offset });
  } catch (err) {
    next(err);
  }
});

router.get("/:packageId", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { packageId } = req.params;

    const [pkg] = await db
      .select()
      .from(packagesTable)
      .where(
        and(
          eq(packagesTable.id, packageId),
          eq(packagesTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }
    res.json(pkg);
  } catch (err) {
    next(err);
  }
});

// ── Package Versions ──────────────────────────────────────────────────────────

router.post("/:packageId/versions", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { packageId } = req.params;
    const { version, manifest, status } = req.body as {
      version?: string;
      manifest?: Record<string, unknown>;
      status?: string;
    };

    if (!version || !manifest) {
      res.status(400).json({ error: "version and manifest are required" });
      return;
    }

    const [pkg] = await db
      .select({ id: packagesTable.id })
      .from(packagesTable)
      .where(
        and(
          eq(packagesTable.id, packageId),
          eq(packagesTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!pkg) {
      res.status(404).json({ error: "Package not found" });
      return;
    }

    const existing = await db
      .select({ id: packageVersionsTable.id })
      .from(packageVersionsTable)
      .where(
        and(
          eq(packageVersionsTable.packageId, packageId),
          eq(packageVersionsTable.version, version),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      res
        .status(409)
        .json({ error: "Version already exists for this package", code: "VERSION_CONFLICT" });
      return;
    }

    const id = newPackageVersionId();
    const [pkgVersion] = await db
      .insert(packageVersionsTable)
      .values({
        id,
        packageId,
        tenantId,
        version,
        manifest,
        status: (status as "draft" | "published") ?? "draft",
      })
      .returning();

    await emitAuditEvent({
      tenantId,
      ...SYSTEM_ACTOR,
      eventType: AET.packageVersion.created,
      resourceType: "package_version",
      resourceId: id,
      payload: { packageId, version, status },
    });

    res.status(201).json(pkgVersion);
  } catch (err) {
    next(err);
  }
});

router.get("/:packageId/versions", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { packageId } = req.params;
    const status = req.query["status"] as string | undefined;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const offset = Number(req.query["offset"] ?? 0);

    const conditions = [
      eq(packageVersionsTable.packageId, packageId),
      eq(packageVersionsTable.tenantId, tenantId),
    ];
    if (status) {
      conditions.push(
        eq(
          packageVersionsTable.status,
          status as "draft" | "published" | "deprecated",
        ),
      );
    }
    const where = and(...conditions);

    const [items, [{ total }]] = await Promise.all([
      db
        .select()
        .from(packageVersionsTable)
        .where(where)
        .orderBy(packageVersionsTable.createdAt)
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(packageVersionsTable).where(where),
    ]);

    res.json({ items, total: Number(total), limit, offset });
  } catch (err) {
    next(err);
  }
});

router.get("/:packageId/versions/:versionId", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { packageId, versionId } = req.params;

    const [pkgVersion] = await db
      .select()
      .from(packageVersionsTable)
      .where(
        and(
          eq(packageVersionsTable.id, versionId),
          eq(packageVersionsTable.packageId, packageId),
          eq(packageVersionsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!pkgVersion) {
      res.status(404).json({ error: "Package version not found" });
      return;
    }
    res.json(pkgVersion);
  } catch (err) {
    next(err);
  }
});

export default router;
