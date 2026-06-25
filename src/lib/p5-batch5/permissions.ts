/**
 * P-5 Batch 5 — Phase 4
 * Permission matrix (9 roles × 14 capability flags).
 *
 * Pure TS. No DB migrations, no UI. RLS / RPC role gating in earlier phases
 * remains the authoritative server-side enforcement; this module is the
 * single source of truth for client/edge composition of those checks.
 */

export const P5B5_ROLES = [
  "platform_super_admin",
  "platform_compliance_admin",
  "organisation_owner_admin",
  "organisation_user_contributor",
  "counterparty_applicant",
  "funder",
  "external_api_client",
  "auditor_regulator_legal",
  "support_user",
] as const;
export type P5B5Role = (typeof P5B5_ROLES)[number];

export const P5B5_CAPABILITIES = [
  "can_view_full_memory",
  "can_view_org_memory",
  "can_view_case_finality",
  "can_create_finality",
  "can_request_finality",
  "can_add_correction",
  "can_mark_dispute",
  "can_resolve_dispute",
  "can_supersede_finality",
  "can_export_finality_summary",
  "can_export_audit_pack",
  "can_view_api_safe_preview",
  "can_view_funder_lane",
  "can_view_raw_provider_summary",
] as const;
export type P5B5Capability = (typeof P5B5_CAPABILITIES)[number];

export type P5B5CapabilityFlags = Record<P5B5Capability, boolean>;

/**
 * Context flags the matrix consults. All optional. Missing context flags
 * default to "not granted" — never grant on absence.
 */
export interface P5B5PermissionContext {
  /** The acting user's organisation id. */
  acting_organisation_id?: string | null;
  /** The organisation that owns the record being inspected. */
  record_organisation_id?: string | null;
  /** Case ids the user has been explicitly assigned to. */
  assigned_case_ids?: ReadonlyArray<string>;
  /** The case id being inspected (if any). */
  case_id?: string | null;
  /** True when the funder has an active access grant for the case. */
  has_funder_lane_access?: boolean;
  /** API scopes proven by the bearer key. */
  api_scopes?: ReadonlyArray<P5B5ApiScope>;
  /** True when the auditor has a signed mandate covering the record. */
  has_auditor_mandate?: boolean;
  /** Support has opened a documented escalation channel. */
  support_escalation_active?: boolean;
}

export const P5B5_API_SCOPES = [
  "finality.read",
  "evidence_rating.read",
  "audit.read",
  "provider_dependency.read",
  "funder_lane.read",
] as const;
export type P5B5ApiScope = (typeof P5B5_API_SCOPES)[number];

export type P5B5FinalityAction =
  | "create_finality"
  | "request_finality"
  | "add_correction"
  | "mark_dispute"
  | "resolve_dispute"
  | "supersede_finality";

export type P5B5ExportType = "finality_summary" | "audit_pack";

const NONE: P5B5CapabilityFlags = Object.freeze(
  Object.fromEntries(
    P5B5_CAPABILITIES.map((c) => [c, false]),
  ) as P5B5CapabilityFlags,
);

function flags(overrides: Partial<P5B5CapabilityFlags>): P5B5CapabilityFlags {
  return { ...NONE, ...overrides };
}

function sameOrg(ctx: P5B5PermissionContext): boolean {
  return Boolean(
    ctx.acting_organisation_id &&
      ctx.record_organisation_id &&
      ctx.acting_organisation_id === ctx.record_organisation_id,
  );
}

function caseAssigned(ctx: P5B5PermissionContext): boolean {
  if (!ctx.case_id) return false;
  return Boolean(ctx.assigned_case_ids?.includes(ctx.case_id));
}

/**
 * The 9-role × 14-capability matrix.
 *
 * Server-side gates (RLS, security-definer RPCs from Phases 1-3) remain
 * authoritative. This function MUST stay consistent with those gates; it
 * is intentionally conservative — when in doubt, deny.
 */
