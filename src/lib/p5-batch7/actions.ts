/**
 * P-5 Batch 7 — Phase 5: Dashboard actions / exports / audit wiring.
 *
 * ALL Batch 7 UI writes MUST go through this module. No file in
 * src/{pages,components}/p5-batch7 may call `supabase.rpc(...)` or
 * `supabase.from(...).insert/update/delete/upsert(...)` directly — the
 * Phase 5 guard enforces this.
 *
 * Every helper here:
 *   - calls a SECURITY DEFINER RPC defined in the Phase 2/5 migrations,
 *   - validates registry-required reasons client-side (server re-validates),
 *   - normalises errors and never returns sensitive payloads.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  P5_BATCH7_AUDIT_EVENTS,
  P5_BATCH7_DASHBOARD_DEFINITIONS,
  P5_BATCH7_EXPORT_DEFINITIONS,
  type P5Batch7AuditEvent,
  type P5Batch7Dashboard,
  type P5Batch7ExportType,
  type P5Batch7Role,
} from "./registry";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const MIN_REASON_LEN = 10;
const MIN_STALE_REASON_LEN = 5;

export class P5B7ActionError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "P5B7ActionError";
  }
}

function ensureKnownEvent(event: string): asserts event is P5Batch7AuditEvent {
  if (!(P5_BATCH7_AUDIT_EVENTS as readonly string[]).includes(event)) {
    throw new P5B7ActionError(`unknown audit event "${event}"`, "unknown_event");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Permission gates (client-side; server re-enforces)
// ────────────────────────────────────────────────────────────────────────────

export function p5b7CanRunExport(
  exportType: P5Batch7ExportType,
  effectiveRoles: ReadonlyArray<P5Batch7Role>,
): boolean {
  const def = P5_BATCH7_EXPORT_DEFINITIONS[exportType];
  if (!def) return false;
  return def.authorised_roles.some((r) => effectiveRoles.includes(r));
}

export function p5b7ExportRequiresReason(exportType: P5Batch7ExportType): boolean {
  return !!P5_BATCH7_EXPORT_DEFINITIONS[exportType]?.requires_reason;
}

export function p5b7CanViewDashboard(
  dashboard: P5Batch7Dashboard,
  effectiveRoles: ReadonlyArray<P5Batch7Role>,
): boolean {
  const def = P5_BATCH7_DASHBOARD_DEFINITIONS[dashboard];
  if (!def) return false;
  return def.authorised_roles.some((r) => effectiveRoles.includes(r));
}

// ────────────────────────────────────────────────────────────────────────────
// Dashboard action audit
// ────────────────────────────────────────────────────────────────────────────

export async function p5b7RecordDashboardAction(args: {
  dashboard: P5Batch7Dashboard;
  event: P5Batch7AuditEvent;
  subjectKind?: string | null;
  subjectRef?: string | null;
  payload?: Record<string, unknown>;
}): Promise<string | null> {
  ensureKnownEvent(args.event);
  const { data, error } = await sb.rpc("p5b7_record_dashboard_action", {
    p_dashboard: args.dashboard,
    p_event_name: args.event,
    p_subject_kind: args.subjectKind ?? null,
    p_subject_ref: args.subjectRef ?? null,
    p_payload: args.payload ?? {},
  });
  if (error) {
    // Audit failure is non-fatal for the calling UI, but we log to console.
    // eslint-disable-next-line no-console
    console.warn("[p5b7] dashboard audit write failed:", error.message);
    return null;
  }
  return (data as string) ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// Saved views
// ────────────────────────────────────────────────────────────────────────────

export interface P5B7SavedView {
  view_id: string;
  dashboard: P5Batch7Dashboard;
  name: string;
  filters: Record<string, unknown>;
  sort_by: string | null;
  sort_dir: "asc" | "desc" | null;
  updated_at: string;
}

export async function p5b7ListSavedViews(
  dashboard: P5Batch7Dashboard,
): Promise<ReadonlyArray<P5B7SavedView>> {
  const { data, error } = await sb.rpc("p5b7_list_saved_views", { p_dashboard: dashboard });
  if (error) throw new P5B7ActionError(error.message, "list_saved_views_failed");
  return (data ?? []) as P5B7SavedView[];
}

export async function p5b7UpsertSavedView(args: {
  viewId?: string | null;
  dashboard: P5Batch7Dashboard;
  name: string;
  filters: Record<string, unknown>;
  sortBy?: string | null;
  sortDir?: "asc" | "desc" | null;
}): Promise<string> {
  const name = args.name.trim();
  if (name.length < 1 || name.length > 120) {
    throw new P5B7ActionError("Saved view name must be 1–120 characters", "invalid_name");
  }
  const { data, error } = await sb.rpc("p5b7_upsert_saved_view", {
    p_view_id: args.viewId ?? null,
    p_dashboard: args.dashboard,
    p_name: name,
    p_filters: args.filters ?? {},
    p_sort_by: args.sortBy ?? null,
    p_sort_dir: args.sortDir ?? null,
  });
  if (error) throw new P5B7ActionError(error.message, "upsert_saved_view_failed");
  const id = data as string;
  await p5b7RecordDashboardAction({
    dashboard: args.dashboard,
    event: args.viewId ? "p5b7.saved_view.updated" : "p5b7.saved_view.created",
    subjectKind: "saved_view",
    subjectRef: id,
    payload: { name },
  });
  return id;
}

export async function p5b7DeleteSavedView(args: {
  viewId: string;
  dashboard: P5Batch7Dashboard;
}): Promise<void> {
  const { error } = await sb.rpc("p5b7_delete_saved_view", { p_view_id: args.viewId });
  if (error) throw new P5B7ActionError(error.message, "delete_saved_view_failed");
  await p5b7RecordDashboardAction({
    dashboard: args.dashboard,
    event: "p5b7.saved_view.deleted",
    subjectKind: "saved_view",
    subjectRef: args.viewId,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Exports
// ────────────────────────────────────────────────────────────────────────────

export interface P5B7ExportJob {
  export_id: string;
  dashboard: P5Batch7Dashboard;
  export_type: P5Batch7ExportType;
  status: "queued" | "in_progress" | "ready" | "failed" | "expired";
  reason: string | null;
  row_count: number | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export async function p5b7ListMyExportJobs(
  dashboard?: P5Batch7Dashboard,
  limit = 25,
): Promise<ReadonlyArray<P5B7ExportJob>> {
  const { data, error } = await sb.rpc("p5b7_list_my_export_jobs", {
    p_dashboard: dashboard ?? null,
    p_limit: limit,
  });
  if (error) throw new P5B7ActionError(error.message, "list_export_jobs_failed");
  return (data ?? []) as P5B7ExportJob[];
}

export async function p5b7CreateExportJob(args: {
  dashboard: P5Batch7Dashboard;
  exportType: P5Batch7ExportType;
  reason: string;
  filters?: Record<string, unknown>;
  effectiveRoles: ReadonlyArray<P5Batch7Role>;
}): Promise<string> {
  if (!p5b7CanRunExport(args.exportType, args.effectiveRoles)) {
    throw new P5B7ActionError(
      "You are not authorised to run this export.",
      "export_not_authorised",
    );
  }
  const requiresReason = p5b7ExportRequiresReason(args.exportType);
  const reason = (args.reason ?? "").trim();
  if (requiresReason && reason.length < MIN_REASON_LEN) {
    throw new P5B7ActionError(
      `A reason of at least ${MIN_REASON_LEN} characters is required for this export.`,
      "reason_required",
    );
  }
  const def = P5_BATCH7_EXPORT_DEFINITIONS[args.exportType];
  if (def.dashboard !== args.dashboard) {
    throw new P5B7ActionError(
      "Export type does not belong to this dashboard.",
      "export_dashboard_mismatch",
    );
  }
  const { data, error } = await sb.rpc("p5b7_create_export_job", {
    p_dashboard: args.dashboard,
    p_export_type: args.exportType,
    p_reason: requiresReason ? reason : reason || null,
    p_filters: args.filters ?? {},
  });
  if (error) throw new P5B7ActionError(error.message, "create_export_failed");
  return data as string;
}

// ────────────────────────────────────────────────────────────────────────────
// Stale-data acknowledgement (audited)
// ────────────────────────────────────────────────────────────────────────────

export async function p5b7AcknowledgeStaleData(args: {
  dashboard: P5Batch7Dashboard;
  asOf: string | null;
  reason: string;
}): Promise<string> {
  const reason = (args.reason ?? "").trim();
  if (reason.length < MIN_STALE_REASON_LEN) {
    throw new P5B7ActionError(
      `Reason must be at least ${MIN_STALE_REASON_LEN} characters.`,
      "reason_required",
    );
  }
  const { data, error } = await sb.rpc("p5b7_acknowledge_stale_data", {
    p_dashboard: args.dashboard,
    p_as_of: args.asOf,
    p_reason: reason,
  });
  if (error) throw new P5B7ActionError(error.message, "stale_ack_failed");
  return data as string;
}

// ────────────────────────────────────────────────────────────────────────────
// Sensitive-field reveal (LOG ONLY — value is NOT returned by this helper)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Records a `p5b7.sensitive_field.revealed` audit row. This helper never
 * returns the underlying value — Batch 7 does not have an authoritative
 * unmask RPC and must not invent one. UIs may show the value only when
 * (a) the caller is platform_admin AND (b) this log has succeeded.
 */
