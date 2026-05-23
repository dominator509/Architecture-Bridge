/**
 * Seed Phase 3 data: policy decisions + action ledger entries.
 *
 * Usage: pnpm --filter @workspace/scripts run seed-phase3
 *
 * Creates realistic Phase 3 records for the first active tenant found,
 * demonstrating all 4 policy outcomes (allow, deny, require_approval, require_escalation).
 */

import {
  db,
  tenantsTable,
  workspacesTable,
  environmentsTable,
  packagesTable,
  packageVersionsTable,
  deploymentsTable,
  policyDecisionsTable,
  actionLedgerTable,
  approvalRequestsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { randomBytes } from "crypto";

const id = (prefix: string) =>
  `${prefix}${randomBytes(14).toString("base64url").slice(0, 18)}`;

async function main() {
  console.log("🌱 Seeding Phase 3 data...\n");

  // ── 1. Find or create the demo tenant ────────────────────────────────────────
  const [existing] = await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.status, "active"))
    .orderBy(tenantsTable.createdAt)
    .limit(1);

  let tenant = existing;

  if (!tenant) {
    const tenantId = id("ten_");
    const [created] = await db
      .insert(tenantsTable)
      .values({
        id: tenantId,
        name: "Demo Tenant",
        slug: "demo-tenant",
        status: "active",
        metadata: { seeded: true },
      })
      .returning();
    tenant = created!;
    console.log(`Created tenant: ${tenant.id} (${tenant.name})`);
  } else {
    console.log(`Using existing tenant: ${tenant.id} (${tenant.name})`);
  }

  const tenantId = tenant.id;

  // ── 2. Ensure there's at least one deployment to anchor act_ entries ─────────
  let deploymentId: string | undefined;
  const [dep] = await db
    .select({ id: deploymentsTable.id })
    .from(deploymentsTable)
    .where(eq(deploymentsTable.tenantId, tenantId))
    .limit(1);

  if (dep) {
    deploymentId = dep.id;
    console.log(`Using existing deployment: ${deploymentId}`);
  }

  // ── 3. Seed policy decisions — one per outcome ───────────────────────────────
  const outcomes = [
    {
      outcome: "allow" as const,
      principal: { id: "system", type: "system" as const },
      action: "deployment:create",
      reason: "System actor — always allowed",
      matchedRule: "system_allow",
    },
    {
      outcome: "deny" as const,
      principal: { id: "agt_deploy_bot", type: "agent" as const },
      action: "deployment:create",
      reason: "Agent actors cannot create deployments",
      matchedRule: "agent_deployment_create_deny",
    },
    {
      outcome: "require_approval" as const,
      principal: { id: "usr_alice", type: "user" as const },
      action: "deployment:create",
      reason: "User actors require approval for deployment creation",
      matchedRule: "user_deployment_create_require_approval",
    },
    {
      outcome: "require_approval" as const,
      principal: { id: "usr_bob", type: "user" as const },
      action: "deployment:status_update",
      reason: "User actors require approval for status transitions",
      matchedRule: "user_deployment_status_update_require_approval",
    },
    {
      outcome: "deny" as const,
      principal: { id: "agt_scheduler", type: "agent" as const },
      action: "deployment:status_update",
      reason: "Agent actors cannot update deployment status",
      matchedRule: "agent_deployment_status_update_deny",
    },
    {
      outcome: "allow" as const,
      principal: { id: "system", type: "system" as const },
      action: "deployment:status_update",
      reason: "System actor — always allowed",
      matchedRule: "system_allow",
    },
  ];

  console.log(`\nInserting ${outcomes.length} policy decisions...`);
  const pdecIds: string[] = [];

  for (const o of outcomes) {
    const pdecId = id("pdec_");
    pdecIds.push(pdecId);
    await db.insert(policyDecisionsTable).values({
      id: pdecId,
      tenantId,
      principalId: o.principal.id,
      principalType: o.principal.type,
      action: o.action,
      resourceType: "deployment",
      resourceId: deploymentId ?? id("dep_"),
      outcome: o.outcome,
      reason: o.reason,
      matchedRule: o.matchedRule,
      context: {
        allowed: o.outcome === "allow",
        evaluatedAt: new Date(
          Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
    });
    console.log(`  ✓ pdec_ [${o.outcome.padEnd(18)}] ${o.principal.type} / ${o.action}`);
  }

  // ── 4. Seed action ledger entries linked to policy decisions ─────────────────
  const ledgerEntries = [
    {
      actionType: "deployment:create" as const,
      actorId: "system",
      actorType: "system" as const,
      status: "executed" as const,
      policyDecisionId: pdecIds[0]!,
    },
    {
      actionType: "deployment:create" as const,
      actorId: "agt_deploy_bot",
      actorType: "agent" as const,
      status: "blocked" as const,
      policyDecisionId: pdecIds[1]!,
    },
    {
      actionType: "deployment:create" as const,
      actorId: "usr_alice",
      actorType: "user" as const,
      status: "approval_required" as const,
      policyDecisionId: pdecIds[2]!,
    },
    {
      actionType: "deployment:status_update" as const,
      actorId: "usr_bob",
      actorType: "user" as const,
      status: "approval_required" as const,
      policyDecisionId: pdecIds[3]!,
    },
    {
      actionType: "deployment:status_update" as const,
      actorId: "agt_scheduler",
      actorType: "agent" as const,
      status: "blocked" as const,
      policyDecisionId: pdecIds[4]!,
    },
    {
      actionType: "deployment:status_update" as const,
      actorId: "system",
      actorType: "system" as const,
      status: "executed" as const,
      policyDecisionId: pdecIds[5]!,
    },
  ];

  console.log(`\nInserting ${ledgerEntries.length} action ledger entries...`);

  for (const entry of ledgerEntries) {
    const actId = id("act_");
    await db.insert(actionLedgerTable).values({
      id: actId,
      tenantId,
      actionType: entry.actionType,
      actorId: entry.actorId,
      actorType: entry.actorType,
      status: entry.status,
      policyDecisionId: entry.policyDecisionId,
      deploymentId: deploymentId ?? undefined,
      requestPayload: { seeded: true },
      completedAt: entry.status !== "approval_required" ? new Date() : undefined,
    });
    console.log(`  ✓ act_ [${entry.status.padEnd(18)}] ${entry.actorType} / ${entry.actionType}`);
  }

  // ── 5. Seed one approval request for the alice approval_required entry ────────
  const aprId = id("apr_");
  const [aliceAct] = await db
    .select({ id: actionLedgerTable.id })
    .from(actionLedgerTable)
    .where(eq(actionLedgerTable.tenantId, tenantId))
    .orderBy(desc(actionLedgerTable.createdAt))
    .limit(1);

  if (aliceAct) {
    await db.insert(approvalRequestsTable).values({
      id: aprId,
      tenantId,
      resourceType: "deployment",
      resourceId: deploymentId ?? id("dep_"),
      action: "deployment:create",
      requesterId: "usr_alice",
      requestPayload: { seeded: true },
      status: "pending",
      actionLedgerEntryId: aliceAct.id,
    });
    console.log(`\n  ✓ apr_ [pending] usr_alice → deployment:create`);
  }

  console.log("\n✅ Phase 3 seed complete!");
  console.log(`   Tenant: ${tenantId}`);
  console.log(`   Policy decisions: ${pdecIds.length}`);
  console.log(`   Action ledger entries: ${ledgerEntries.length}`);
  console.log(`   Approval requests: 1`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
