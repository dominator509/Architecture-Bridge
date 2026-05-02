/**
 * ConfigSnapshot — immutable resolved config stored at deployment time.
 * Connector/provider resolution is a FUTURE-PHASE placeholder.
 * Current implementation merges package version manifest with caller overrides.
 */
import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { deploymentsTable } from "./deployments";

export const configSnapshotsTable = pgTable(
  "config_snapshots",
  {
    id: text("id").primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deploymentsTable.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    resolvedConfig: jsonb("resolved_config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    schemaVersion: text("schema_version").notNull().default("1.0"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("config_snapshots_deployment_id_idx").on(t.deploymentId),
    index("config_snapshots_tenant_id_idx").on(t.tenantId),
  ],
);

export const insertConfigSnapshotSchema = createInsertSchema(
  configSnapshotsTable,
).omit({ createdAt: true });

export const selectConfigSnapshotSchema = createSelectSchema(
  configSnapshotsTable,
);

export type InsertConfigSnapshot = z.infer<typeof insertConfigSnapshotSchema>;
export type ConfigSnapshot = typeof configSnapshotsTable.$inferSelect;
