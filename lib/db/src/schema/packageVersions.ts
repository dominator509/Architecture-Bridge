import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { packagesTable } from "./packages";

export const packageVersionsTable = pgTable(
  "package_versions",
  {
    id: text("id").primaryKey(),
    packageId: text("package_id")
      .notNull()
      .references(() => packagesTable.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    manifest: jsonb("manifest")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text("status", { enum: ["draft", "published", "deprecated"] })
      .notNull()
      .default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("package_versions_package_id_idx").on(t.packageId),
    index("package_versions_tenant_id_idx").on(t.tenantId),
  ],
);

export const insertPackageVersionSchema = createInsertSchema(
  packageVersionsTable,
).omit({ createdAt: true, updatedAt: true });

export const selectPackageVersionSchema = createSelectSchema(
  packageVersionsTable,
);

export type InsertPackageVersion = z.infer<typeof insertPackageVersionSchema>;
export type PackageVersion = typeof packageVersionsTable.$inferSelect;
