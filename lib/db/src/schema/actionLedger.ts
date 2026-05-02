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
      enum: ["pending", "succeeded", "failed", "cancelled"],
    })
      .notNull()
      .default("pending"),
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
  ],
);

export const insertActionLedgerSchema = createInsertSchema(
  actionLedgerTable,
).omit({ createdAt: true });

export const selectActionLedgerSchema = createSelectSchema(actionLedgerTable);

export type InsertActionLedger = z.infer<typeof insertActionLedgerSchema>;
export type ActionLedgerEntry = typeof actionLedgerTable.$inferSelect;