export function getP5B5Capabilities(
  role: P5B5Role,
  context: P5B5PermissionContext = {},
): P5B5CapabilityFlags {
  switch (role) {
    case "platform_super_admin":
      // Full visibility, full governance actions, full exports.
      return flags({
        can_view_full_memory: true,
        can_view_org_memory: true,
        can_view_case_finality: true,
        can_create_finality: true,
        can_request_finality: true,
        can_add_correction: true,
        can_mark_dispute: true,
        can_resolve_dispute: true,
        can_supersede_finality: true,
        can_export_finality_summary: true,
        can_export_audit_pack: true,
        can_view_api_safe_preview: true,
        can_view_funder_lane: true,
        can_view_raw_provider_summary: true,
      });

    case "platform_compliance_admin":
      // Full compliance powers; cannot supersede (Phase 2 RPC: super-admin only).
      return flags({
        can_view_full_memory: true,
        can_view_org_memory: true,
        can_view_case_finality: true,
        can_create_finality: true,
        can_request_finality: true,
        can_add_correction: true,
        can_mark_dispute: true,
        can_resolve_dispute: true,
        can_supersede_finality: false,
        can_export_finality_summary: true,
        can_export_audit_pack: true,
        can_view_api_safe_preview: true,
        can_view_funder_lane: true,
        can_view_raw_provider_summary: true,
      });

    case "organisation_owner_admin":
      // Their own organisation only.
      if (!sameOrg(context)) return NONE;
      return flags({
        can_view_org_memory: true,
        can_view_case_finality: true,
        can_request_finality: true,
        can_mark_dispute: true,
        can_export_finality_summary: true,
        can_view_api_safe_preview: true,
      });

    case "organisation_user_contributor":
      // Own org AND explicitly assigned to the case.
      if (!sameOrg(context) || !caseAssigned(context)) return NONE;
      return flags({
        can_view_org_memory: true,
        can_view_case_finality: true,
        can_request_finality: true,
        can_view_api_safe_preview: true,
      });

    case "counterparty_applicant":
      // Sees only finality and dispute marker for cases they are party to.
      if (!caseAssigned(context)) return NONE;
      return flags({
        can_view_case_finality: true,
        can_mark_dispute: true,
      });

    case "funder":
      if (!context.has_funder_lane_access) return NONE;
      return flags({
        can_view_case_finality: true,
        can_view_funder_lane: true,
        can_view_api_safe_preview: true,
      });

    case "external_api_client": {
      const scopes = new Set(context.api_scopes ?? []);
      if (!scopes.has("finality.read")) return NONE;
      return flags({
        can_view_case_finality: true,
        can_view_api_safe_preview: true,
        // raw provider summary only when explicitly scoped
        can_view_raw_provider_summary: scopes.has("provider_dependency.read"),
        // funder lane only when explicitly scoped
        can_view_funder_lane: scopes.has("funder_lane.read"),
      });
    }

    case "auditor_regulator_legal":
      if (!context.has_auditor_mandate) return NONE;
      return flags({
        can_view_full_memory: true,
        can_view_org_memory: true,
        can_view_case_finality: true,
        can_export_audit_pack: true,
        can_view_api_safe_preview: true,
        can_view_raw_provider_summary: true,
      });

    case "support_user":
      // Read-only, only during an active escalation, and never exports
      // or correction/dispute/supersession power.
      if (!context.support_escalation_active) return NONE;
      return flags({
        can_view_case_finality: true,
      });

    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = role;
      void _exhaustive;
      return NONE;
    }
  }
}

export function canViewFinality(
  role: P5B5Role,
  context: P5B5PermissionContext = {},
): boolean {
  return getP5B5Capabilities(role, context).can_view_case_finality;
}

export function canViewMemory(
  role: P5B5Role,
  context: P5B5PermissionContext = {},
): boolean {
  const c = getP5B5Capabilities(role, context);
  return c.can_view_full_memory || c.can_view_org_memory;
}

export function canPerformFinalityAction(
  role: P5B5Role,
  action: P5B5FinalityAction,
  context: P5B5PermissionContext = {},
): boolean {
  const c = getP5B5Capabilities(role, context);
  switch (action) {
    case "create_finality":
      return c.can_create_finality;
    case "request_finality":
      return c.can_request_finality;
    case "add_correction":
      return c.can_add_correction;
    case "mark_dispute":
      return c.can_mark_dispute;
    case "resolve_dispute":
      return c.can_resolve_dispute;
    case "supersede_finality":
      return c.can_supersede_finality;
  }
}

export function canExportP5B5(
  role: P5B5Role,
  exportType: P5B5ExportType,
  context: P5B5PermissionContext = {},
): boolean {
  const c = getP5B5Capabilities(role, context);
  return exportType === "finality_summary"
    ? c.can_export_finality_summary
    : c.can_export_audit_pack;
}
