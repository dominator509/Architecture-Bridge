import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { workspacesTable } from "./workspaces";

export const environmentsTable = pgTable(
  "environments",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    type: text("type", {
      enum: ["development", "staging", "production"],
    }).notNull(),
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("environments_tenant_id_idx").on(t.tenantId),
    index("environments_workspace_id_idx").on(t.workspaceId),
  ],
);

export const insertEnvironmentSchema = createInsertSchema(
  environmentsTable,
).omit({ createdAt: true, updatedAt: true });

export const selectEnvironmentSchema = createSelectSchema(environmentsTable);

export type InsertEnvironment = z.infer<typeof insertEnvironmentSchema>;
export type Environment = typeof environmentsTable.$inferSelect;
