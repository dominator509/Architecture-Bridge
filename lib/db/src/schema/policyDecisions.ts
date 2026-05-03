/**
 * PolicyDecision — persisted record of every evaluated policy decision.
 * Phase 3: every protected mutation stores a pdec_ row before branching.
 */
import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const policyDecisionsTable = pgTable(
  "policy_decisions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    principalId: text("principal_id").notNull(),
    principalType: text("principal_type", {
      enum: ["user", "agent", "system"],
    }).notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    outcome: text("outcome", {
      enum: ["allow", "deny", "require_approval", "require_escalation"],
    }).notNull(),
    matchedRule: text("matched_rule"),
    reason: text("reason").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("policy_decisions_tenant_id_idx").on(t.tenantId),
    index("policy_decisions_outcome_idx").on(t.outcome),
    index("policy_decisions_created_at_idx").on(t.createdAt),
  ],
);

export const insertPolicyDecisionSchema = createInsertSchema(
  policyDecisionsTable,
).omit({ createdAt: true });

export const selectPolicyDecisionSchema = createSelectSchema(policyDecisionsTable);

export type InsertPolicyDecision = z.infer<typeof insertPolicyDecisionSchema>;
export type PolicyDecisionRecord = typeof policyDecisionsTable.$inferSelect;
