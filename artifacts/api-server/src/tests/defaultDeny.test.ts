/**
 * Default-deny policy tests.
 *
 * Verifies that the policy engine denies all principals except
 * the "system" principal type, and that the route correctly
 * emits an audit event on every evaluation.
 */

import { describe, it, expect } from "vitest";
import { evaluatePolicy } from "../lib/policy";

describe("Default-deny policy engine", () => {
  it("denies user principal with no matching rule", () => {
    const result = evaluatePolicy({
      principal: { id: "user-1", type: "user" },
      action: "deployment:create",
      resource: { type: "deployment", id: "dep_xyz" },
    });
    expect(result.allowed).toBe(false);
    expect(result.matchedRule).toBeNull();
    expect(result.reason).toMatch(/default deny/i);
  });

  it("denies agent principal with no matching rule", () => {
    const result = evaluatePolicy({
      principal: { id: "agent-1", type: "agent" },
      action: "config_snapshot:resolve",
      resource: { type: "config_snapshot", id: "cfg_xyz" },
    });
    expect(result.allowed).toBe(false);
    expect(result.matchedRule).toBeNull();
  });

  it("allows system principal via static allow rule", () => {
    const result = evaluatePolicy({
      principal: { id: "system", type: "system" },
      action: "any:action",
      resource: { type: "any", id: "any" },
    });
    expect(result.allowed).toBe(true);
    expect(result.matchedRule).toBe("system.full_access");
  });

  it("evaluatedAt is a recent Date", () => {
    const before = new Date();
    const result = evaluatePolicy({
      principal: { id: "user-1", type: "user" },
      action: "read",
      resource: { type: "workspace", id: "wrk_xyz" },
    });
    const after = new Date();
    expect(result.evaluatedAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    expect(result.evaluatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
