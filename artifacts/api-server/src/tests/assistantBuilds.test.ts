import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import {
  db,
  tenantsTable,
  packagesTable,
  packageVersionsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { newTenantId } from "../lib/ids";

const TENANT_ID = newTenantId();
const BASE = `/api/tenants/${TENANT_ID}/assistant-builds`;

beforeAll(async () => {
  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "Assistant Build Test Tenant",
    slug: `assistant-build-test-${TENANT_ID}`,
    status: "active",
    metadata: {},
  });
});

afterAll(async () => {
  await db.delete(packageVersionsTable).where(eq(packageVersionsTable.tenantId, TENANT_ID));
  await db.delete(packagesTable).where(eq(packagesTable.tenantId, TENANT_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

describe("Assistant build catalog", () => {
  it("returns the curated assistant build and wrapper catalog", async () => {
    const res = await request(app).get(`${BASE}/catalog`);

    expect(res.status).toBe(200);
    expect(res.body.verifiedAt).toBe("2026-05-27");
    expect(res.body.items).toHaveLength(12);
    expect(res.body.items.map((item: { slug: string }) => item.slug)).toEqual(
      expect.arrayContaining([
        "hermes",
        "qwenpaw",
        "openclaw",
        "leon",
        "openhuman",
        "trustclaw",
        "picoclaw",
        "nanobot",
        "memu-bot",
        "9router",
        "cheetahclaws",
        "zeroclaw",
      ]),
    );
    expect(res.body.wrappers.map((item: { slug: string }) => item.slug)).toContain(
      "nemoclaw",
    );
  });

  it("imports a catalog build as a published package version", async () => {
    const res = await request(app)
      .post(`${BASE}/hermes/import`)
      .send({ wrapperSlug: "nemoclaw" });

    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(true);
    expect(res.body.package.slug).toBe("hermes");
    expect(res.body.packageVersion.status).toBe("published");
    expect(res.body.packageVersion.version).toBe("source-main");
    expect(res.body.manifest.type).toBe("personal-assistant-agent");
    expect(res.body.manifest.source.repository).toBe(
      "https://github.com/NousResearch/hermes-agent",
    );
    expect(res.body.manifest.wrapper.slug).toBe("nemoclaw");
  });

  it("returns the existing version on duplicate import", async () => {
    const first = await request(app)
      .post(`${BASE}/qwenpaw/import`)
      .send({ wrapperSlug: "nemoclaw" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`${BASE}/qwenpaw/import`)
      .send({ wrapperSlug: "nemoclaw" });

    expect(second.status).toBe(200);
    expect(second.body.imported).toBe(false);
    expect(second.body.package.id).toBe(first.body.package.id);
    expect(second.body.packageVersion.id).toBe(first.body.packageVersion.id);
  });

  it("rejects unsupported wrappers for a build import", async () => {
    const res = await request(app)
      .post(`${BASE}/hermes/import`)
      .send({ wrapperSlug: "missing-wrapper" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNSUPPORTED_WRAPPER");
  });
});
