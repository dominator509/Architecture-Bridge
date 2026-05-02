/**
 * Architecture-aligned prefixed ID generation.
 * Format: <prefix>_<nanoid-21>
 *
 * Prefixes (Blueprint v0.1):
 *   ten_  — Tenant
 *   wrk_  — Workspace
 *   env_  — Environment
 *   pkg_  — Package
 *   pkgv_ — PackageVersion
 *   dep_  — Deployment
 *   cfg_  — ConfigSnapshot
 *   aud_  — AuditEvent
 *   act_  — ActionLedgerEntry
 *   apr_  — ApprovalRequest
 */

import { customAlphabet } from "nanoid";

const nanoid = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  21,
);

const prefixed = (prefix: string) => `${prefix}_${nanoid()}`;

export const newTenantId = () => prefixed("ten");
export const newWorkspaceId = () => prefixed("wrk");
export const newEnvironmentId = () => prefixed("env");
export const newPackageId = () => prefixed("pkg");
export const newPackageVersionId = () => prefixed("pkgv");
export const newDeploymentId = () => prefixed("dep");
export const newConfigSnapshotId = () => prefixed("cfg");
export const newAuditEventId = () => prefixed("aud");
export const newActionLedgerId = () => prefixed("act");
export const newApprovalRequestId = () => prefixed("apr");
