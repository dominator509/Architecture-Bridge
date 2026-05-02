import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const approvalRequestsTable = pgTable(
  "approval_requests",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    action: text("action").notNull(),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "expired"],
    })
      .notNull()
      .default("pending"),
    requesterId: text("requester_id").notNull(),
    reviewerId: text("reviewer_id"),
    requestPayload: jsonb("request_payload").$type<Record<string, unknown>>(),
    decisionPayload: jsonb("decision_payload").$type<Record<string, unknown>>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("approval_requests_tenant_id_idx").on(t.tenantId),
    index("approval_requests_status_idx").on(t.status),
    index("approval_requests_resource_idx").on(t.resourceType, t.resourceId),
  ],
);

export const insertApprovalRequestSchema = createInsertSchema(
  approvalRequestsTable,
).omit({ createdAt: true, updatedAt: true });

export const selectApprovalRequestSchema = createSelectSchema(
  approvalRequestsTable,
);

export type InsertApprovalRequest = z.infer<typeof insertApprovalRequestSchema>;
export type ApprovalRequest = typeof approvalRequestsTable.$inferSelect;
