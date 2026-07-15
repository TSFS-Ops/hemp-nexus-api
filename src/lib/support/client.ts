/**
 * Enterprise Support Centre — client library.
 *
 * Wraps the Phase 1A + Batch 1 RPCs. Every function throws on error;
 * page components handle try/catch + toast per the project's
 * "zero swallowed errors" rule.
 */
import { supabase } from "@/integrations/supabase/client";

// NOTE: The generated Database types haven't been regenerated for
// Batch 1 RPCs/tables yet. We cast to `any` at the boundary and
// re-type the returns here so the rest of the app is fully typed.
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

const from = supabase.from.bind(supabase) as unknown as (t: string) => any;

export type SupportPriority = "low" | "medium" | "high" | "urgent";
export type SupportStatus =
  | "new"
  | "in_progress"
  | "waiting_for_customer"
  | "resolved"
  | "confirmation_requested"
  | "closed"
  | "reopened"
  | "cancelled";
export type SupportImpact =
  | "affects_me"
  | "affects_organisation"
  | "blocks_transaction_or_deadline";

export interface SupportCategoryRow {
  key: string;
  label: string;
  is_active: boolean;
  is_restricted: boolean;
  sort_order: number;
}
export interface SupportSubcategoryRow {
  key: string;
  category_key: string;
  label: string;
  is_active: boolean;
  is_restricted: boolean;
  sort_order: number;
}
export interface SupportTicketSummary {
  id: string;
  ticket_number: string;
  subject: string;
  status: SupportStatus;
  priority: SupportPriority;
  category_key: string | null;
  subcategory_key: string | null;
  current_team_key: string | null;
  current_assignee_user_id: string | null;
  created_at: string;
  updated_at: string;
  first_response_at: string | null;
  sla_first_response_due_at: string | null;
  sla_resolution_due_at: string | null;
}
export interface SupportTicketDetail extends SupportTicketSummary {
  intended_action: string | null;
  actual_result: string | null;
  occurred_at: string | null;
  affected_users_count: number | null;
  workaround_available: boolean | null;
  safe_context: Record<string, unknown> | null;
  contact_name: string | null;
  contact_email: string | null;
  customer_impact: SupportImpact | null;
  created_by: string | null;
  org_id: string | null;
  resolved_at: string | null;
  closed_at: string | null;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  kind: "customer_message" | "internal_note";
  author_user_id: string | null;
  body: string;
  created_at: string;
}
export interface SupportAttachment {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  scan_status: "pending" | "clean" | "infected" | "failed";
  is_internal_only: boolean;
  uploaded_by: string | null;
  created_at: string;
}
export interface SupportIncident {
  id: string;
  incident_number: string;
  title: string;
  summary: string | null;
  status:
    | "investigating"
    | "identified"
    | "monitoring"
    | "resolved"
    | "scheduled"
    | "in_progress"
    | "completed";
  severity: "minor" | "major" | "critical" | "maintenance";
  started_at: string;
  resolved_at: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  affected_components: string[];
}
export interface SupportIncidentUpdate {
  id: string;
  status: SupportIncident["status"];
  body: string;
  created_at: string;
}
export interface KbArticleSummary {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  category_key: string | null;
  published_at: string | null;
}
export interface KbArticleFull extends KbArticleSummary {
  body_md: string;
}

function unwrap<T>(r: { data: unknown; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

// --- Reference data ----------------------------------------------------
export async function listCategories(): Promise<SupportCategoryRow[]> {
  const r = await from("support_categories")
    .select("key,label,is_active,is_restricted,sort_order")
    .eq("is_active", true)
    .order("sort_order");
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []) as SupportCategoryRow[];
}
export async function listSubcategories(
  categoryKey: string
): Promise<SupportSubcategoryRow[]> {
  const r = await from("support_subcategories")
    .select("key,category_key,label,is_active,is_restricted,sort_order")
    .eq("category_key", categoryKey)
    .eq("is_active", true)
    .order("sort_order");
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []) as SupportSubcategoryRow[];
}
export async function listTeams(): Promise<
  Array<{ key: string; label: string; description: string | null }>
