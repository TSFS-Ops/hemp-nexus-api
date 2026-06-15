/**
 * Centralized application constants
 *
 * Every "magic" value that was previously scattered across components
 * now lives here as a named, documented constant.
 */

// ─── Roles ──────────────────────────────────────────────────────────
/** Application-level roles stored in user_roles table */
export const APP_ROLES = {
  PLATFORM_ADMIN: 'platform_admin',
  ORG_ADMIN: 'org_admin',
  ORG_MEMBER: 'org_member',
  BUYER: 'buyer',
  AUDITOR: 'auditor',
  COMPLIANCE_ANALYST: 'compliance_analyst',
} as const;

export type AppRole = (typeof APP_ROLES)[keyof typeof APP_ROLES];

/** Roles that grant platform-admin level access */
export const PLATFORM_ADMIN_ROLES: readonly string[] = [
  APP_ROLES.PLATFORM_ADMIN,
] as const;


// ─── Routes ─────────────────────────────────────────────────────────
export const ROUTES = {
  ROOT: '/',
  AUTH: '/auth',
  
  DASHBOARD: '/dashboard',
  DASHBOARD_SEARCH: '/dashboard/search',
  DASHBOARD_ORDER_BOOK: '/dashboard/order-book',
  DASHBOARD_MATCHES: '/dashboard/matches',
  DASHBOARD_SETTINGS: '/dashboard/settings',
  DASHBOARD_ACCOUNT: '/dashboard/account',
  DASHBOARD_COMPLIANCE: '/dashboard/compliance',
  DASHBOARD_PROGRAMMES: '/dashboard/programmes',
  ADMIN: '/admin',
  // OPERATIONS
  ADMIN_DEALS: '/admin/deals',
  ADMIN_ORDER_BOOK: '/admin/order-book',
  // TRUST & INTEGRITY
  ADMIN_COMPLIANCE: '/admin/compliance',
  ADMIN_AUDIT: '/admin/audit',
  ADMIN_LEDGER: '/admin/ledger',
  // ENTITIES
  ADMIN_USERS: '/admin/users',
  ADMIN_ORGS: '/admin/orgs',
  // DEVELOPER
  ADMIN_API_KEYS: '/admin/api-keys',
  ADMIN_WEBHOOKS: '/admin/webhooks',
  ADMIN_SYSTEM_LOGS: '/admin/system-logs',
  // GOVERNANCE
  ADMIN_DATA_GOVERNANCE: '/admin/data-governance',
  ADMIN_PROGRAMMES: '/admin/programmes',
  ADMIN_HEALTH: '/admin/health',
  ADMIN_INTEGRITY: '/admin/integrity',
  ADMIN_ENGAGEMENTS: '/admin/engagements',
  ADMIN_SETTINGS: '/admin/settings',
  ADMIN_OVERRIDES: '/admin/overrides',
  // Legacy aliases
  ADMIN_USERS_ORGS: '/admin/users',
  ADMIN_INFRASTRUCTURE: '/admin/infrastructure',
  PRICING: '/pricing',
  DASHBOARD_BILLING: '/dashboard/billing',
  BILLING: '/dashboard/billing',
  DOCS: '/docs',
  WALKTHROUGH: '/walkthrough',
} as const;

// ─── Match statuses ─────────────────────────────────────────────────
export const MATCH_STATUS = {
  MATCHED: 'matched',
  SETTLED: 'settled',
} as const;

export type MatchStatus = (typeof MATCH_STATUS)[keyof typeof MATCH_STATUS];

// ─── Signal types (reserved for future SDK use) ────────────────────

// ─── Trade approval statuses ────────────────────────────────────────
export const TRADE_APPROVAL_STATUS = {
  APPROVED: 'approved',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
  PENDING: 'pending',
} as const;

// ─── API key / webhook statuses ─────────────────────────────────────
export const RESOURCE_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
  PENDING: 'pending',
} as const;


// ─── Risk bands ─────────────────────────────────────────────────────
export const RISK_BAND = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const;

// ─── Timing constants ───────────────────────────────────────────────

/** Renewal period for trade approvals (years) */
export const TRADE_APPROVAL_RENEWAL_YEARS = 1;

/** Days before expiry to flag as "expiring soon" */
export const EXPIRY_WARNING_DAYS = 30;

// ─── Query limits ───────────────────────────────────────────────────
/** Default page size for admin list views */
export const QUERY_LIMIT_ADMIN = 200;


// ─── Hostnames ──────────────────────────────────────────────────────
// Production architecture (confirmed by client, 2026-05-04):
//  - www.izenzo.co.za / izenzo.co.za  → public Mother Ship marketing site
//  - api.trade.izenzo.co.za           → live authenticated console
//                                       (POI, WaD, billing, admin, compliance,
//                                        trading desk, developer/API tools,
//                                        execution workflows, dashboard)
//  - trade.izenzo.co.za               → RESERVED for future commodity
//                                       marketplace verticals; must show a
//                                       holding page, never the live console.
//  - api.izenzo.co.za                 → NOT in use; do not link to it.
export const HOSTNAMES = {
  CONSOLE: 'api.trade.izenzo.co.za',
  MARKETPLACE: 'trade.izenzo.co.za',
  PUBLIC: 'izenzo.co.za',
  PUBLIC_WWW: 'www.izenzo.co.za',
} as const;

// ─── Miscellaneous ──────────────────────────────────────────────────
/** Org-ID substring length shown in admin tables */
export const ORG_ID_PREVIEW_LENGTH = 8;
