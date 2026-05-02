import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tenantsRouter from "./tenants";
import workspacesRouter from "./workspaces";
import environmentsRouter from "./environments";
import packagesRouter from "./packages";
import deploymentsRouter from "./deployments";
import auditRouter from "./audit";
import actionLedgerRouter from "./actionLedger";
import approvalsRouter from "./approvals";
import policyRouter from "./policy";

const router: IRouter = Router();

// Health
router.use(healthRouter);

// Tenants (no tenant-context middleware — these create/read tenants)
router.use(tenantsRouter);

// Workspaces — /tenants/:tenantId/workspaces
router.use("/tenants/:tenantId/workspaces", workspacesRouter);

// Environments — /tenants/:tenantId/workspaces/:workspaceId/environments
router.use(
  "/tenants/:tenantId/workspaces/:workspaceId/environments",
  environmentsRouter,
);

// Packages & package versions — /tenants/:tenantId/packages
router.use("/tenants/:tenantId/packages", packagesRouter);

// Deployments & config snapshots
router.use("/tenants/:tenantId", deploymentsRouter);

// Audit events — /tenants/:tenantId/audit-events
router.use("/tenants/:tenantId/audit-events", auditRouter);

// Action ledger — /tenants/:tenantId/action-ledger
router.use("/tenants/:tenantId/action-ledger", actionLedgerRouter);

// Approvals — /tenants/:tenantId/approvals
router.use("/tenants/:tenantId/approvals", approvalsRouter);

// Policy — /tenants/:tenantId/policy
router.use("/tenants/:tenantId/policy", policyRouter);

export default router;