> {
  const r = await from("support_teams")
    .select("key,label,description,is_active")
    .eq("is_active", true)
    .order("label");
  if (r.error) throw new Error(r.error.message);
  return r.data ?? [];
}

// --- Tickets -----------------------------------------------------------
export async function createTicket(input: {
  category_key: string;
  subcategory_key?: string | null;
  customer_impact: SupportImpact;
  subject: string;
  intended_action?: string | null;
  actual_result?: string | null;
  occurred_at?: string | null;
  affected_users_count?: number | null;
  workaround_available?: boolean | null;
  safe_context?: Record<string, unknown> | null;
  contact_name?: string | null;
  contact_email?: string | null;
}): Promise<string> {
  const r = await rpc("create_support_ticket", {
    _category_key: input.category_key,
    _subcategory_key: input.subcategory_key ?? null,
    _customer_impact: input.customer_impact,
    _subject: input.subject,
    _intended_action: input.intended_action ?? null,
    _actual_result: input.actual_result ?? null,
    _occurred_at: input.occurred_at ?? null,
    _affected_users_count: input.affected_users_count ?? null,
    _workaround_available: input.workaround_available ?? null,
    _safe_context: input.safe_context ?? null,
    _contact_name: input.contact_name ?? null,
    _contact_email: input.contact_email ?? null,
    _on_behalf_of_user_id: null,
    _on_behalf_of_reason: null,
  });
  return unwrap<string>(r);
}

export async function listOwnTickets(): Promise<SupportTicketSummary[]> {
  const r = await rpc("list_own_support_tickets");
  return unwrap<SupportTicketSummary[]>(r);
}
export async function listOrgTickets(): Promise<SupportTicketSummary[]> {
  const r = await rpc("list_org_support_tickets");
  return unwrap<SupportTicketSummary[]>(r);
}
export async function getTicket(id: string): Promise<SupportTicketDetail> {
  const r = await rpc("get_support_ticket", { _ticket_id: id });
  const arr = unwrap<SupportTicketDetail[]>(r);
  if (!arr || !arr.length) throw new Error("Ticket not found");
  return arr[0];
}
export async function getTicketInternal(
  id: string,
  reason: string
): Promise<SupportTicketDetail> {
  const r = await rpc("get_support_ticket_internal", {
    _ticket_id: id,
    _reason: reason,
  });
  const arr = unwrap<SupportTicketDetail[]>(r);
  if (!arr || !arr.length) throw new Error("Ticket not found");
  return arr[0];
}
export async function listCustomerMessages(id: string): Promise<SupportMessage[]> {
  const r = await rpc("list_support_ticket_customer_messages", { _ticket_id: id });
  return unwrap<SupportMessage[]>(r);
}
export async function listInternalNotes(id: string): Promise<SupportMessage[]> {
  const r = await rpc("list_support_ticket_internal_notes", { _ticket_id: id });
  return unwrap<SupportMessage[]>(r);
}
export async function postCustomerMessage(id: string, body: string) {
  const r = await rpc("post_support_ticket_customer_message", {
    _ticket_id: id,
    _body: body,
  });
  return unwrap<string>(r);
}
export async function postInternalNote(id: string, body: string) {
  const r = await rpc("post_support_ticket_internal_note", {
    _ticket_id: id,
    _body: body,
  });
  return unwrap<string>(r);
}
export async function updateStatus(
  id: string,
  status: SupportStatus,
  reason: string
) {
  const r = await rpc("update_support_ticket_status", {
    _ticket_id: id,
    _new_status: status,
    _reason: reason,
  });
  return unwrap<null>(r);
}
export async function assignTicket(
  id: string,
  assignee: string | null,
  team: string | null,
  reason: string
) {
  const r = await rpc("assign_support_ticket", {
    _ticket_id: id,
    _assignee: assignee,
    _team_key: team,
    _reason: reason,
  });
  return unwrap<string>(r);
}
export async function escalateTicket(
  id: string,
  priority: SupportPriority,
  reason: string
) {
  const r = await rpc("escalate_support_ticket", {
    _ticket_id: id,
    _new_priority: priority,
    _reason: reason,
  });
  return unwrap<null>(r);
}