export async function p5b7LogSensitiveFieldReveal(args: {
  dashboard: P5Batch7Dashboard;
  subjectKind: string;
  subjectRef: string;
  fieldName: string;
  reason: string;
}): Promise<string> {
  const reason = (args.reason ?? "").trim();
  if (reason.length < MIN_REASON_LEN) {
    throw new P5B7ActionError(
      `Reason must be at least ${MIN_REASON_LEN} characters.`,
      "reason_required",
    );
  }
  const { data, error } = await sb.rpc("p5b7_log_sensitive_field_reveal", {
    p_dashboard: args.dashboard,
    p_subject_kind: args.subjectKind,
    p_subject_ref: args.subjectRef,
    p_field_name: args.fieldName,
    p_reason: reason,
  });
  if (error) throw new P5B7ActionError(error.message, "sensitive_reveal_log_failed");
  return data as string;
}

// ────────────────────────────────────────────────────────────────────────────
// Audit listing (admin / auditor surfaces)
// ────────────────────────────────────────────────────────────────────────────

export interface P5B7DashboardAuditRow {
  audit_id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  dashboard: P5Batch7Dashboard;
  event_name: string;
  subject_kind: string | null;
  subject_ref: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export async function p5b7ListDashboardAudit(
  dashboard?: P5Batch7Dashboard,
  limit = 100,
): Promise<ReadonlyArray<P5B7DashboardAuditRow>> {
  const { data, error } = await sb.rpc("p5b7_list_dashboard_audit", {
    p_dashboard: dashboard ?? null,
    p_limit: limit,
  });
  if (error) throw new P5B7ActionError(error.message, "list_dashboard_audit_failed");
  return (data ?? []) as P5B7DashboardAuditRow[];
}
