/**
 * ActionLedger — immutable evidence trail of every attempted action.
 *
 * Phase 3 status lifecycle:
 *   attempted        → policy evaluation in progress or just recorded
 *   blocked          → policy denied; action did not execute
 *   approval_required → policy returned require_approval; waiting on decision
 *   approved         → approval granted; action may now execute
 *   executed         → action completed successfully
 *   cancelled        → approval rejected or actor cancelled
 *   failed           → action attempted but failed at execution
 *
 * policyDecisionId links to the pdec_ row that drove the outcome.
 * approvalRequestId links to the apr_ row created when approval is required.
 */
import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const actionLedgerTable = pgTable(
  "action_ledger",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    deploymentId: text("deployment_id"),
    actionType: text("action_type").notNull(),
    actorId: text("actor_id").notNull(),
    actorType: text("actor_type", {
      enum: ["user", "system", "agent"],
    }).notNull(),
    status: text("status", {
      enum: [
        "attempted",
        "blocked",
        "approval_required",
        "approved",
        "executed",
        "cancelled",
        "failed",
      ],
    })
      .notNull()
      .default("attempted"),
    policyDecisionId: text("policy_decision_id"),
    approvalRequestId: text("approval_request_id"),
    requestPayload: jsonb("request_payload").$type<Record<string, unknown>>(),
    responsePayload: jsonb("response_payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("action_ledger_tenant_id_idx").on(t.tenantId),
    index("action_ledger_deployment_id_idx").on(t.deploymentId),
    index("action_ledger_created_at_idx").on(t.createdAt),
    index("action_ledger_status_idx").on(t.status),
    index("action_ledger_policy_decision_id_idx").on(t.policyDecisionId),
  ],
);

export const insertActionLedgerSchema = createInsertSchema(
  actionLedgerTable,
).omit({ createdAt: true });

export const selectActionLedgerSchema = createSelectSchema(actionLedgerTable);

export type InsertActionLedger = z.infer<typeof insertActionLedgerSchema>;
export type ActionLedgerEntry = typeof actionLedgerTable.$inferSelect;