// --- Attachments -------------------------------------------------------
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
]);
const MAX_BYTES = 20 * 1024 * 1024;

export async function uploadAttachment(
  ticketId: string,
  file: File,
  opts: { isInternal?: boolean; messageId?: string | null } = {}
): Promise<SupportAttachment> {
  if (file.size > MAX_BYTES) {
    throw new Error("File exceeds the 20 MB support attachment limit.");
  }
  if (!ALLOWED_MIME.has(file.type)) {
    throw new Error(
      `File type "${file.type || "unknown"}" is not permitted for support attachments.`
    );
  }
  const path = `${ticketId}/${crypto.randomUUID()}-${file.name.replace(
    /[^\w.\-]+/g,
    "_"
  )}`;
  const up = await supabase.storage
    .from("support-attachments")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw new Error(up.error.message);
  const r = await rpc("register_support_ticket_attachment", {
    _ticket_id: ticketId,
    _message_id: opts.messageId ?? null,
    _storage_path: path,
    _filename: file.name,
    _mime_type: file.type,
    _size_bytes: file.size,
    _is_internal: opts.isInternal ?? false,
  });
  const attachmentId = unwrap<string>(r);
  // Kick off scan (best-effort; UI does not block on it)
  supabase.functions
    .invoke("support-attachment-scan", { body: { attachment_id: attachmentId } })
    .catch(() => {
      /* silent; cron will pick up */
    });
  const list = await listAttachments(ticketId);
  const created = list.find((a) => a.id === attachmentId);
  if (!created) throw new Error("Attachment did not register");
  return created;
}
export async function listAttachments(ticketId: string): Promise<SupportAttachment[]> {
  const r = await rpc("list_support_ticket_attachments", { _ticket_id: ticketId });
  return unwrap<SupportAttachment[]>(r);
}
export async function attachmentDownloadUrl(
  path: string,
  expiresInSec = 60
): Promise<string> {
  const r = await supabase.storage
    .from("support-attachments")
    .createSignedUrl(path, expiresInSec);
  if (r.error || !r.data) throw new Error(r.error?.message ?? "signed url failed");
  return r.data.signedUrl;
}

// --- Incidents / status page ------------------------------------------
export async function listIncidents(): Promise<SupportIncident[]> {
  const r = await rpc("list_public_incidents");
  return unwrap<SupportIncident[]>(r);
}
export async function listIncidentUpdates(
  id: string
): Promise<SupportIncidentUpdate[]> {
  const r = await rpc("list_public_incident_updates", { _incident_id: id });
  return unwrap<SupportIncidentUpdate[]>(r);
}

// --- Knowledge base ---------------------------------------------------
export async function listKbArticles(q?: string): Promise<KbArticleSummary[]> {
  const r = await rpc("list_published_kb_articles", { _q: q ?? null });
  return unwrap<KbArticleSummary[]>(r);
}
export async function getKbArticle(slug: string): Promise<KbArticleFull | null> {
  const r = await rpc("get_published_kb_article", { _slug: slug });
  const arr = unwrap<KbArticleFull[]>(r);
  return arr && arr.length ? arr[0] : null;
}

// --- Admin queue (uses raw table, RLS restricts to staff/admin) --------
export async function adminListTickets(filter: {
  status?: SupportStatus | "all";
  priority?: SupportPriority | "all";
  team?: string | "all";
  q?: string;
}): Promise<SupportTicketSummary[]> {
  let q = from("support_tickets")
    .select(
      "id,ticket_number,subject,status,priority,category_key,subcategory_key,current_team_key,current_assignee_user_id,created_at,updated_at,first_response_at,sla_first_response_due_at,sla_resolution_due_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter.status && filter.status !== "all") q = q.eq("status", filter.status);
  if (filter.priority && filter.priority !== "all")
    q = q.eq("priority", filter.priority);
  if (filter.team && filter.team !== "all") q = q.eq("current_team_key", filter.team);
  if (filter.q) q = q.ilike("subject", `%${filter.q}%`);
  const r = await q;
  if (r.error) throw new Error(r.error.message);
  return r.data ?? [];
}
