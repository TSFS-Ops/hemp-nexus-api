/**
 * Institutional Funder Evidence Workspace — Batch 5 (+ Batch 10)
 * Working-review client library: RFIs, notes / shared comments, formal
 * decisions, and non-binding Reviewer/Approver recommendations.
 *
 * All mutations route through Batch 5 / Batch 10 fw_* / fw_admin_* /
 * fw_funder_* RPCs. Every RPC is SECURITY DEFINER and enforces:
 *  - funder-organisation isolation (release-scoped),
 *  - release state gates (active, non-expired),
 *  - V1 role gates (viewer read-only),
 *  - audit + usage event logging.
 *
 * Reads use RLS-scoped selects on the Batch 5 / Batch 10 tables. The DB
 * returns only rows the caller may see (admin OR caller's funder org).
 */
import { supabase } from "@/integrations/supabase/client";

// ─── Domain types ────────────────────────────────────────────

export const RFI_STATUSES = [
    "open",
    "assigned",
    "in_progress",
    "answered",
    "closed",
    "withdrawn",
  ] as const;
export type RfiStatus = (typeof RFI_STATUSES)[number];

export const RFI_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type RfiPriority = (typeof RFI_PRIORITIES)[number];

export const NOTE_TYPES = ["internal_note", "shared_comment"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export const NOTE_VISIBILITIES = ["funder_internal", "izenzo_shared"] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export const DECISION_STATUSES = [
    "not_started",
    "under_review",
    "info_requested",
    "conditional",
    "approved",
    "declined",
    "withdrawn",
  ] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const FINAL_DECISION_STATUSES: readonly DecisionStatus[] = [
    "conditional",
    "approved",
    "declined",
    "withdrawn",
  ];

// Non-binding recommendation outcomes (Batch 10). Deliberately a
// subset of DECISION_STATUSES: a recommendation is always a concrete
// suggested outcome, never "not_started"/"under_review"/"info_requested".
export const RECOMMENDATION_STATUSES = ["conditional", "approved", "declined"] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export interface RfiRow {
    id: string;
    release_id: string;
    funder_organisation_id: string;
    created_by: string | null;
    assigned_to: string | null;
    title: string;
    request_type: string;
    description: string;
    related_evidence_item: string | null;
    priority: RfiPriority;
    due_date: string | null;
    status: RfiStatus;
    closed_by: string | null;
    closed_at: string | null;
    withdrawn_by: string | null;
    withdrawn_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface RfiMessageRow {
    id: string;
    rfi_id: string;
    author_user_id: string | null;
    author_side: "funder" | "izenzo_admin" | "system";
    message_body: string;
    attachments_metadata: unknown;
    created_at: string;
    updated_at: string;
}

export interface NoteRow {
    id: string;
    release_id: string;
    funder_organisation_id: string;
    author_user_id: string | null;
    note_type: NoteType;
    body: string;
    visibility: NoteVisibility;
    editable_until: string;
    superseded_by: string | null;
    supersedes_note_id: string | null;
    deleted_at: string | null;
    deleted_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface DecisionRow {
    id: string;
    release_id: string;
    funder_organisation_id: string;
    decided_by: string | null;
    decision_status: DecisionStatus;
    reason: string | null;
    conditions: string | null;
    decision_version: number;
    is_current: boolean;
    supersedes_decision_id: string | null;
    pack_version_id: string | null;
    open_rfi_count_at_decision: number;
    supersession_reason: string | null;
    created_at: string;
    updated_at: string;
}

export interface DecisionRecommendationRow {
    id: string;
    release_id: string;
    funder_organisation_id: string;
    recommended_by: string | null;
    recommended_by_role: "reviewer" | "approver";
    recommended_status: RecommendationStatus;
    reason: string;
    conditions: string | null;
    pack_version_id: string | null;
    open_rfi_count_at_recommendation: number;
    created_at: string;
}

// ─── V1 role helpers (client-side hint only; server is authoritative) ─

export type V1Role =
    | "admin"
  | "approver"
  | "reviewer"
  | "viewer"
  | "external_adviser";

export function canCreateRfi(role: V1Role | null | undefined): boolean {
    return role === "admin" || role === "approver" || role === "reviewer";
}
export function canCreateNote(role: V1Role | null | undefined): boolean {
    return role === "admin" || role === "approver" || role === "reviewer";
}
export function canRecordDecision(role: V1Role | null | undefined): boolean {
    return role === "approver";
}
// Reviewer or Approver may submit a non-binding recommendation. A
// Funder Admin does not gain recommendation rights merely by being
// admin — they must separately hold Approver or Reviewer rights,
// consistent with "no Funder Admin authority unless separately
// assigned Approver or Reviewer rights".
export function canSubmitRecommendation(role: V1Role | null | undefined): boolean {
    return role === "reviewer" || role === "approver";
}
export function requiresDecisionReason(status: DecisionStatus): boolean {
    return FINAL_DECISION_STATUSES.includes(status);
}

// ─── Table names (typed reads only; writes go through RPCs) ──

const T = {
    rfis: "funder_workspace_rfis",
    rfiMessages: "funder_workspace_rfi_messages",
    notes: "funder_workspace_notes",
    decisions: "funder_workspace_decisions",
    decisionRecommendations: "funder_workspace_decision_recommendations",
} as const;

// ─── Funder-side reads ───────────────────────────────────────

export async function listReleaseRfis(releaseId: string): Promise<RfiRow[]> {
    const { data, error } = await (supabase as any)
      .from(T.rfis)
      .select("*")
      .eq("release_id", releaseId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`listReleaseRfis: ${error.message}`);
    return (data ?? []) as RfiRow[];
}

export async function listRfiMessages(rfiId: string): Promise<RfiMessageRow[]> {
    const { data, error } = await (supabase as any)
      .from(T.rfiMessages)
      .select("*")
      .eq("rfi_id", rfiId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`listRfiMessages: ${error.message}`);
    return (data ?? []) as RfiMessageRow[];
}

export async function listNotes(releaseId: string): Promise<NoteRow[]> {
    const { data, error } = await (supabase as any)
      .from(T.notes)
      .select("*")
      .eq("release_id", releaseId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`listNotes: ${error.message}`);
    return (data ?? []) as NoteRow[];
}

export async function listDecisions(releaseId: string): Promise<DecisionRow[]> {
    const { data, error } = await (supabase as any)
      .from(T.decisions)
      .select("*")
      .eq("release_id", releaseId)
      .order("decision_version", { ascending: false });
    if (error) throw new Error(`listDecisions: ${error.message}`);
    return (data ?? []) as DecisionRow[];
}

export async function listRecommendations(
    releaseId: string,
  ): Promise<DecisionRecommendationRow[]> {
    const { data, error } = await (supabase as any)
      .from(T.decisionRecommendations)
      .select("*")
      .eq("release_id", releaseId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`listRecommendations: ${error.message}`);
    return (data ?? []) as DecisionRecommendationRow[];
}

// ─── Funder-side mutations (RPCs) ────────────────────────────

export interface CreateRfiInput {
    release_id: string;
    title: string;
    description: string;
    request_type?: string;
    related_evidence_item?: string | null;
    priority?: RfiPriority;
    due_date?: string | null;
}

export async function createRfi(input: CreateRfiInput): Promise<string> {
    const { data, error } = await (supabase as any).rpc("fw_funder_create_rfi_v1", {
          p_release_id: input.release_id,
          p_title: input.title,
          p_description: input.description,
          p_request_type: input.request_type ?? "general",
          p_related_evidence_item: input.related_evidence_item ?? null,
          p_priority: input.priority ?? "normal",
          p_due_date: input.due_date ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
}

export async function addRfiMessage(rfiId: string, message: string): Promise<string> {
    const { data, error } = await (supabase as any).rpc("fw_funder_add_rfi_message_v1", {
          p_rfi_id: rfiId,
          p_message: message,
    });
    if (error) throw new Error(error.message);
    return data as string;
}

export async function closeRfi(rfiId: string, reason: string | null): Promise<void> {
    const { error } = await (supabase as any).rpc("fw_funder_close_rfi_v1", {
          p_rfi_id: rfiId,
          p_reason: reason,
    });
    if (error) throw new Error(error.message);
}

export async function withdrawRfi(rfiId: string, reason: string | null): Promise<void> {
    const { error } = await (supabase as any).rpc("fw_funder_withdraw_rfi_v1", {
          p_rfi_id: rfiId,
          p_reason: reason,
    });
    if (error) throw new Error(error.message);
}

export interface CreateNoteInput {
    release_id: string;
    note_type: NoteType;
    body: string;
}

export async function createNote(input: CreateNoteInput): Promise<string> {
    const { data, error } = await (supabase as any).rpc("fw_funder_create_note_v1", {
          p_release_id: input.release_id,
          p_note_type: input.note_type,
          p_body: input.body,
    });
    if (error) throw new Error(error.message);
    return data as string;
}

export async function editNote(noteId: string, newBody: string): Promise<string> {
    const { data, error } = await (supabase as any).rpc("fw_funder_edit_note_v1", {
          p_note_id: noteId,
          p_new_body: newBody,
    });
    if (error) throw new Error(error.message);
    return data as string;
}

export async function deleteNote(noteId: string, reason: string | null): Promise<void> {
    const { error } = await (supabase as any).rpc("fw_funder_delete_note_v1", {
          p_note_id: noteId,
          p_reason: reason,
    });
    if (error) throw new Error(error.message);
}

export interface RecordDecisionInput {
    release_id: string;
    decision_status: DecisionStatus;
    reason?: string | null;
    conditions?: string | null;
    // Required by the server whenever this call would supersede an
  // existing current decision for the release. Optional here because
  // the very first decision on a release has nothing to supersede.
  supersession_reason?: string | null;
}

export async function recordDecision(input: RecordDecisionInput): Promise<string> {
    if (requiresDecisionReason(input.decision_status)) {
          const r = (input.reason ?? "").trim();
          if (!r) throw new Error("A written reason is required for this decision.");
    }
    const { data, error } = await (supabase as any).rpc("fw_funder_record_decision_v1", {
          p_release_id: input.release_id,
          p_decision_status: input.decision_status,
          p_reason: input.reason ?? null,
          p_conditions: input.conditions ?? null,
          p_supersession_reason: input.supersession_reason ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
}

export interface SubmitRecommendationInput {
    release_id: string;
    recommended_status: RecommendationStatus;
    reason: string;
    conditions?: string | null;
}

export async function submitRecommendation(
    input: SubmitRecommendationInput,
  ): Promise<string> {
    const reason = (input.reason ?? "").trim();
    if (!reason) throw new Error("A written reason is required for a recommendation.");
    if (input.recommended_status === "conditional" && !(input.conditions ?? "").trim()) {
          throw new Error("Conditions are required for a conditional recommendation.");
    }
    const { data, error } = await (supabase as any).rpc("fw_funder_submit_recommendation_v1", {
          p_release_id: input.release_id,
          p_recommended_status: input.recommended_status,
          p_reason: reason,
          p_conditions: input.conditions ?? null,
    });
    if (error) throw new Error(error.message);
    return data as string;
}

// ─── Admin-side mutations ────────────────────────────────────

export async function assignRfi(rfiId: string, assignee: string | null): Promise<void> {
    const { error } = await (supabase as any).rpc("fw_admin_assign_rfi_v1", {
          p_rfi_id: rfiId,
          p_assignee: assignee,
    });
    if (error) throw new Error(error.message);
}

export async function answerRfi(rfiId: string, message: string): Promise<string> {
    const { data, error } = await (supabase as any).rpc("fw_admin_answer_rfi_v1", {
          p_rfi_id: rfiId,
          p_message: message,
    });
    if (error) throw new Error(error.message);
    return data as string;
}

// ─── Admin-side reads (RLS grants admin_select) ──────────────

export async function listReleaseRfisForAdmin(releaseId: string) {
    return listReleaseRfis(releaseId);
}
export async function listRfiMessagesForAdmin(rfiId: string) {
    return listRfiMessages(rfiId);
}
export async function listSharedCommentsForAdmin(releaseId: string): Promise<NoteRow[]> {
    const { data, error } = await (supabase as any)
      .from(T.notes)
      .select("*")
      .eq("release_id", releaseId)
      .eq("visibility", "izenzo_shared")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`listSharedCommentsForAdmin: ${error.message}`);
    return (data ?? []) as NoteRow[];
}
export async function listDecisionsForAdmin(releaseId: string) {
    return listDecisions(releaseId);
}
export async function listRecommendationsForAdmin(releaseId: string) {
    return listRecommendations(releaseId);
}

// ─── Approved Batch 5 / Batch 10 RPC names (guard-tested) ────
export const FUNDER_WORKSPACE_WORKFLOW_RPCS = [
    "fw_funder_create_rfi_v1",
    "fw_funder_add_rfi_message_v1",
    "fw_funder_close_rfi_v1",
    "fw_funder_withdraw_rfi_v1",
    "fw_admin_assign_rfi_v1",
    "fw_admin_answer_rfi_v1",
    "fw_funder_create_note_v1",
    "fw_funder_edit_note_v1",
    "fw_funder_delete_note_v1",
    "fw_funder_record_decision_v1",
    "fw_funder_submit_recommendation_v1",
  ] as const;

export const FUNDER_WORKSPACE_WORKFLOW_TABLES = [
    "funder_workspace_rfis",
    "funder_workspace_rfi_messages",
    "funder_workspace_notes",
    "funder_workspace_decisions",
    "funder_workspace_decision_recommendations",
  ] as const;
