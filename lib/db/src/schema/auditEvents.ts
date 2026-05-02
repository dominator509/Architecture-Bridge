import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const auditEventsTable = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    actorType: text("actor_type", {
      enum: ["user", "system", "agent"],
    }).notNull(),
    eventType: text("event_type").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_events_tenant_id_idx").on(t.tenantId),
    index("audit_events_resource_idx").on(t.resourceType, t.resourceId),
    index("audit_events_created_at_idx").on(t.createdAt),
  ],
);

export const insertAuditEventSchema = createInsertSchema(auditEventsTable).omit(
  { createdAt: true },
);

export const selectAuditEventSchema = createSelectSchema(auditEventsTable);

export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEventsTable.$inferSelect;
