/**
 * Audit emission tests.
 *
 * Verifies that creating tenant-mutating resources always produces
 * a corresponding audit event with correct fields.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { db, tenantsTable, auditEventsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { newTenantId } from "../lib/ids";

const TEST_TENANT_ID = newTenantId();

beforeAll(async () => {
  await db.insert(tenantsTable).values({
    id: TEST_TENANT_ID,
    name: "Audit Test Tenant",
    slug: `audit-test-${TEST_TENANT_ID}`,
    status: "active",
    metadata: {},
  });
});

afterAll(async () => {
  await db.delete(auditEventsTable).where(
    eq(auditEventsTable.tenantId, TEST_TENANT_ID),
  );
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TEST_TENANT_ID));
});

describe("Audit event emission", () => {
  it("creates a tenant.created audit event when a tenant is created via API", async () => {
    const slug = `audit-create-${Date.now()}`;
    const res = await request(app)
      .post("/api/tenants")
      .send({ name: "Audit Created Tenant", slug })
      .expect(201);

    const createdId = res.body.id as string;

    // Give async emit a moment (it's fire-and-forget)
    await new Promise((r) => setTimeout(r, 100));

    const events = await db
      .select()
      .from(auditEventsTable)
      .where(
        and(
          eq(auditEventsTable.tenantId, createdId),
          eq(auditEventsTable.eventType, "tenant.created"),
          eq(auditEventsTable.resourceId, createdId),
        ),
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].resourceType).toBe("tenant");
    expect(events[0].actorType).toBe("system");

    // Cleanup
    await db.delete(auditEventsTable).where(
      eq(auditEventsTable.tenantId, createdId),
    );
    await db.delete(tenantsTable).where(eq(tenantsTable.id, createdId));
  });

  it("creates a workspace.created audit event when workspace is created", async () => {
    const wsRes = await request(app)
      .post(`/api/tenants/${TEST_TENANT_ID}/workspaces`)
      .send({ name: "Audit WS", slug: `audit-ws-${Date.now()}` })
      .expect(201);

    const wsId = wsRes.body.id as string;
    await new Promise((r) => setTimeout(r, 100));

    const events = await db
      .select()
      .from(auditEventsTable)
      .where(
        and(
          eq(auditEventsTable.tenantId, TEST_TENANT_ID),
          eq(auditEventsTable.eventType, "workspace.created"),
          eq(auditEventsTable.resourceId, wsId),
        ),
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].resourceType).toBe("workspace");
  });
});
