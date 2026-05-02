/**
 * Minimal tenant isolation tests.
 *
 * These tests verify that the core invariant holds:
 * a resource created under tenant A is never visible when queried under tenant B.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { db, tenantsTable, workspacesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { newTenantId, newWorkspaceId } from "../lib/ids";

const TA_ID = newTenantId();
const TB_ID = newTenantId();
const WA_ID = newWorkspaceId();

beforeAll(async () => {
  await db.insert(tenantsTable).values([
    { id: TA_ID, name: "Tenant A", slug: `tenant-a-${TA_ID}`, status: "active", metadata: {} },
    { id: TB_ID, name: "Tenant B", slug: `tenant-b-${TB_ID}`, status: "active", metadata: {} },
  ]);
  await db.insert(workspacesTable).values({
    id: WA_ID,
    tenantId: TA_ID,
    name: "Workspace of A",
    slug: "ws-a",
    status: "active",
    metadata: {},
  });
});

afterAll(async () => {
  await db.delete(workspacesTable).where(eq(workspacesTable.id, WA_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TA_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TB_ID));
});

describe("Tenant isolation", () => {
  it("tenant A can list its own workspace", async () => {
    const res = await request(app)
      .get(`/api/tenants/${TA_ID}/workspaces`)
      .expect(200);
    const ids = res.body.items.map((w: { id: string }) => w.id);
    expect(ids).toContain(WA_ID);
  });

  it("tenant B cannot see tenant A workspace", async () => {
    const res = await request(app)
      .get(`/api/tenants/${TB_ID}/workspaces`)
      .expect(200);
    const ids = res.body.items.map((w: { id: string }) => w.id);
    expect(ids).not.toContain(WA_ID);
  });

  it("direct workspace fetch with wrong tenant returns 404", async () => {
    await request(app)
      .get(`/api/tenants/${TB_ID}/workspaces/${WA_ID}`)
      .expect(404);
  });

  it("suspended tenant gets 403 on tenant-scoped routes", async () => {
    await db
      .update(tenantsTable)
      .set({ status: "suspended" })
      .where(eq(tenantsTable.id, TA_ID));

    await request(app)
      .get(`/api/tenants/${TA_ID}/workspaces`)
      .expect(403);

    await db
      .update(tenantsTable)
      .set({ status: "active" })
      .where(eq(tenantsTable.id, TA_ID));
  });
});
