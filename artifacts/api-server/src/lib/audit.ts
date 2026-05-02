/**
 * Audit event foundation.
 *
 * emitAuditEvent() writes an immutable audit record and is the ONLY path
 * for creating audit events — never insert into audit_events directly.
 *
 * All tenant-mutating API routes call this after a successful write.
 * The event is fire-and-forget: failures are logged but never surface to the
 * caller so they don't disrupt the primary operation.
 */

import { db, auditEventsTable } from "@workspace/db";
import { newAuditEventId } from "./ids";
import { logger } from "./logger";

export type ActorType = "user" | "system" | "agent";

export interface AuditPayload {
  tenantId: string;
  actorId: string;
  actorType: ActorType;
  eventType: string;
  resourceType: string;
  resourceId: string;
  payload?: Record<string, unknown>;
  ipAddress?: string;
}

export async function emitAuditEvent(data: AuditPayload): Promise<void> {
  try {
    await db.insert(auditEventsTable).values({
      id: newAuditEventId(),
      tenantId: data.tenantId,
      actorId: data.actorId,
      actorType: data.actorType,
      eventType: data.eventType,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      payload: data.payload ?? {},
      ipAddress: data.ipAddress,
    });
  } catch (err) {
    logger.error({ err, data }, "Failed to emit audit event");
  }
}

export function auditEventTypes() {
  return {
    tenant: {
      created: "tenant.created",
      updated: "tenant.updated",
    },
    workspace: {
      created: "workspace.created",
      updated: "workspace.updated",
    },
    environment: {
      created: "environment.created",
      updated: "environment.updated",
    },
    package: {
      created: "package.created",
    },
    packageVersion: {
      created: "package_version.created",
    },
    deployment: {
      created: "deployment.created",
      updated: "deployment.updated",
    },
    configSnapshot: {
      resolved: "config_snapshot.resolved",
    },
    approval: {
      created: "approval.created",
      decided: "approval.decided",
    },
    policy: {
      evaluated: "policy.evaluated",
    },
  } as const;
}
