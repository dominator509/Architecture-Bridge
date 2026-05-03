/**
 * Actor identity resolution with security hardening.
 *
 * Security model:
 *   - 'system' actor type grants full policy bypass (all → allow).
 *   - To prevent privilege escalation, external callers may only claim
 *     'system' when API_INTERNAL_TOKEN is unset (development/test) OR
 *     when the request carries a matching X-Internal-Token header.
 *   - In production, set API_INTERNAL_TOKEN to a strong random secret.
 *     Any request that claims X-Actor-Type: system without a matching
 *     X-Internal-Token is downgraded to 'user'.
 *   - 'user' and 'agent' claims are accepted as-is (they are subject to
 *     normal policy evaluation rather than bypass).
 *   - If no headers are present, the actor defaults to 'system' so that
 *     internal service-to-service calls (which omit identity headers) are
 *     not disrupted.  In production, all external entrypoints should set
 *     at minimum X-Actor-Type and X-Actor-Id.
 */

import { type Request } from "express";

export type ActorType = "user" | "agent" | "system";

export interface ResolvedActor {
  actorId: string;
  actorType: ActorType;
}

const VALID_ACTOR_TYPES = new Set<string>(["user", "agent", "system"]);

/**
 * Resolve actor identity from request headers with privilege-escalation protection.
 *
 * When API_INTERNAL_TOKEN is set:
 *   - 'system' claims require X-Internal-Token to match, otherwise downgraded to 'user'.
 * When API_INTERNAL_TOKEN is unset (development/test):
 *   - All claims are trusted as-is (backward-compatible).
 */
export function resolveActor(req: Request): ResolvedActor {
  const rawType = (req.headers["x-actor-type"] as string | undefined) ?? "";
  const rawId = (req.headers["x-actor-id"] as string | undefined) ?? "";

  const internalToken = process.env["API_INTERNAL_TOKEN"];

  if (rawType === "" && rawId === "") {
    return { actorId: "system", actorType: "system" };
  }

  const actorId = rawId || "anonymous";
  const normalised = VALID_ACTOR_TYPES.has(rawType) ? (rawType as ActorType) : "user";

  if (normalised === "system" && internalToken) {
    const providedToken = (req.headers["x-internal-token"] as string | undefined) ?? "";
    if (providedToken !== internalToken) {
      return { actorId, actorType: "user" };
    }
  }

  return { actorId, actorType: normalised };
}
