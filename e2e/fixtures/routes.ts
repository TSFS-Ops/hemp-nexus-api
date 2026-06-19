/**
 * Direct-link route matrix — SINGLE SOURCE OF TRUTH.
 *
 * Drives:
 *   - e2e/role-negative/route-access.spec.ts   (assertion per role × route)
 *   - e2e/role-negative/direct-links.spec.ts   (deep-link denial proofs)
 *   - e2e/role-negative/tenant-isolation.spec.ts (Org A user vs Org B record)
 *   - scripts/check-role-negative-e2e-coverage.mjs (release-gate guard)
 *
 * If you add a protected route to the app, add it here. The coverage guard
 * will fail CI until every route is present in this matrix AND covered by
 * a spec assertion.
 */

import type { Role } from "./users";
import type { RecordKey } from "./records";

export type RouteKind = "page" | "download" | "api";

export type RouteEntry = {
  /** Canonical path template, with :id placeholders. */
  path: string;
  /** Roles that should successfully access this route. */
  allowedRoles: ReadonlyArray<Role>;
  /** True when access is also bounded by the caller's tenant. */
  tenantScoped: boolean;
  /** Seeded record needed to materialise :id, if any. */
  recordKey?: RecordKey;
  kind: RouteKind;
  /** Why each disallowed role is denied — for evidence rows. */
  denialReason: string;
};

export const ROUTE_MATRIX: ReadonlyArray<RouteEntry> = [
  // HQ / admin surfaces — platform_admin only (compliance_analyst gets /hq/compliance only)
  { path: "/hq",                       allowedRoles: ["platform_admin"],                       tenantScoped: false, kind: "page",     denialReason: "HQ is platform_admin only" },
  { path: "/hq/audit",                 allowedRoles: ["platform_admin"],                       tenantScoped: false, kind: "page",     denialReason: "Audit surface is platform_admin only" },
  { path: "/hq/compliance",            allowedRoles: ["platform_admin", "compliance_analyst"], tenantScoped: false, kind: "page",     denialReason: "Compliance queue requires compliance role" },
  { path: "/hq/governance-export",     allowedRoles: ["platform_admin"],                       tenantScoped: false, kind: "page",     denialReason: "Governance export admin is platform_admin only" },
  { path: "/hq/refunds",               allowedRoles: ["platform_admin"],                       tenantScoped: false, kind: "page",     denialReason: "Refund admin is platform_admin only" },
  { path: "/hq/api-clients",           allowedRoles: ["platform_admin"],                       tenantScoped: false, kind: "page",     denialReason: "API client admin is platform_admin only" },

  // Developer surfaces — api_client_admin in own org, plus platform_admin
  { path: "/developer",                allowedRoles: ["platform_admin", "api_client_admin"],   tenantScoped: true,  kind: "page",     denialReason: "Developer area requires api_client_admin in own org" },
  { path: "/developer/api-keys",       allowedRoles: ["platform_admin", "api_client_admin"],   tenantScoped: true,  kind: "page",     denialReason: "API key surface requires api_client_admin in own org" },
  { path: "/developer/usage",          allowedRoles: ["platform_admin", "api_client_admin"],   tenantScoped: true,  kind: "page",     denialReason: "Own-usage dashboard requires api_client_admin in own org" },

  // Governance — platform_admin
  { path: "/governance",               allowedRoles: ["platform_admin"],                       tenantScoped: false, kind: "page",     denialReason: "Governance admin is platform_admin only" },
  { path: "/governance/export/:id",    allowedRoles: ["platform_admin"],                       tenantScoped: true,  recordKey: "governanceExportId", kind: "page", denialReason: "Governance export download is platform_admin + tenant-scoped" },

  // Tenant-scoped records
  { path: "/trades/:id",               allowedRoles: ["platform_admin", "requester_trader", "counterparty_user", "compliance_analyst"], tenantScoped: true, recordKey: "tradeRequestId",      kind: "page", denialReason: "Trade visibility requires party or compliance role within tenant" },
  { path: "/matches/:id",              allowedRoles: ["platform_admin", "requester_trader", "counterparty_user", "compliance_analyst"], tenantScoped: true, recordKey: "matchId",             kind: "page", denialReason: "Match visibility limited to parties + compliance within tenant" },
  { path: "/poi/:id",                  allowedRoles: ["platform_admin", "requester_trader", "counterparty_user", "compliance_analyst"], tenantScoped: true, recordKey: "poiId",               kind: "page", denialReason: "POI visibility limited to parties + compliance within tenant" },
  { path: "/wad/:id",                  allowedRoles: ["platform_admin", "requester_trader", "counterparty_user", "compliance_analyst"], tenantScoped: true, recordKey: "wadId",               kind: "page", denialReason: "WaD visibility limited to parties + compliance within tenant" },
  { path: "/refunds/:id",              allowedRoles: ["platform_admin", "requester_trader"],                                            tenantScoped: true, recordKey: "refundRequestId",     kind: "page", denialReason: "Refund detail requires requester or platform_admin" },

  // Protected downloads
  { path: "/documents/:id/download",   allowedRoles: ["platform_admin", "requester_trader", "counterparty_user", "compliance_analyst"], tenantScoped: true, recordKey: "documentId",          kind: "download", denialReason: "Document download requires party role within tenant" },
  { path: "/exports/:id/download",     allowedRoles: ["platform_admin"],                                                                tenantScoped: true, recordKey: "governanceExportId",  kind: "download", denialReason: "Export download is platform_admin + tenant-scoped" },

  // API key admin routes
  { path: "/api/keys/:id",             allowedRoles: ["platform_admin"],                                                                tenantScoped: true, recordKey: "apiKeyId",            kind: "api",      denialReason: "API key admin route is platform_admin only" },
  { path: "/api/usage",                allowedRoles: ["platform_admin", "api_client_admin"],                                            tenantScoped: true,                                    kind: "api",      denialReason: "API usage endpoint requires platform_admin or api_client_admin in own org" },
];

/** Used by the coverage guard to enumerate matrix paths. */
export const ROUTE_PATHS = ROUTE_MATRIX.map((r) => r.path);
