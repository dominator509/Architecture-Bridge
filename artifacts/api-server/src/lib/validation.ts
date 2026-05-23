/**
 * Centralised Zod request-body schemas.
 *
 * Every POST / PATCH route imports its schema from here.
 * Use schema.safeParse(req.body) and return 400 on failure.
 */

import { z } from "zod";
import type { Response } from "express";

// ── Primitives ─────────────────────────────────────────────────────────────────

const slug = z
  .string()
  .min(1, "slug is required")
  .max(100)
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/,
    "slug must be lowercase alphanumeric with hyphens",
  );

const name = z.string().min(1, "name is required").max(200).trim();

const metadata = z.record(z.string(), z.unknown()).optional();

// ── Tenants ────────────────────────────────────────────────────────────────────

export const CreateTenantBody = z.object({
  name,
  slug,
  metadata,
});

export const UpdateTenantBody = z
  .object({
    name: z.string().min(1).max(200).trim().optional(),
    status: z.enum(["active", "suspended", "deleted"]).optional(),
    metadata,
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided",
  });

// ── Workspaces ─────────────────────────────────────────────────────────────────

export const CreateWorkspaceBody = z.object({
  name,
  slug,
  metadata,
});

export const UpdateWorkspaceBody = z.object({
  name: z.string().min(1).max(200).trim().optional(),
  status: z.enum(["active", "archived"]).optional(),
  metadata,
});

// ── Environments ───────────────────────────────────────────────────────────────

export const CreateEnvironmentBody = z.object({
  name,
  slug,
  type: z.enum(["development", "staging", "production"]),
  metadata,
});

export const UpdateEnvironmentBody = z.object({
  name: z.string().min(1).max(200).trim().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  metadata,
});

// ── Packages ───────────────────────────────────────────────────────────────────

export const CreatePackageBody = z.object({
  name,
  slug,
  description: z.string().max(1000).optional(),
  metadata,
});

export const CreatePackageVersionBody = z.object({
  version: z.string().min(1).max(100),
  manifest: z.record(z.string(), z.unknown()),
  status: z.enum(["draft", "published"]).default("draft"),
});

// ── Deployments ────────────────────────────────────────────────────────────────

export const CreateDeploymentBody = z.object({
  packageVersionId: z.string().min(1, "packageVersionId is required"),
  metadata,
});

export const UpdateDeploymentBody = z.object({
  status: z
    .enum(["pending", "active", "failed", "stopped"])
    .optional(),
  metadata,
});

export const CreateConfigSnapshotBody = z.object({
  configOverrides: z.record(z.string(), z.unknown()).optional(),
  schemaVersion: z.string().optional(),
});

export const ProvisionDeploymentBody = z.object({
  provider: z.enum(["docker-local", "managed-sandbox"]).default("docker-local"),
  activate: z.boolean().default(true),
  configOverrides: z.record(z.string(), z.unknown()).optional(),
});

// ── Approvals ──────────────────────────────────────────────────────────────────

export const CreateApprovalBody = z.object({
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  action: z.string().min(1),
  requesterId: z.string().min(1),
  requestPayload: z.record(z.string(), z.unknown()).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

export const ApprovalDecisionBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  reviewerId: z.string().min(1),
  decisionPayload: z.record(z.string(), z.unknown()).optional(),
});

// ── Policy ─────────────────────────────────────────────────────────────────────

export const EvaluatePolicyBody = z.object({
  principal: z.object({
    type: z.enum(["user", "agent", "system"]),
    id: z.string().min(1),
  }),
  action: z.string().min(1),
  resource: z.object({
    type: z.string().min(1),
    id: z.string().min(1),
  }),
  context: z.record(z.string(), z.unknown()).optional(),
});

// ── Helper ─────────────────────────────────────────────────────────────────────

/**
 * Parse and validate a request body against a Zod schema.
 * Returns parsed data on success, sends a 400 response and returns null on failure.
 * Usage: const body = parseBody(MySchema, req.body, res); if (!body) return;
 */
export function parseBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
  res: Response,
): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    res.status(400).json({
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      details: result.error.flatten(),
    });
    return null;
  }
  return result.data;
}
