/**
 * Default-deny policy decision skeleton.
 *
 * Architecture boundary: this module is the ONLY place policy decisions are
 * made. All callers must go through evaluatePolicy() — never implement inline
 * allow/deny logic in route handlers.
 *
 * Current implementation: default-deny with a static allow-list of system
 * operations. Full rule engine (attribute-based, tenant-configured rules) is
 * a FUTURE-PHASE placeholder — see PlaceholderPolicyRule below.
 *
 * FUTURE PHASE — NOT IMPLEMENTED:
 *   - Tenant-configured rule sets stored in DB
 *   - Attribute-based access control (ABAC)
 *   - Time-bounded permissions
 *   - Provider-scoped action constraints
 *   - Agent capability envelope enforcement
 */

export type PrincipalType = "user" | "agent" | "system";

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
  allowed: boolean;
  reason: string;
  matchedRule: string | null;
  evaluatedAt: Date;
}

/**
 * FUTURE PHASE placeholder interface.
 * When the rule engine is implemented, rules will be loaded from the DB and
 * evaluated in priority order. This interface defines the contract.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface PlaceholderPolicyRule {
  id: string;
  tenantId: string;
  priority: number;
  effect: "allow" | "deny";
  principal?: { type?: PrincipalType; id?: string };
  actions: string[];
  resources: { type: string; id?: string }[];
  conditions?: Record<string, unknown>;
}

const SYSTEM_ALLOW_RULES: Array<{
  principalType: PrincipalType;
  actionPrefix: string;
  resourceType: string;
  ruleName: string;
}> = [
  {
    principalType: "system",
    actionPrefix: "",
    resourceType: "",
    ruleName: "system.full_access",
  },
];

export function evaluatePolicy(
  input: PolicyEvaluationInput,
): PolicyDecisionResult {
  const evaluatedAt = new Date();

  for (const rule of SYSTEM_ALLOW_RULES) {
    if (
      input.principal.type === rule.principalType &&
      (rule.actionPrefix === "" ||
        input.action.startsWith(rule.actionPrefix)) &&
      (rule.resourceType === "" ||
        input.resource.type === rule.resourceType)
    ) {
      return {
        allowed: true,
        reason: `Allowed by static rule: ${rule.ruleName}`,
        matchedRule: rule.ruleName,
        evaluatedAt,
      };
    }
  }

  return {
    allowed: false,
    reason:
      "Default deny: no matching allow rule found. Configure explicit allow rules to grant access.",
    matchedRule: null,
    evaluatedAt,
  };
}
