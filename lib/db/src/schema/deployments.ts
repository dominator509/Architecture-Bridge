import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { environmentsTable } from "./environments";
import { packageVersionsTable } from "./packageVersions";

export const deploymentsTable = pgTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environmentsTable.id, { onDelete: "restrict" }),
    packageVersionId: text("package_version_id")
      .notNull()
      .references(() => packageVersionsTable.id, { onDelete: "restrict" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["pending", "active", "failed", "stopped"],
    })
      .notNull()
      .default("pending"),
    configSnapshotId: text("config_snapshot_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("deployments_tenant_id_idx").on(t.tenantId),
    index("deployments_environment_id_idx").on(t.environmentId),
  ],
);

export const insertDeploymentSchema = createInsertSchema(deploymentsTable).omit(
  { createdAt: true, updatedAt: true },
);

export const selectDeploymentSchema = createSelectSchema(deploymentsTable);

export type InsertDeployment = z.infer<typeof insertDeploymentSchema>;
export type Deployment = typeof deploymentsTable.$inferSelect;
