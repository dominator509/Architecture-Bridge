/**
 * Tenant-scoped request context.
 *
 * Extracts the active tenantId from the route parameter and attaches it to
 * res.locals so every downstream handler can read it without re-parsing.
 *
 * Security boundary: every route that is tenant-scoped MUST go through this
 * middleware. It verifies the tenant exists and is active before proceeding.
 */

import { Request, Response, NextFunction } from "express";
import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

declare global {
  namespace Express {
    interface Locals {
      tenantId: string;
    }
  }
}

export function resolveTenantContext(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const tenantId = req.params["tenantId"];
  if (!tenantId) {
    res.status(400).json({ error: "tenantId path parameter is required" });
    return;
  }
  res.locals.tenantId = tenantId;
  next();
}

export async function requireActiveTenant(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const tenantId = res.locals.tenantId ?? req.params["tenantId"];
  if (!tenantId) {
    res.status(400).json({ error: "tenantId is required" });
    return;
  }
  try {
    const [tenant] = await db
      .select({ id: tenantsTable.id, status: tenantsTable.status })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    if (tenant.status !== "active") {
      res.status(403).json({
        error: "Tenant is not active",
        code: "TENANT_NOT_ACTIVE",
      });
      return;
    }
    res.locals.tenantId = tenantId;
    next();
  } catch (err) {
    next(err);
  }
}
