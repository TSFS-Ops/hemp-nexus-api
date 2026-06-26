/**
 * P-5 Batch 7 — API, Dashboards & Visibility
 * Phase 1: Single Source of Truth (SSOT) registry.
 *
 * Locks the seven approved dashboards, role-based access matrix,
 * API v1 visible field allow-list, internal-only field block-list,
 * external status vocabulary, approved/banned external wording,
 * audit event names, export/report types, stale-data thresholds
 * and saved-view shapes.
 *
 * Every Batch 7 UI / RPC / projection / test / drift guard MUST import
 * from this file. This module is data-only — no runtime logic, no DB
 * calls, no side effects.
 *
 * Cross-batch contracts:
 *   - Finality + Memory remain owned by Batch 5 (p5_batch4_finality_records,
 *     p5_batch5_memory_records). Batch 7 reads only.
 *   - Exceptions / disputes / review queues remain owned by Batch 6
 *     (p5b6_*). Batch 7 reads only via Batch 6 safe projections.
 *   - No pg_cron jobs may be added by Batch 7.
 *   - No new edge functions may be added by Batch 7 (unless approved
 *     in a later phase).
 *   - Batch 8 surfaces are out of scope; tokens referencing Batch 8
 *     must not appear in Batch 7 files.
 */

export const P5_BATCH7_SCHEMA_VERSION = "p5b7.v1" as const;

// ────────────────────────────────────────────────────────────────────────────
// 1. Dashboards (7, role-based)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH7_DASHBOARDS = [
  "control_dashboard",
  "compliance_dashboard",
  "api_dashboard",
  "provider_dashboard",
  "org_dashboard",
  "funder_dashboard",
  "audit_dashboard",
] as const;

export type P5Batch7Dashboard = (typeof P5_BATCH7_DASHBOARDS)[number];

