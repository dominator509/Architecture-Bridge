import { Router, type IRouter } from "express";
import { evaluatePolicy } from "../lib/policy";
import { emitAuditEvent, auditEventTypes } from "../lib/audit";
import {
  resolveTenantContext,
  requireActiveTenant,
} from "../lib/tenantContext";

const router: IRouter = Router({ mergeParams: true });
const AET = auditEventTypes();

router.use(resolveTenantContext);
router.use(requireActiveTenant);

router.post("/evaluate", async (req, res, next) => {
  try {
    const tenantId = res.locals.tenantId!;
    const { principal, action, resource, context } = req.body as {
      principal?: { id: string; type: string };
      action?: string;
      resource?: { type: string; id: string };
      context?: Record<string, unknown>;
    };

    if (!principal?.id || !principal?.type || !action || !resource?.type || !resource?.id) {
      res.status(400).json({
        error: "principal (id, type), action, and resource (type, id) are required",
      });
      return;
    }

    const decision = evaluatePolicy({
      principal: {
        id: principal.id,
        type: principal.type as "user" | "agent" | "system",
      },
      action,
      resource,
      context,
    });

    await emitAuditEvent({
      tenantId,
      actorId: principal.id,
      actorType: principal.type as "user" | "agent" | "system",
      eventType: AET.policy.evaluated,
      resourceType: resource.type,
      resourceId: resource.id,
      payload: { action, allowed: decision.allowed, reason: decision.reason },
    });

    res.json({
      allowed: decision.allowed,
      reason: decision.reason,
      matchedRule: decision.matchedRule,
      evaluatedAt: decision.evaluatedAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
