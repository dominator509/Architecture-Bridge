import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  packagesTable,
  packageVersionsTable,
} from "@workspace/db";
import { emitAuditEvent, auditEventTypes } from "../lib/audit";
import { resolveActor } from "../lib/actorContext";
import { newPackageId, newPackageVersionId } from "../lib/ids";
import {
  resolveTenantContext,
  requireActiveTenant,
} from "../lib/tenantContext";
import {
  CATALOG_VERIFIED_AT,
  ASSISTANT_BUILDS,
  SECURITY_WRAPPERS,
  createAssistantBuildManifest,
  findAssistantBuild,
  findSecurityWrapper,
} from "../lib/assistantCatalog";
import { ImportAssistantBuildBody, parseBody } from "../lib/validation";

const router: IRouter = Router({ mergeParams: true });
const AET = auditEventTypes();

router.use(resolveTenantContext);
router.use(requireActiveTenant);

router.get("/catalog", async (_req, res) => {
  res.json({
    verifiedAt: CATALOG_VERIFIED_AT,
    items: ASSISTANT_BUILDS,
    wrappers: SECURITY_WRAPPERS,
  });
});

router.post("/:buildSlug/import", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { buildSlug } = req.params;
    const body = parseBody(ImportAssistantBuildBody, req.body, res);
    if (!body) return;

    const build = findAssistantBuild(buildSlug);
    if (!build) {
      res.status(404).json({
        error: "Assistant build not found",
        code: "ASSISTANT_BUILD_NOT_FOUND",
      });
      return;
    }

    const wrapperSlug = body.wrapperSlug ?? build.recommendedWrapper;
    const wrapper = findSecurityWrapper(wrapperSlug);
    if (!wrapper || !build.supportedWrappers.includes(wrapper.slug)) {
      res.status(400).json({
        error: "Wrapper is not supported for this assistant build",
        code: "UNSUPPORTED_WRAPPER",
      });
      return;
    }

    const { actorId, actorType } = resolveActor(req);
    const version = body.version ?? build.defaultVersion;
    const manifest = createAssistantBuildManifest({ build, wrapper });

    let [pkg] = await db
      .select()
      .from(packagesTable)
      .where(
        and(
          eq(packagesTable.tenantId, tenantId),
          eq(packagesTable.slug, build.slug),
        ),
      )
      .limit(1);

    let packageCreated = false;
    if (!pkg) {
      const packageId = newPackageId();
      [pkg] = await db
        .insert(packagesTable)
        .values({
          id: packageId,
          tenantId,
          name: build.name,
          slug: build.slug,
          description: build.description,
          metadata: {
            ...(body.metadata ?? {}),
            assistantCatalog: {
              source: build.source,
              importedAt: new Date().toISOString(),
              verifiedAt: CATALOG_VERIFIED_AT,
            },
          },
          status: "active",
        })
        .returning();
      packageCreated = true;

      await emitAuditEvent({
        tenantId,
        actorId,
        actorType,
        eventType: AET.package.created,
        resourceType: "package",
        resourceId: packageId,
        payload: {
          name: build.name,
          slug: build.slug,
          assistantBuildSlug: build.slug,
        },
      });
    }

    if (!pkg) {
      throw new Error("Package import failed");
    }

    const [existingVersion] = await db
      .select()
      .from(packageVersionsTable)
      .where(
        and(
          eq(packageVersionsTable.tenantId, tenantId),
          eq(packageVersionsTable.packageId, pkg.id),
          eq(packageVersionsTable.version, version),
        ),
      )
      .limit(1);

    if (existingVersion) {
      res.json({
        imported: false,
        packageCreated,
        package: pkg,
        packageVersion: existingVersion,
        manifest: existingVersion.manifest,
        wrapper,
      });
      return;
    }

    const packageVersionId = newPackageVersionId();
    const [packageVersion] = await db
      .insert(packageVersionsTable)
      .values({
        id: packageVersionId,
        packageId: pkg.id,
        tenantId,
        version,
        manifest,
        status: "published",
      })
      .returning();

    await emitAuditEvent({
      tenantId,
      actorId,
      actorType,
      eventType: AET.packageVersion.created,
      resourceType: "package_version",
      resourceId: packageVersionId,
      payload: {
        packageId: pkg.id,
        version,
        assistantBuildSlug: build.slug,
        wrapperSlug: wrapper.slug,
      },
    });

    res.status(packageCreated ? 201 : 200).json({
      imported: true,
      packageCreated,
      package: pkg,
      packageVersion,
      manifest,
      wrapper,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
