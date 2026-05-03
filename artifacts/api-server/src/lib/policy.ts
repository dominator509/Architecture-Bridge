/**
 * Phase 3 Policy Engine.
 *
 * Architecture boundary: this module is the ONLY place policy decisions are
 * made. All callers must go through evaluatePolicy() — never implement inline
 * allow/deny logic in route handlers.
 *
 * Phase 3 outcomes (4):
 *   allow             — principal may execute the action immediately
 *   deny              — principal is blocked; action must not execute
 *   require_approval  — principal must obtain explicit approval before action executes
 *   require_escalation — action requires escalation to a higher authority
 *
 * Phase 3 static rules (evaluated in priority order, first match wins):
 *   1. system.full_access              — system principal → allow (any action, any resource)
 *   2. user.deployment_create.require_approval
 *                                      — user + deployment:create → require_approval
 *   3. agent.deployment_create.deny    — agent + deployment:create → deny
 *   4. user.deployment_status_update.require_approval
 *                                      — user + deployment:status_update → require_approval
 *   5. agent.deployment_status_update.deny
 *                                      — agent + deployment:status_update → deny
 *   Default (no match)                 — deny
 *
 * FUTURE PHASE — NOT IMPLEMENTED:
 *   - Tenant-configured rule sets stored in DB
 *   - Attribute-based access control (ABAC)
 *   - Time-bounded permissions
 *   - Provider-scoped action constraints
 *   - Agent capability envelope enforcement
 *   - Dynamic rule priority ordering
 */

import { db, policyDecisionsTable } from "@workspace/db";
import { newPolicyDecisionId } from "./ids";
import { logger } from "./logger";

export type PrincipalType = "user" | "agent" | "system";
export type PolicyOutcome =
  | "allow"
  | "deny"
  | "require_approval"
  | "require_escalation";

export interface PolicyPrincipal {
  id: string;
  type: PrincipalType;
}

export interface PolicyResource {
  type: string;
  id: string;
}

export interface PolicyContext {
  tenantId: string;
  [key: string]: unknown;
}

export interface PolicyEvaluationInput {
  principal: PolicyPrincipal;
  action: string;
  resource: PolicyResource;
  context?: Record<string, unknown>;
}

export interface PolicyDecisionResult {
  outcome: PolicyOutcome;
  /** Convenience: true only when outcome === "allow" */
  allowed: boolean;
  reason: string;
  matchedRule: string | null;
  evaluatedAt: Date;
}

interface Phase3Rule {
  principalType: PrincipalType | null;
  action: string | null;
  resourceType: string | null;
  outcome: PolicyOutcome;
  ruleName: string;
}

/**
 * Phase 3 static rule table. Rules are evaluated top-to-bottom; first match wins.
 * null fields are wildcards (match anything).
 */
const PHASE3_RULES: Phase3Rule[] = [
  {
    principalType: "system",
    action: null,
    resourceType: null,
    outcome: "allow",
    ruleName: "system.full_access",
  },
  {
    principalType: "user",
    action: "deployment:create",
    resourceType: null,
    outcome: "require_approval",
    ruleName: "user.deployment_create.require_approval",
  },
  {
    principalType: "agent",
    action: "deployment:create",
    resourceType: null,
    outcome: "deny",
    ruleName: "agent.deployment_create.deny",
  },
  {
    principalType: "user",
    action: "deployment:status_update",
    resourceType: null,
    outcome: "require_approval",
    ruleName: "user.deployment_status_update.require_approval",
  },
  {
    principalType: "agent",
    action: "deployment:status_update",
    resourceType: null,
    outcome: "deny",
    ruleName: "agent.deployment_status_update.deny",
  },
];

export function evaluatePolicy(
  input: PolicyEvaluationInput,
): PolicyDecisionResult {
  const evaluatedAt = new Date();

  for (const rule of PHASE3_RULES) {
    const principalMatches =
      rule.principalType === null ||
      rule.principalType === input.principal.type;
    const actionMatches =
      rule.action === null || rule.action === input.action;
    const resourceMatches =
      rule.resourceType === null ||
      rule.resourceType === input.resource.type;

    if (principalMatches && actionMatches && resourceMatches) {
      return {
        outcome: rule.outcome,
        allowed: rule.outcome === "allow",
        reason: `Matched rule: ${rule.ruleName}`,
        matchedRule: rule.ruleName,
        evaluatedAt,
      };
    }
  }

  return {
    outcome: "deny",
    allowed: false,
    reason:
      "Default deny: no matching allow rule found. Configure explicit allow rules to grant access.",
    matchedRule: null,
    evaluatedAt,
  };
}

/**
 * Persist a policy decision as a pdec_ record.
 * Called by every protected mutation immediately after evaluatePolicy().
 * Returns the generated pdec_ ID.
 * Fire-and-forget safe: logs errors but does not throw.
 */
export async function storePolicyDecision(params: {
  tenantId: string;
  principal: PolicyPrincipal;
  action: string;
  resource: PolicyResource;
  result: PolicyDecisionResult;
  context?: Record<string, unknown>;
}): Promise<string> {
  const id = newPolicyDecisionId();
  try {
    await db.insert(policyDecisionsTable).values({
      id,
      tenantId: params.tenantId,
      principalId: params.principal.id,
      principalType: params.principal.type,
      action: params.action,
      resourceType: params.resource.type,
      resourceId: params.resource.id,
      outcome: params.result.outcome,
      matchedRule: params.result.matchedRule ?? undefined,
      reason: params.result.reason,
      context: params.context,
    });
  } catch (err) {
    logger.error({ err, params }, "Failed to store policy decision");
  }
  return id;
}
