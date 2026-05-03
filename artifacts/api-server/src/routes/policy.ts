/**
 * Policy router.
 *
 * Phase 3: evaluatePolicy now returns all 4 outcomes (allow / deny /
 * require_approval / require_escalation). Every call to POST /evaluate
 * stores a pdec_ record and emits an audit event.
 *
 * New route:
 *   GET /tenants/:tenantId/policy/decisions — paginated list of stored
 *   policy decisions for the tenant.
 */

import { Router, type IRouter } from "express";
import { db, policyDecisionsTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { evaluatePolicy, storePolicyDecision } from "../lib/policy";
import { emitAuditEvent, auditEventTypes } from "../lib/audit";
import {
  resolveTenantContext,
  requireActiveTenant,
} from "../lib/tenantContext";

const router: IRouter = Router({ mergeParams: true });
const AET = auditEventTypes();

router.use(resolveTenantContext);
router.use(requireActiveTenant);

// ── POST /tenants/:tenantId/policy/evaluate ───────────────────────────────────
// Phase 3: stores a pdec_ record and returns 4-outcome result.
router.post("/evaluate", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { principal, action, resource, context } = req.body as {
      principal?: { id: string; type: string };
      action?: string;
      resource?: { type: string; id: string };
      context?: Record<string, unknown>;
    };

    if (
      !principal?.id ||
      !principal?.type ||
      !action ||
      !resource?.type ||
      !resource?.id
    ) {
      res.status(400).json({
        error:
          "principal (id, type), action, and resource (type, id) are required",
      });
      return;
    }

    const principalType = (
      ["user", "agent", "system"] as const
    ).includes(principal.type as "user" | "agent" | "system")
      ? (principal.type as "user" | "agent" | "system")
      : "user";

    const result = evaluatePolicy({
      principal: { id: principal.id, type: principalType },
      action,
      resource,
      context,
    });

    const policyDecisionId = await storePolicyDecision({
      tenantId,
      principal: { id: principal.id, type: principalType },
      action,
      resource,
      result,
      context,
    });

    await emitAuditEvent({
      tenantId,
      actorId: principal.id,
      actorType: principalType,
      eventType: AET.policyDecision.stored,
      resourceType: "policy_decision",
      resourceId: policyDecisionId,
      payload: {
        action,
        outcome: result.outcome,
        allowed: result.allowed,
        reason: result.reason,
        matchedRule: result.matchedRule,
      },
    });

    res.json({
      id: policyDecisionId,
      outcome: result.outcome,
      allowed: result.allowed,
      reason: result.reason,
      matchedRule: result.matchedRule,
      evaluatedAt: result.evaluatedAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /tenants/:tenantId/policy/decisions ───────────────────────────────────
// List stored policy decisions for the tenant.
router.get("/decisions", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { outcome, principalId, action } = req.query as Record<
      string,
      string | undefined
    >;
    const limit = Math.min(Number(req.query["limit"] ?? 100), 500);
    const offset = Number(req.query["offset"] ?? 0);

    const conditions = [eq(policyDecisionsTable.tenantId, tenantId)];
    if (outcome)
      conditions.push(
        eq(
          policyDecisionsTable.outcome,
          outcome as
            | "allow"
            | "deny"
            | "require_approval"
            | "require_escalation",
        ),
      );
    if (principalId)
      conditions.push(eq(policyDecisionsTable.principalId, principalId));
    if (action) conditions.push(eq(policyDecisionsTable.action, action));

    const where = and(...conditions);

    const [items, [{ total }]] = await Promise.all([
      db
        .select()
        .from(policyDecisionsTable)
        .where(where)
        .orderBy(desc(policyDecisionsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(policyDecisionsTable).where(where),
    ]);

    res.json({ items, total: Number(total), limit, offset });
  } catch (err) {
    next(err);
  }
});

export default router;