export interface P5Batch7DashboardDefinition {
  readonly code: P5Batch7Dashboard;
  readonly label: string;
  readonly route: string;
  readonly authorised_roles: ReadonlyArray<P5Batch7Role>;
  readonly is_admin_surface: boolean;
  readonly is_tenant_surface: boolean;
  readonly is_funder_surface: boolean;
  readonly description: string;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Roles (Batch 7 access matrix)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH7_ROLES = [
  "platform_admin",
  "operations_admin",
  "compliance_owner",
  "reviewer",
  "org_user",
  "funder_user",
  "api_client",
  "auditor",
] as const;

export type P5Batch7Role = (typeof P5_BATCH7_ROLES)[number];

export const P5_BATCH7_DASHBOARD_DEFINITIONS: Readonly<
  Record<P5Batch7Dashboard, P5Batch7DashboardDefinition>
> = {
  control_dashboard: {
    code: "control_dashboard",
    label: "Control Dashboard",
    route: "/admin/p5-batch7/control-dashboard",
    authorised_roles: ["platform_admin", "operations_admin", "compliance_owner"],
    is_admin_surface: true,
    is_tenant_surface: false,
    is_funder_surface: false,
    description: "Cross-platform health, throughput and blocker summary.",
  },
  compliance_dashboard: {
    code: "compliance_dashboard",
    label: "Compliance Dashboard",
    route: "/admin/p5-batch7/compliance-dashboard",
    authorised_roles: ["compliance_owner", "reviewer"],
    is_admin_surface: true,
    is_tenant_surface: false,
    is_funder_surface: false,
    description: "Compliance state, holds, finality blockers and review queues.",
  },
  api_dashboard: {
    code: "api_dashboard",
    label: "API Dashboard",
    route: "/admin/p5-batch7/api-dashboard",
    authorised_roles: ["platform_admin"],
    is_admin_surface: true,
    is_tenant_surface: false,
    is_funder_surface: false,
    description: "API client status, usage volume and field-visibility config.",
  },
  provider_dashboard: {
    code: "provider_dashboard",
    label: "Provider Dashboard",
    route: "/admin/p5-batch7/provider-dashboard",
    authorised_roles: ["platform_admin", "operations_admin"],
    is_admin_surface: true,
    is_tenant_surface: false,
    is_funder_surface: false,
    description: "Provider dependency status and stale-data signals.",
  },
  org_dashboard: {
    code: "org_dashboard",
    label: "Organisation Dashboard",
    route: "/desk/p5-batch7/org-dashboard",
    authorised_roles: ["org_user"],
    is_admin_surface: false,
    is_tenant_surface: true,
    is_funder_surface: false,
    description: "Tenant view of own cases, evidence and outstanding actions.",
  },
  funder_dashboard: {
    code: "funder_dashboard",
    label: "Funder Dashboard",
    route: "/funder/p5-batch7/funder-dashboard",
    authorised_roles: ["funder_user"],
    is_admin_surface: false,
    is_tenant_surface: false,
    is_funder_surface: true,
    description: "Funder read-only view scoped to granted cases.",
  },
  audit_dashboard: {
    code: "audit_dashboard",
    label: "Audit Dashboard",
    route: "/admin/p5-batch7/audit-dashboard",
    authorised_roles: ["auditor", "platform_admin"],
    is_admin_surface: true,
    is_tenant_surface: false,
    is_funder_surface: false,
    description: "Append-only audit event explorer for governance review.",
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 3. API v1 visible field allow-list (safe projection only)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Whitelist of fields the v1 API may expose. Any field outside this list
 * MUST NOT appear in any v1 API response, regardless of caller role.
 */
export const P5_BATCH7_API_V1_VISIBLE_FIELDS = [
  // Case identity
  "case_id",
  "case_reference",
  "case_status",
  "case_stage",
  "case_created_at",
  "case_updated_at",
  "as_of",
  "is_stale",
  // Organisation (scoped)
  "org_id",
  "org_reference",
  // Public counterparty surface
  "counterparty_reference",
  "counterparty_jurisdiction",
  // Evidence summary
  "evidence_summary_status",
  "evidence_items_count",
  "evidence_outstanding_count",
  // Finality (read-only summary from Batch 5)
  "finality_status",
  "finality_is_blocked",
  // Memory (read-only summary from Batch 5)
  "memory_linkage_status",
  // Exception summary (read-only from Batch 6)
  "open_exceptions_count",
  "open_blockers_count",
  // Funder visibility
  "funder_access_status",
  // Pagination / API envelope
  "page",
  "page_size",
  "total_count",
  "next_cursor",
] as const;

export type P5Batch7ApiV1Field = (typeof P5_BATCH7_API_V1_VISIBLE_FIELDS)[number];

// ────────────────────────────────────────────────────────────────────────────
// 4. Internal-only / forbidden external fields (block-list)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fields that must NEVER appear in any API response, dashboard render,
 * export payload or external surface. Drift guard greps for these tokens.
 */
export const P5_BATCH7_FORBIDDEN_EXTERNAL_FIELDS = [
  "raw_provider_payload",
  "raw_provider_response",
  "provider_api_key",
  "provider_secret",
  "internal_reviewer_note",
  "internal_risk_commentary",
  "private_compliance_note",
  "internal_dispute_commentary",
  "hidden_audit_metadata",
  "raw_audit_payload",
  "raw_memory_snapshot",
  "raw_finality_internal_metadata",
  "ai_unreviewed_draft",
  "ai_chain_of_thought",
  "credential_material",
  "encrypted_secret_blob",
  "ssn_value",
  "tax_id_value",
  "bank_account_number_raw",
  "report_scope_internals",
] as const;

export type P5Batch7ForbiddenField =
  (typeof P5_BATCH7_FORBIDDEN_EXTERNAL_FIELDS)[number];

// ────────────────────────────────────────────────────────────────────────────
// 5. External-facing status vocabulary
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH7_EXTERNAL_CASE_STATUSES = [
  "in_progress",
  "awaiting_evidence",
  "in_review",
  "on_hold",
  "blocked",
  "resolved",
  "closed",
  "withdrawn",
] as const;

export type P5Batch7ExternalCaseStatus =
  (typeof P5_BATCH7_EXTERNAL_CASE_STATUSES)[number];

export const P5_BATCH7_EXTERNAL_EVIDENCE_STATUSES = [
  "not_started",
  "in_progress",
  "submitted",
  "accepted",
  "rejected",
  "expired",
] as const;

export const P5_BATCH7_EXTERNAL_BLOCKER_STATUSES = [
  "open",
  "in_progress",
  "resolved",
  "withdrawn",
] as const;

export const P5_BATCH7_EXTERNAL_EXCEPTION_STATUSES = [
  "open",
  "in_review",
  "on_hold",
  "resolved",
  "closed",
] as const;

export const P5_BATCH7_EXTERNAL_FINALITY_STATUSES = [
  "not_finalised",
  "finalised",
  "blocked",
  "superseded",
] as const;

export const P5_BATCH7_EXTERNAL_MEMORY_STATUSES = [
  "active",
  "paused",
  "superseded",
  "not_applicable",
] as const;

export const P5_BATCH7_EXTERNAL_API_KEY_STATUSES = [
  "active",
  "rotating",
  "revoked",
  "expired",
] as const;

export const P5_BATCH7_EXTERNAL_EXPORT_STATUSES = [
  "queued",
  "in_progress",
  "ready",
  "failed",
  "expired",
] as const;

// ────────────────────────────────────────────────────────────────────────────
// 6. Approved + banned external wording
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH7_APPROVED_EXTERNAL_WORDING = [
  "Case in progress",
  "Awaiting evidence",
  "In review",
  "On hold",
  "Blocked",
  "Resolved",
  "Closed",
  "Data temporarily unavailable",
  "Awaiting provider response",
  "Access restricted",
  "Export ready",
] as const;

/**
 * Strings that MUST NOT appear in any external UI surface, API response,
 * export label or dashboard wording. Drift guard greps these tokens
 * case-insensitively.
 */
export const P5_BATCH7_BANNED_EXTERNAL_WORDING = [
  "fraud",
  "fraudulent",
  "suspicious",
  "blacklist",
  "blacklisted",
  "shady",
  "money laundering",
  "criminal",
  "guilty",
  "rejected by AI",
  "AI says",
  "GPT",
  "internal note",
  "private comment",
  "do not show",
  "off the record",
  "confidential reviewer",
] as const;

// ────────────────────────────────────────────────────────────────────────────
// 7. Audit event names (all p5b7.* prefix, append-only)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH7_AUDIT_EVENTS = [
  "p5b7.dashboard.viewed",
  "p5b7.saved_view.created",
  "p5b7.saved_view.updated",
  "p5b7.saved_view.deleted",
  "p5b7.export.requested",
  "p5b7.export.completed",
  "p5b7.export.failed",
  "p5b7.export.downloaded",
  "p5b7.sensitive_field.revealed",
  "p5b7.stale_data.acknowledged",
  "p5b7.api_key.viewed",
  "p5b7.api_config.changed",
  "p5b7.provider_status.refreshed",
  "p5b7.role_access.denied",
] as const;

export type P5Batch7AuditEvent = (typeof P5_BATCH7_AUDIT_EVENTS)[number];

// ────────────────────────────────────────────────────────────────────────────
// 8. Export / report types
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH7_EXPORT_TYPES = [
  "control_summary_csv",
  "compliance_summary_csv",
  "api_usage_csv",
  "provider_status_csv",
  "org_case_summary_csv",
  "funder_case_summary_csv",
  "audit_event_csv",
] as const;

export type P5Batch7ExportType = (typeof P5_BATCH7_EXPORT_TYPES)[number];

export interface P5Batch7ExportDefinition {
  readonly code: P5Batch7ExportType;
  readonly label: string;
  readonly authorised_roles: ReadonlyArray<P5Batch7Role>;
  readonly dashboard: P5Batch7Dashboard;
  readonly requires_reason: boolean;
}

export const P5_BATCH7_EXPORT_DEFINITIONS: Readonly<
  Record<P5Batch7ExportType, P5Batch7ExportDefinition>
> = {
  control_summary_csv: {
    code: "control_summary_csv",
    label: "Control summary (CSV)",
    authorised_roles: ["platform_admin", "operations_admin"],
    dashboard: "control_dashboard",
    requires_reason: true,
  },
  compliance_summary_csv: {
    code: "compliance_summary_csv",
    label: "Compliance summary (CSV)",
    authorised_roles: ["compliance_owner"],
    dashboard: "compliance_dashboard",
    requires_reason: true,
  },
  api_usage_csv: {
    code: "api_usage_csv",
    label: "API usage (CSV)",
    authorised_roles: ["platform_admin"],
    dashboard: "api_dashboard",
    requires_reason: true,
  },
  provider_status_csv: {
    code: "provider_status_csv",
    label: "Provider status (CSV)",
    authorised_roles: ["platform_admin", "operations_admin"],
    dashboard: "provider_dashboard",
    requires_reason: false,
  },
  org_case_summary_csv: {
    code: "org_case_summary_csv",
    label: "Case summary (CSV)",
    authorised_roles: ["org_user"],
    dashboard: "org_dashboard",
    requires_reason: false,
  },
  funder_case_summary_csv: {
    code: "funder_case_summary_csv",
    label: "Funder case summary (CSV)",
    authorised_roles: ["funder_user"],
    dashboard: "funder_dashboard",
    requires_reason: false,
  },
  audit_event_csv: {
    code: "audit_event_csv",
    label: "Audit events (CSV)",
    authorised_roles: ["auditor", "platform_admin"],
    dashboard: "audit_dashboard",
    requires_reason: true,
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 9. Stale-data thresholds (seconds since `as_of`)
// ────────────────────────────────────────────────────────────────────────────

export interface P5Batch7StaleThreshold {
  readonly surface: P5Batch7Dashboard | "api_v1";
  readonly warn_after_seconds: number;
  readonly fail_after_seconds: number;
}

export const P5_BATCH7_STALE_THRESHOLDS: ReadonlyArray<P5Batch7StaleThreshold> = [
  { surface: "control_dashboard",    warn_after_seconds: 300,   fail_after_seconds: 1800 },
  { surface: "compliance_dashboard", warn_after_seconds: 300,   fail_after_seconds: 1800 },
  { surface: "api_dashboard",        warn_after_seconds: 300,   fail_after_seconds: 1800 },
  { surface: "provider_dashboard",   warn_after_seconds: 120,   fail_after_seconds: 900 },
  { surface: "org_dashboard",        warn_after_seconds: 600,   fail_after_seconds: 3600 },
  { surface: "funder_dashboard",     warn_after_seconds: 600,   fail_after_seconds: 3600 },
  { surface: "audit_dashboard",      warn_after_seconds: 900,   fail_after_seconds: 3600 },
  { surface: "api_v1",               warn_after_seconds: 300,   fail_after_seconds: 1800 },
];

// ────────────────────────────────────────────────────────────────────────────
// 10. Saved-view shape (per-user dashboard filter persistence)
// ────────────────────────────────────────────────────────────────────────────

export interface P5Batch7SavedViewShape {
  readonly view_id: string;
  readonly user_id: string;
  readonly dashboard: P5Batch7Dashboard;
  readonly name: string;
  readonly filters: Readonly<Record<string, string | number | boolean | null>>;
  readonly sort_by: string | null;
  readonly sort_dir: "asc" | "desc" | null;
  readonly created_at: string;
  readonly updated_at: string;
}

// ────────────────────────────────────────────────────────────────────────────
// 11. Role → dashboard helper
// ────────────────────────────────────────────────────────────────────────────

export function p5Batch7DashboardsForRole(
  role: P5Batch7Role,
): ReadonlyArray<P5Batch7Dashboard> {
  return P5_BATCH7_DASHBOARDS.filter((d) =>
    P5_BATCH7_DASHBOARD_DEFINITIONS[d].authorised_roles.includes(role),
  );
}
