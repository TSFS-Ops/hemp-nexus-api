/**
 * AdminPendingEngagementsPanel
 * ────────────────────────────
 * The dedicated admin queue for POI hold-point engagements.
 *
 * Surfaces every POI engagement awaiting outreach or response, with controls to:
 *   • Send the counterparty notification email (via poi-engagements outreach)
 *   • Mark as "contacted" (mandatory contact_method + contact_detail)
 *   • Mark as "declined" or "expired"
 *   • View the immutable outreach log per engagement
 *
 * Wired exclusively to the existing `poi-engagements` edge function - no new
 * backend logic. All state transitions are server-validated.
 */

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SafeSelect } from "@/components/admin/SafeSelect";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Inbox, Mail, CheckCircle2, XCircle, Clock, Send, RefreshCw, Loader2, History, AlertTriangle, Eye, StickyNote, Save, Download, FileText, UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import {
  BINDING_HINT_MESSAGES,
  type UpdatePoiEngagementResponse,
} from "@/types/poi-engagement";
// Defect D-05 — Pending Engagements enum drift. Canonical pre-acceptance
// state set lives in one place so filters/counters/badges cannot drift.
import {
  ENGAGEMENT_PENDING_STATES,
  isEngagementPending,
} from "@/lib/engagement-state";
import { AddContactDialog, type AddContactEngagementSummary } from "@/components/admin/AddContactDialog";
// Batch A — single source of truth for contact-completeness labels and the
// outreach gate. Mirrors the edge-function helper so the UI badge, tooltip
// and Send-outreach disabled state always match the backend's 422 response.
import {
  contactBlockReason,
  contactStateLabel,
  getContactState,
  isOutreachBlocked,
  type ContactState,
} from "@/lib/contact-completeness";

interface Engagement {
  id: string;
  match_id: string;
  org_id: string;
  counterparty_org_id: string | null;
  counterparty_email: string | null;
  counterparty_type: string | null;
  engagement_status: "pending" | "notification_sent" | "contacted" | "accepted" | "declined" | "expired";
  // Batch A — counterparty contact labelling fields.
  contact_type: "organisation" | "named_individual" | null;
  contact_name: string | null;
  contact_method: string | null;
  contacted_at: string | null;
  responded_at: string | null;
  admin_notes: string | null;
  support_notes: string | null;
  support_notes_updated_at: string | null;
  support_notes_updated_by: string | null;
  created_at: string;
  sla_reminder_sent_at?: string | null;
  sla_reminder_count?: number | null;
  matches?: {
    id: string;
    commodity: string | null;
    quantity_amount: number | null;
    quantity_unit: string | null;
    price_amount: number | null;
    price_currency: string | null;
    buyer_name: string | null;
    seller_name: string | null;
  } | null;
  initiator_org?: { id: string; name: string } | null;
  counterparty_org?: { id: string; name: string } | null;
}

/**
 * Returns true when the engagement has a counterparty email that is plausibly
 * deliverable. Frontend UX guard only — the backend (`poi-engagements`
 * `preview-outreach` / `send-outreach`) remains the source of truth and will
 * still reject anything that fails its own validation. We exclude:
 *   • missing / null / whitespace-only addresses
 *   • the reserved `.invalid` TLD (RFC 2606) used for test placeholders such
 *     as `auto-link-tst-…@izenzo-test.invalid`, which are never deliverable.
 */
export function isUsableOutreachEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return false;
  // Basic shape check — must contain a single '@' with content on both sides.
  const at = trimmed.indexOf("@");
  if (at <= 0 || at !== trimmed.lastIndexOf("@") || at === trimmed.length - 1) return false;
  const domain = trimmed.slice(at + 1);
  if (domain.endsWith(".invalid") || domain === "invalid") return false;
  return true;
}

interface OutreachLog {
  id: string;
  actor_type: "admin" | "counterparty" | "system";
  admin_email: string | null;
  admin_name: string | null;
  entry_type: "contact_attempt" | "status_change" | "notes_edit" | "email_update" | "system_action";
  contact_method: string | null;
  contact_detail: string | null;
  previous_status: string;
  new_status: string;
  notes: string | null;
  created_at: string;
}

const ENTRY_TYPE_LABEL: Record<OutreachLog["entry_type"], string> = {
  contact_attempt: "Contact attempt",
  status_change: "Status change",
  notes_edit: "Notes edit",
  email_update: "Email updated",
  system_action: "System action",
};

const ACTOR_TYPE_LABEL: Record<OutreachLog["actor_type"], string> = {
  admin: "Admin",
  counterparty: "Counterparty (self-serve)",
  system: "System (auto)",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700 border-slate-200",
  notification_sent: "bg-sky-50 text-sky-700 border-sky-200",
  contacted: "bg-amber-50 text-amber-700 border-amber-200",
  accepted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  declined: "bg-rose-50 text-rose-700 border-rose-200",
  expired: "bg-slate-100 text-slate-500 border-slate-200",
};

// Human-readable labels for engagement status. The DB enum value
// 'notification_sent' historically meant "internal admin alert dispatched"
// - NOT that the counterparty has been emailed. We surface it as
// "Awaiting outreach" so admins don't mistake it for an outbound send.
const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  notification_sent: "Awaiting outreach",
  contacted: "Contacted",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

// D-05: the "pending" tab is preserved as a value for backwards-compatible
// links/bookmarks but its label and behaviour now reflect the canonical
// pre-acceptance set (notification_sent + contacted). The filter logic in
// `filtered` treats `value === "pending"` as the canonical pending set.
const FILTER_TABS = [
  { value: "all", label: "All engagements" },
  { value: "active", label: "Active queue (excludes accepted/declined)" },
  { value: "pending", label: "Awaiting action" },
  { value: "notification_sent", label: "Awaiting outreach" },
  { value: "contacted", label: "Contacted" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
] as const;

export function AdminPendingEngagementsPanel() {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Default to "all" so accepted/declined rows are visible by default — the
  // previous "active" default silently hid resolved rows and caused support
  // tickets ("did the trade work?"). The Active queue remains one click away.
  const [filter, setFilter] = useState<string>("all");
  // Scope toggle: by design this panel exists for *unknown* counterparty outreach.
  // "all" is a diagnostic mode for admins who need to audit known-counterparty engagements too.
  const [scope, setScope] = useState<"unknown" | "all">("unknown");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  // Off-scope counters: when admin is on "Unknown only", we still surface how many
  // engagements live in the "All" bucket and how many of those auto-promoted in the
  // last 7 days. This prevents the "my row vanished after auto-link" support pattern.
  const [knownTotalCount, setKnownTotalCount] = useState<number>(0);
  const [knownRecentCount, setKnownRecentCount] = useState<number>(0);

  // ── Reviewer support-notes filter ──
  // notesFilter: "any" (no filter) | "with" (has notes) | "without" (no notes)
  // notesFrom/notesTo bound support_notes_updated_at into an inclusive date range (YYYY-MM-DD).
  const [notesFilter, setNotesFilter] = useState<"any" | "with" | "without">("any");
  const [notesFrom, setNotesFrom] = useState<string>("");
  const [notesTo, setNotesTo] = useState<string>("");

  // ── Support-notes editor (admin/reviewer-only, per row) ──
  const [notesOpenId, setNotesOpenId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string>("");
  const [notesSaving, setNotesSaving] = useState(false);

  // ── Add-contact dialog (capture discovered email/phone for unregistered counterparties) ──
  // Distinct from "Mark contacted" — this is the *discovery* step that
  // unblocks Notify, not a record that contact has actually happened.
  const [addContactFor, setAddContactFor] = useState<AddContactEngagementSummary | null>(null);

  const openSupportNotes = (e: Engagement) => {
    if (notesOpenId === e.id) {
      setNotesOpenId(null);
      return;
    }
    setNotesOpenId(e.id);
    setNotesDraft(e.support_notes ?? "");
  };

  const saveSupportNotes = async (e: Engagement) => {
    if (notesSaving) return;
    const trimmed = notesDraft.trim();
    if (trimmed.length > 4000) {
      toast.error("Support notes must be 4000 characters or fewer.");
      return;
    }
    if ((e.support_notes ?? "") === trimmed) {
      setNotesOpenId(null);
      return;
    }
    setNotesSaving(true);
    try {
      const { error } = await supabase.functions.invoke(`poi-engagements/${e.id}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: { support_notes: trimmed },
      });
      if (error) throw error;
      toast.success(trimmed.length === 0 ? "Support notes cleared." : "Support notes saved.");
      setNotesOpenId(null);
      fetchEngagements();
    } catch (err: any) {
      console.error("Failed to save support notes:", err);
      toast.error(err?.message || "Failed to save support notes");
    } finally {
      setNotesSaving(false);
    }
  };

  // ── Admin export helpers (CSV + print-to-PDF) ──
  // Operates on the currently filtered list so admins can scope exports via the existing filters.
  const csvEscape = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const exportRowsForFiltered = () => {
    return filtered.map((e) => {
      const m = e.matches;
      const qty = m?.quantity_amount != null ? `${m.quantity_amount} ${m.quantity_unit ?? ""}`.trim() : "";
      const price = m?.price_amount != null ? `${m.price_currency ?? ""} ${m.price_amount}`.trim() : "";
      return {
        match_id: e.match_id,
        engagement_id: e.id,
        status: e.engagement_status,
        counterparty_type: e.counterparty_type ?? "",
        counterparty_email: e.counterparty_email ?? "",
        counterparty_org: e.counterparty_org?.name ?? "",
        initiator_org: e.initiator_org?.name ?? "",
        commodity: m?.commodity ?? "",
        quantity: qty,
        price,
        buyer: m?.buyer_name ?? "",
        seller: m?.seller_name ?? "",
        created_at: e.created_at,
        contacted_at: e.contacted_at ?? "",
        responded_at: e.responded_at ?? "",
        sla_reminder_sent_at: e.sla_reminder_sent_at ?? "",
        sla_reminder_count: e.sla_reminder_count ?? 0,
        support_notes: e.support_notes ?? "",
        support_notes_updated_at: e.support_notes_updated_at ?? "",
        support_notes_updated_by: e.support_notes_updated_by ?? "",
        admin_notes: e.admin_notes ?? "",
      };
    });
  };

  const handleExportCsv = () => {
    if (filtered.length === 0) {
      toast.error("No engagements to export with the current filters.");
      return;
    }
    const rows = exportRowsForFiltered();
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => csvEscape((r as Record<string, unknown>)[h])).join(",")),
    ].join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    link.href = url;
    link.download = `pending-engagements-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} engagement${rows.length === 1 ? "" : "s"} to CSV.`);
  };

  const handleExportPdf = () => {
    if (filtered.length === 0) {
      toast.error("No engagements to export with the current filters.");
      return;
    }
    const rows = exportRowsForFiltered();
    const stamp = new Date().toLocaleString();
    const escapeHtml = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const tableRows = rows
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(r.match_id.slice(0, 8))}…</td>
          <td>${escapeHtml(r.status)}</td>
          <td>${escapeHtml(r.counterparty_org || r.counterparty_email || "—")}</td>
          <td>${escapeHtml(r.initiator_org)}</td>
          <td>${escapeHtml(r.commodity)}<br/><small>${escapeHtml(r.quantity)} · ${escapeHtml(r.price)}</small></td>
          <td>${escapeHtml(r.created_at ? new Date(r.created_at).toLocaleString() : "")}</td>
          <td>${r.support_notes
            ? `<div class="notes">${escapeHtml(r.support_notes)}</div>
               <small>updated ${escapeHtml(r.support_notes_updated_at ? new Date(r.support_notes_updated_at).toLocaleString() : "—")}</small>`
            : '<span class="muted">—</span>'}</td>
        </tr>`
      )
      .join("");

    const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>Pending Engagements Export</title>
<style>
  @page { size: A4 landscape; margin: 16mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; font-size: 10px; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .meta { color: #64748b; font-size: 10px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 600; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; }
  td.notes, .notes { white-space: pre-wrap; max-width: 280px; }
  small { color: #64748b; }
  .muted { color: #94a3b8; }
  tr { page-break-inside: avoid; }
</style></head>
<body>
  <h1>Pending Engagements — Reviewer Export</h1>
  <div class="meta">
    Generated ${escapeHtml(stamp)} · ${rows.length} engagement${rows.length === 1 ? "" : "s"} ·
    Scope: ${escapeHtml(scope)} · Status filter: ${escapeHtml(filter)} ·
    Notes filter: ${escapeHtml(notesFilter)}${notesFrom ? ` · From ${escapeHtml(notesFrom)}` : ""}${notesTo ? ` · To ${escapeHtml(notesTo)}` : ""}
  </div>
  <table>
    <thead><tr>
      <th>Match</th><th>Status</th><th>Counterparty</th><th>Initiator</th>
      <th>Commodity / terms</th><th>Created</th><th>Reviewer support notes</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <script>window.onload = () => { setTimeout(() => window.print(), 250); };</script>
</body></html>`;

    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) {
      toast.error("Pop-up blocked. Allow pop-ups for this site to export to PDF.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    toast.success(`Opened ${rows.length} engagement${rows.length === 1 ? "" : "s"} — use the print dialog to save as PDF.`);
  };

  // ── SLA configuration (loaded from admin_settings.outreach_sla) ──
  const [slaThresholdHours, setSlaThresholdHours] = useState<number>(48);
  const [slaReminderEmail, setSlaReminderEmail] = useState<string>("support@izenzo.co.za");
  const [slaScanRunning, setSlaScanRunning] = useState(false);

  // Dialog state
  const [contactDialog, setContactDialog] = useState<Engagement | null>(null);
  const [logDialog, setLogDialog] = useState<Engagement | null>(null);
  const [logs, setLogs] = useState<OutreachLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Contact form state
  const [contactMethod, setContactMethod] = useState<string>("email");
  const [contactDetail, setContactDetail] = useState<string>("");
  const [contactNotes, setContactNotes] = useState<string>("");

  // ── Outreach email (preview + send) state ──
  const [outreachDialog, setOutreachDialog] = useState<Engagement | null>(null);
  const [outreachLoading, setOutreachLoading] = useState(false);
  const [outreachSending, setOutreachSending] = useState(false);
  const [outreachRecipient, setOutreachRecipient] = useState<string>("");
  const [outreachSuppressed, setOutreachSuppressed] = useState(false);
  const [outreachSubject, setOutreachSubject] = useState<string>("");
  const [outreachMessage, setOutreachMessage] = useState<string>("");
  const [outreachCounterpartyName, setOutreachCounterpartyName] = useState<string>("");
  const [outreachContext, setOutreachContext] = useState<{
    commodity: string | null;
    role: string | null;
    quantity: string | null;
    price: string | null;
    initiator: string | null;
  } | null>(null);

  const fetchEngagements = async () => {
    setRefreshing(true);
    try {
      // Server scopes by counterparty_type. Default = "unknown" (this panel's purpose).
      const { data, error } = await supabase.functions.invoke(
        `poi-engagements?type=${scope}`,
        { method: "GET" }
      );
      if (error) throw error;
      setEngagements((data?.engagements ?? []) as Engagement[]);
    } catch (err) {
      console.error("Failed to load engagements:", err);
      toast.error("Failed to load engagements");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // ── Off-scope visibility: count engagements that auto-linked to a known org ──
  // We query directly (no edge call) for two cheap counts so the "All" bucket is
  // never invisible. Failures here are non-fatal — we just hide the badge.
  const fetchKnownCounts = async () => {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [totalRes, recentRes] = await Promise.all([
        supabase
          .from("poi_engagements")
          .select("id", { count: "exact", head: true })
          .eq("counterparty_type", "known"),
        supabase
          .from("poi_engagements")
          .select("id", { count: "exact", head: true })
          .eq("counterparty_type", "known")
          .gte("updated_at", sevenDaysAgo),
      ]);
      if (!totalRes.error) setKnownTotalCount(totalRes.count ?? 0);
      if (!recentRes.error) setKnownRecentCount(recentRes.count ?? 0);
    } catch {
      // non-fatal
    }
  };

  // ── Load SLA settings (threshold + reminder recipient) from admin_settings ──
  const fetchSlaSettings = async () => {
    const { data, error } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "outreach_sla")
      .maybeSingle();
    if (error) {
      console.warn("Failed to load SLA settings:", error.message);
      return;
    }
    const v = (data?.value ?? {}) as { threshold_hours?: number; reminder_email?: string };
    if (typeof v.threshold_hours === "number" && v.threshold_hours > 0) {
      setSlaThresholdHours(v.threshold_hours);
    }
    if (typeof v.reminder_email === "string" && v.reminder_email.includes("@")) {
      setSlaReminderEmail(v.reminder_email);
    }
  };

  // ── Manually trigger the SLA scan (sends digest if any overdue) ──
  const runSlaScan = async () => {
    setSlaScanRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("outreach-sla-monitor", {
        body: {},
      });
      if (error) throw error;
      const result = data as {
        ok: boolean;
        overdue_total?: number;
        eligible_for_reminder?: number;
        email_sent?: boolean;
        recipient?: string;
      };
      if (result?.email_sent) {
        toast.success(
          `SLA digest sent to ${result.recipient}: ${result.eligible_for_reminder} engagement(s) flagged.`
        );
      } else if ((result?.overdue_total ?? 0) === 0) {
        toast.success("SLA scan complete — no overdue engagements.");
      } else {
        toast.info(
          `SLA scan complete: ${result?.overdue_total ?? 0} overdue, all recently reminded (no new digest).`
        );
      }
      fetchEngagements();
    } catch (err: any) {
      console.error("SLA scan error:", err);
      toast.error(err?.message || "Failed to run SLA scan");
    } finally {
      setSlaScanRunning(false);
    }
  };

  useEffect(() => {
    fetchEngagements();
    fetchKnownCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    fetchSlaSettings();
  }, []);

  // ── Realtime: live refresh when any admin edits a POI engagement (support notes,
  // status changes, SLA reminders). Coalesce bursts via a short debounce so a wave
  // of updates triggers a single refetch.
  const [liveStatus, setLiveStatus] = useState<"connecting" | "live" | "offline">("connecting");
  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        fetchEngagements();
        fetchKnownCounts();
      }, 400);
    };

    const channel = supabase
      .channel("admin-poi-engagements-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "poi_engagements" },
        () => scheduleRefresh()
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLiveStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setLiveStatus("offline");
        }
      });

    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An engagement is considered "auto-linked" when the counterparty has signed up
  // and our trigger has populated counterparty_org_id. These rows no longer need
  // outreach, so they're hidden from the active queue (still visible in "all").
  const isAutoLinked = (e: Engagement) => Boolean(e.counterparty_org_id);

  /**
   * Persistent row-level binding state — derived from the engagement row, NOT
   * from the transient PATCH toast. This means the badge survives reloads,
   * filter changes, and tab switches, so admins never have to remember what
   * a previous toast said. Mirrors the four states defined by the
   * `BINDING_HINT_MESSAGES` contract in src/types/poi-engagement.ts.
   */
  type BindingBadgeState = {
    key: "linked" | "unregistered" | "suppressed" | "no_contact";
    label: string;
    title: string;
    className: string;
  };
  const getBindingBadge = (e: Engagement): BindingBadgeState => {
    if (e.counterparty_org_id) {
      return {
        key: "linked",
        label: "Linked",
        title:
          "Counterparty email is bound to a registered organisation — they will see this in their inbound queue.",
        className: "bg-emerald-50 text-emerald-800 border-emerald-300",
      };
    }
    const email = (e.counterparty_email ?? "").trim();
    if (!email) {
      return {
        key: "no_contact",
        label: "No contact",
        title: "No counterparty email on file. Use Add contact to capture a discovered email.",
        className: "bg-slate-100 text-slate-700 border-slate-300",
      };
    }
    if (!isUsableOutreachEmail(email)) {
      return {
        key: "suppressed",
        label: "Suppressed / test",
        title:
          "Email uses a non-deliverable domain (e.g. .invalid) or is otherwise suppressed. Use Add contact to replace it.",
        className: "bg-rose-50 text-rose-800 border-rose-300",
      };
    }
    return {
      key: "unregistered",
      label: "Unregistered",
      title:
        "Email saved but no registered organisation matches it yet. Outreach can be sent — they will see the engagement once they sign up.",
      className: "bg-amber-50 text-amber-800 border-amber-300",
    };
  };

  const filtered = useMemo(() => {
    let base: Engagement[];
    if (filter === "all") base = engagements;
    else if (filter === "active") {
      // D-05: canonical pre-acceptance set, plus legacy 'pending' defensively.
      base = engagements.filter(
        (e) => isEngagementPending(e.engagement_status) && !isAutoLinked(e)
      );
    } else if (filter === "pending") {
      // D-05: the "pending" filter tab is now an alias for the canonical
      // pending set. A bookmark to ?filter=pending must still surface the
      // notification_sent + contacted rows that operators expect to see.
      base = engagements.filter(
        (e) => isEngagementPending(e.engagement_status) && !isAutoLinked(e)
      );
    } else if (filter === "notification_sent") {
      base = engagements.filter((e) => e.engagement_status === filter && !isAutoLinked(e));
    } else {
      base = engagements.filter((e) => e.engagement_status === filter);
    }

    // ── Reviewer support-notes overlay filter ──
    const hasNotes = (e: Engagement) => Boolean(e.support_notes && e.support_notes.trim().length > 0);
    if (notesFilter === "with") base = base.filter(hasNotes);
    else if (notesFilter === "without") base = base.filter((e) => !hasNotes(e));

    // Date-range filter on support_notes_updated_at (inclusive). Implies "with notes".
    if (notesFrom || notesTo) {
      const fromMs = notesFrom ? new Date(`${notesFrom}T00:00:00`).getTime() : -Infinity;
      const toMs = notesTo ? new Date(`${notesTo}T23:59:59.999`).getTime() : Infinity;
      base = base.filter((e) => {
        if (!e.support_notes_updated_at) return false;
        const t = new Date(e.support_notes_updated_at).getTime();
        return t >= fromMs && t <= toMs;
      });
    }
    return base;
  }, [engagements, filter, notesFilter, notesFrom, notesTo]);

  const stats = useMemo(() => {
    // D-05: canonical pending set = notification_sent + contacted (legacy
    // 'pending' included defensively via isEngagementPending). The previous
    // `pending` counter keyed off the dead 'pending' literal and always
    // returned 0, hiding all admin-actionable rows.
    const awaitingAdminAction = engagements.filter(
      (e) => isEngagementPending(e.engagement_status) && !isAutoLinked(e)
    );
    return {
      total: engagements.length,
      // `pending` retained for backwards compatibility with consumers, but
      // now reflects the canonical pending set rather than the dead literal.
      pending: awaitingAdminAction.length,
      notified: engagements.filter((e) => e.engagement_status === "notification_sent" && !isAutoLinked(e)).length,
      contacted: engagements.filter((e) => e.engagement_status === "contacted").length,
      accepted: engagements.filter((e) => e.engagement_status === "accepted").length,
      autoLinked: engagements.filter(isAutoLinked).length,
      awaitingOutreach: awaitingAdminAction.length,
    };
  }, [engagements]);

  // ── Send counterparty notification via the engagement outreach endpoint ──
  const sendNotification = async (eng: Engagement) => {
    if (!isUsableOutreachEmail(eng.counterparty_email)) {
      toast.error(
        eng.counterparty_email
          ? "Cannot notify: counterparty email uses a non-deliverable test domain (.invalid)."
          : "Cannot notify: no valid counterparty email on file.",
      );
      return;
    }
    setActionLoadingId(eng.id);
    try {
      const { data: preview, error: previewErr } = await supabase.functions.invoke(
        `poi-engagements/${eng.id}/preview-outreach`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: {},
        }
      );
      if (previewErr) throw previewErr;
      if (preview?.suppressed) {
        toast.error("This address is on the suppression list. Use Record contact to log non-email outreach (phone, WhatsApp, in person).");
        return;
      }

      const { data, error } = await supabase.functions.invoke(
        `poi-engagements/${eng.id}/send-outreach`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: {
            subject: preview?.subject || `Trade interest from a verified Izenzo counterparty [${eng.id.slice(0, 8)}]`,
            custom_message: preview?.template_data?.customMessage || undefined,
          },
        }
      );
      if (error) throw error;

      toast.success(`Notification sent to ${data?.sent_to ?? eng.counterparty_email}`);
      fetchEngagements();
    } catch (err: any) {
      console.error("Send notification error:", err);
      const msg = await extractEdgeError(err, "Failed to send notification");
      toast.error(msg);
    } finally {
      setActionLoadingId(null);
    }
  };

  // ── Open the "Mark as contacted" dialog ──
  // Default to Email in both cases:
  //   • If an email is on file, pre-fill it so the admin can confirm/correct.
  //   • If NO email is on file, still default to Email and leave the field
  //     blank so the admin sees the editable email input immediately and
  //     can capture a discovered address inline (the "Preview & send email"
  //     button will then PATCH counterparty_email before sending).
  // The admin can still switch the dropdown to phone/WhatsApp/etc. for
  // non-email outreach methods.
  const openContactDialog = (eng: Engagement) => {
    setContactDialog(eng);
    const hasEmail = !!(eng.counterparty_email && eng.counterparty_email.trim());
    setContactMethod("email");
    setContactDetail(hasEmail ? eng.counterparty_email! : "");
    setContactNotes("");
  };

  // When the admin switches contact method, reset the detail field unless
  // we have a sensible pre-fill (only email has one - the counterparty_email).
  const handleMethodChange = (next: string) => {
    setContactMethod(next);
    if (next === "email") {
      setContactDetail(contactDialog?.counterparty_email ?? "");
    } else {
      setContactDetail("");
    }
  };

  const CONTACT_METHOD_META: Record<string, { label: string; placeholder: string }> = {
    email:     { label: "Email address",       placeholder: "name@example.com" },
    phone:     { label: "Phone number",        placeholder: "+27 82 555 0100" },
    linkedin:  { label: "LinkedIn profile URL", placeholder: "https://www.linkedin.com/in/…" },
    whatsapp:  { label: "WhatsApp number",     placeholder: "+27 82 555 0100" },
    in_person: { label: "Meeting reference",   placeholder: "e.g. Cape Town office, 18 Apr" },
    other:     { label: "Contact reference",   placeholder: "Describe how the counterparty was reached" },
  };

  // Try to extract the real error message from a Supabase functions.invoke
  // failure. The SDK throws a generic "Edge Function returned a non-2xx status
  // code" — the useful detail lives on `error.context.body` (a Response).
  const extractEdgeError = async (err: any, fallback: string): Promise<string> => {
    try {
      const ctxBody = err?.context?.body;
      if (ctxBody && typeof ctxBody.json === "function") {
        const parsed = await ctxBody.json();
        if (parsed?.message) return String(parsed.message);
      }
      if (typeof err?.message === "string" && err.message.length > 0) {
        // Skip the unhelpful generic SDK string
        if (!err.message.includes("non-2xx status code")) return err.message;
      }
    } catch { /* fall through */ }
    return fallback;
  };

  const submitContact = async () => {
    if (!contactDialog) return;
    if (!contactDetail.trim()) {
      toast.error("Contact detail is required");
      return;
    }
    setActionLoadingId(contactDialog.id);
    try {
      const { error } = await supabase.functions.invoke(
        `poi-engagements/${contactDialog.id}`,
        {
          method: "PATCH",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: {
            engagement_status: "contacted",
            contact_method: contactMethod,
            contact_detail: contactDetail.trim(),
            admin_notes: contactNotes.trim() || undefined,
          },
        }
      );
      if (error) throw error;
      toast.success("Engagement marked as contacted");
      setContactDialog(null);
      fetchEngagements();
    } catch (err) {
      console.error("Mark contacted error:", err);
      const msg = await extractEdgeError(err, "Failed to mark as contacted");
      toast.error(msg);
    } finally {
      setActionLoadingId(null);
    }
  };

  // ── Open the outreach email preview dialog (for method=email) ──
  // Closes the contact dialog, fetches the rendered preview from the backend.
  const openOutreachDialog = async () => {
    if (!contactDialog) return;
    if (!contactDetail.trim()) {
      toast.error("Email address is required");
      return;
    }
    if (!isUsableOutreachEmail(contactDetail)) {
      toast.error("Cannot preview: email uses a non-deliverable test domain (.invalid).");
      return;
    }

    const eng = contactDialog;
    setOutreachLoading(true);
    setOutreachDialog(eng);
    setContactDialog(null);
    setOutreachRecipient(contactDetail.trim().toLowerCase());
    setOutreachSuppressed(false);
    setOutreachSubject("");
    setOutreachMessage("");
    setOutreachCounterpartyName("");
    setOutreachContext(null);

    try {
      // If the admin typed a different email than the one on file, persist it
      // first so the preview/send pulls the correct recipient.
      if (
        contactDetail.trim().toLowerCase() !== (eng.counterparty_email ?? "").toLowerCase() &&
        contactDetail.trim().length > 0
      ) {
        const { data: patchData, error: patchError } = await supabase.functions.invoke<UpdatePoiEngagementResponse>(
          `poi-engagements/${eng.id}`,
          {
            method: "PATCH",
            headers: { "Idempotency-Key": crypto.randomUUID() },
            body: { counterparty_email: contactDetail.trim() },
          },
        );
        // ── Surface PATCH failures explicitly. Previously we only
        // destructured `data`, which silently swallowed save errors and
        // let the code fall through to preview-outreach — which then
        // 400'd with the misleading "no usable counterparty email on
        // file" toast even though the real failure was the upstream
        // PATCH (e.g. validation rejected the address, idempotency
        // collision, transient 5xx). This is the "Zero Swallowed
        // Errors" rule applied: a PATCH failure must surface the
        // server's real reason and abort the outreach flow so the
        // admin can correct the input. ──
        if (patchError) {
          const msg = await extractEdgeError(
            patchError,
            "Could not save the counterparty email. Please check the address and try again.",
          );
          toast.error(msg);
          setOutreachDialog(null);
          return;
        }
        // Surface the auto-resolution outcome to the reviewer so they know
        // immediately whether the recipient will see this in their inbound
        // queue. Non-fatal — the email is saved either way.
        const hint = patchData?.binding;
        if (hint) {
          const copy = BINDING_HINT_MESSAGES[hint.status];
          if (copy.tone === "success") toast.success(copy.title);
          else if (copy.tone === "warning") toast.warning(copy.title);
          else if (copy.tone === "error") toast.error(copy.title);
          else toast.info(copy.title);
        }
      }

      const { data, error } = await supabase.functions.invoke(
        `poi-engagements/${eng.id}/preview-outreach`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: {},
        }
      );
      if (error) throw error;

      const td = data?.template_data ?? {};
      setOutreachRecipient(data?.recipient ?? "");
      setOutreachSuppressed(!!data?.suppressed);
      // Defensive client-side clamp — server contract is 200 chars. The server
      // already truncates safely, but if an older deployment returns a longer
      // subject we clamp here so the field never exceeds the limit on prefill.
      setOutreachSubject((data?.subject ?? "").slice(0, 200));
      setOutreachMessage(td.customMessage ?? "");
      setOutreachContext({
        commodity: td.commodity ?? null,
        role: td.counterpartyRole ?? null,
        quantity: [td.quantityAmount, td.quantityUnit].filter(Boolean).join(" ") || null,
        price: [td.priceCurrency, td.priceAmount?.toLocaleString?.() ?? td.priceAmount].filter(Boolean).join(" ") || null,
        initiator: td.initiatorOrgName ?? null,
      });
    } catch (err: any) {
      console.error("Preview outreach error:", err);
      // Fallback only kicks in if the server returned no parseable message.
      // Previously the fallback asserted a specific cause ("no usable
      // counterparty email on file"), which was misleading whenever the
      // real failure was upstream (e.g. the PATCH that should have saved
      // the email was silently swallowed). Keep the fallback neutral so
      // the user is not led to the wrong fix.
      const msg = await extractEdgeError(
        err,
        "Could not load email preview. Please try again — if the problem persists, check the engagement details and reload.",
      );
      toast.error(msg);
      setOutreachDialog(null);
    } finally {
      setOutreachLoading(false);
    }
  };

  // ── Send the outreach email and atomically mark contacted ──
  const sendOutreach = async () => {
    if (!outreachDialog) return;
    if (!outreachSubject.trim()) {
      toast.error("Subject is required");
      return;
    }
    setOutreachSending(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        `poi-engagements/${outreachDialog.id}/send-outreach`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: {
            subject: outreachSubject.trim(),
            custom_message: outreachMessage.trim() || undefined,
            counterparty_name: outreachCounterpartyName.trim() || undefined,
          },
        }
      );
      if (error) {
        // FunctionsHttpError carries the server response body in `context`.
        // The backend uses the standard ApiError envelope:
        //   { code, message, details?, requestId }
        // Surface all of it so admins can see *why* the send was rejected
        // (e.g. MAINTENANCE_MODE, RECIPIENT_SUPPRESSED, INVALID_STATE, …)
        // instead of the opaque "non-2xx status code" Supabase wraps it in.
        const ctx = (error as { context?: Response }).context;
        const fallback = error.message || "Failed to send outreach email";
        let title = fallback;
        let description: string | undefined;
        let status: number | undefined = ctx?.status;

        if (ctx && typeof ctx.text === "function") {
          try {
            const text = await ctx.clone().text();
            try {
              const parsed = JSON.parse(text);
              const code = parsed.code || parsed.error_code;
              const message =
                parsed.message || parsed.error || parsed.error_description;
              if (code && message) {
                title = `${code}: ${message}`;
              } else if (message) {
                title = message;
              } else if (code) {
                title = code;
              } else if (text) {
                title = text;
              }
              const parts: string[] = [];
              if (status) parts.push(`HTTP ${status}`);
              if (parsed.requestId) parts.push(`req ${parsed.requestId}`);
              if (parsed.details) {
                try {
                  parts.push(JSON.stringify(parsed.details));
                } catch {
                  /* ignore */
                }
              }
              description = parts.join(" · ") || undefined;
            } catch {
              // Non-JSON body — show raw text + status.
              title = text || fallback;
              description = status ? `HTTP ${status}` : undefined;
            }
          } catch {
            // ignore body read failures
          }
        }
        throw Object.assign(new Error(title), { description });
      }
      toast.success(`Email sent to ${data?.sent_to ?? outreachRecipient}`);
      setOutreachDialog(null);
      fetchEngagements();
    } catch (err: any) {
      console.error("Send outreach error:", err);
      toast.error(err?.message || "Failed to send outreach email", {
        description: err?.description,
        duration: 12000,
      });
    } finally {
      setOutreachSending(false);
    }
  };
  const setStatus = async (eng: Engagement, status: "declined" | "expired") => {
    setActionLoadingId(eng.id);
    try {
      const { error } = await supabase.functions.invoke(
        `poi-engagements/${eng.id}`,
        {
          method: "PATCH",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: { engagement_status: status },
        }
      );
      if (error) throw error;
      toast.success(`Engagement ${status}`);
      fetchEngagements();
    } catch (err) {
      console.error(`Set ${status} error:`, err);
      toast.error(`Failed to mark ${status}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  // ── View immutable outreach log ──
  const openLog = async (eng: Engagement) => {
    setLogDialog(eng);
    setLogs([]);
    setLogsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        `poi-engagements/${eng.id}/outreach-log`,
        { method: "GET" }
      );
      if (error) throw error;
      setLogs((data?.logs ?? []) as OutreachLog[]);
    } catch (err) {
      console.error("Load outreach log error:", err);
      toast.error("Failed to load outreach log");
    } finally {
      setLogsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + refresh */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Pending Engagements</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            POI hold-point queue for {scope === "unknown" ? "unknown counterparties awaiting outreach" : "all counterparty engagements"}.
            Send notifications and record manual contact attempts — every action is written to an immutable outreach log.
          </p>
          <p className="text-xs text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              <Clock className="inline h-3 w-3 mr-1" />
              SLA: {slaThresholdHours}h · digest → <span className="font-mono">{slaReminderEmail}</span>
            </span>
            {scope === "unknown" && stats.autoLinked > 0 && (
              <span className="text-emerald-700">
                · {stats.autoLinked} auto-linked (hidden from active queue)
              </span>
            )}
          </p>
          {scope === "unknown" && knownRecentCount > 0 && (
            <div className="mt-3 max-w-2xl rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-sky-700" />
              <div className="flex-1">
                <strong>Looking for an engagement that disappeared?</strong>{" "}
                {knownRecentCount} engagement{knownRecentCount === 1 ? "" : "s"} moved out of this view
                in the last 7 days because the counterparty email matched a registered organisation.
                They are still live — they're now visible under <strong>All</strong> (the row is filed
                under the counterparty's organisation, not as an "unknown outreach" task).
                <button
                  type="button"
                  onClick={() => setScope("all")}
                  className="ml-1 underline font-medium hover:text-sky-700"
                >
                  Switch to All →
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {/* Scope toggle: unknown-only is the default; "all" is a diagnostic mode */}
          <div className="inline-flex rounded-sm border border-slate-200 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setScope("unknown")}
              className={`px-3 py-1.5 ${scope === "unknown" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
              title="Show only engagements where the counterparty is not yet on the platform"
            >
              Unknown only
            </button>
            <button
              type="button"
              onClick={() => setScope("all")}
              className={`px-3 py-1.5 border-l border-slate-200 inline-flex items-center gap-1.5 ${scope === "all" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
              title="Include known-counterparty (already-on-platform) engagements. Engagements auto-promote here as soon as their counterparty email matches a registered organisation."
            >
              All
              {knownTotalCount > 0 && (
                <span
                  className={`inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 rounded-full text-[10px] font-semibold ${
                    scope === "all" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"
                  }`}
                  title={`${knownTotalCount} engagement(s) on this platform have a known (registered) counterparty`}
                >
                  +{knownTotalCount}
                </span>
              )}
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={runSlaScan}
            disabled={slaScanRunning}
            title={`Scan for engagements awaiting outreach beyond ${slaThresholdHours}h`}
          >
            {slaScanRunning
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <AlertTriangle className="h-4 w-4 mr-2" />}
            Run SLA scan
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
            title="Download the currently filtered engagements as CSV (includes reviewer support notes & timestamps)"
          >
            <Download className="h-4 w-4 mr-2" />
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPdf}
            disabled={filtered.length === 0}
            title="Open a print-ready report of filtered engagements — use your browser's Save as PDF"
          >
            <FileText className="h-4 w-4 mr-2" />
            PDF
          </Button>
          <Badge
            variant="outline"
            className={
              liveStatus === "live"
                ? "bg-emerald-50 text-emerald-700 border-emerald-300 text-[11px] gap-1.5"
                : liveStatus === "connecting"
                  ? "bg-slate-100 text-slate-600 border-slate-300 text-[11px] gap-1.5"
                  : "bg-amber-50 text-amber-800 border-amber-300 text-[11px] gap-1.5"
            }
            title={
              liveStatus === "live"
                ? "Live: support-note edits and status changes from other admins appear automatically"
                : liveStatus === "connecting"
                  ? "Connecting to live updates…"
                  : "Live updates offline — use Refresh to reload"
            }
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                liveStatus === "live"
                  ? "bg-emerald-500 animate-pulse"
                  : liveStatus === "connecting"
                    ? "bg-slate-400"
                    : "bg-amber-500"
              }`}
            />
            {liveStatus === "live" ? "Live" : liveStatus === "connecting" ? "Connecting…" : "Offline"}
          </Badge>
          <Button variant="outline" size="sm" onClick={fetchEngagements} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total", value: stats.total, icon: Inbox },
          { label: "Awaiting action", value: stats.pending, icon: Clock },
          { label: "Awaiting outreach", value: stats.notified, icon: Mail },
          { label: "Contacted", value: stats.contacted, icon: Send },
          { label: "Accepted", value: stats.accepted, icon: CheckCircle2 },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-bold">{s.value}</p>
                </div>
                <s.icon className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter tabs */}
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList className="bg-white border border-slate-200 rounded-sm flex-wrap h-auto">
          {FILTER_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Reviewer support-notes filter */}
      <div className="flex flex-wrap items-end gap-3 p-3 rounded-md border border-slate-200 bg-slate-50/60">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wide text-slate-600 font-semibold flex items-center gap-1.5">
            <StickyNote className="h-3 w-3" />
            Reviewer notes
          </Label>
          <div className="inline-flex rounded-sm border border-slate-300 overflow-hidden text-xs">
            {([
              { v: "any", label: "Any" },
              { v: "with", label: "With notes" },
              { v: "without", label: "Without notes" },
            ] as const).map((opt, i) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setNotesFilter(opt.v)}
                className={`px-3 py-1.5 ${i > 0 ? "border-l border-slate-300" : ""} ${
                  notesFilter === opt.v
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="notes-from" className="text-[11px] uppercase tracking-wide text-slate-600 font-semibold">
            Updated from
          </Label>
          <Input
            id="notes-from"
            type="date"
            value={notesFrom}
            max={notesTo || undefined}
            onChange={(e) => setNotesFrom(e.target.value)}
            className="h-8 w-[160px] text-xs bg-white"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="notes-to" className="text-[11px] uppercase tracking-wide text-slate-600 font-semibold">
            Updated to
          </Label>
          <Input
            id="notes-to"
            type="date"
            value={notesTo}
            min={notesFrom || undefined}
            onChange={(e) => setNotesTo(e.target.value)}
            className="h-8 w-[160px] text-xs bg-white"
          />
        </div>

        {(notesFilter !== "any" || notesFrom || notesTo) && (
          <div className="flex items-center gap-2 ml-auto">
            <Badge variant="outline" className="bg-amber-50 text-amber-900 border-amber-300 text-[11px]">
              {filtered.length} match{filtered.length === 1 ? "" : "es"}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                setNotesFilter("any");
                setNotesFrom("");
                setNotesTo("");
              }}
            >
              Clear
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-12 text-sm">
              No engagements match the current filter.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Match</TableHead>
                    <TableHead>Initiator</TableHead>
                    <TableHead>Counterparty</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((e) => {
                    const m = e.matches;
                    const isTerminal = ["accepted", "declined", "expired"].includes(e.engagement_status);
                    return (
                      <React.Fragment key={e.id}>
                        <TableRow>
                        <TableCell>
                          <div className="text-sm">
                            <p className="font-medium">{m?.commodity ?? "-"}</p>
                            <p className="text-xs text-muted-foreground">
                              {m?.quantity_amount} {m?.quantity_unit} · {m?.price_currency} {m?.price_amount?.toLocaleString?.() ?? "-"}
                            </p>
                            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                              {e.match_id.substring(0, 8)}…
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {e.initiator_org?.name ?? "-"}
                        </TableCell>
                        <TableCell className="text-sm">
                          <p>{e.counterparty_org?.name ?? "(unregistered)"}</p>
                          {e.counterparty_email ? (
                            <p className="text-xs text-muted-foreground break-all">{e.counterparty_email}</p>
                          ) : (
                            !isTerminal && (
                              <p className="text-[11px] text-amber-700 mt-0.5 leading-snug">
                                No contact details yet. Research this counterparty, add a valid email, then send outreach.
                              </p>
                            )
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 items-start">
                            <Badge
                              variant="outline"
                              className={`whitespace-nowrap text-[11px] font-medium px-2 py-0.5 ${STATUS_STYLES[e.engagement_status] ?? ""}`}
                            >
                              {STATUS_LABELS[e.engagement_status] ?? e.engagement_status.replace("_", " ")}
                            </Badge>
                            {(() => {
                              // Always render exactly one binding badge so
                              // admins can see the persisted contact-binding
                              // state at a glance (linked / unregistered /
                              // suppressed / no contact) — no need to rely
                              // on the transient toast from the last save.
                              const b = getBindingBadge(e);
                              return (
                                <Badge
                                  variant="outline"
                                  className={`whitespace-nowrap text-[10px] font-medium px-2 py-0.5 ${b.className}`}
                                  title={b.title}
                                  aria-label={`Contact binding: ${b.label}. ${b.title}`}
                                  data-binding-state={b.key}
                                >
                                  {b.key === "linked" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                                  {b.key === "suppressed" && <AlertTriangle className="h-3 w-3 mr-1" />}
                                  {b.label}
                                </Badge>
                              );
                            })()}
                            {(() => {
                              // SLA badge: only render for non-terminal "awaiting outreach" states
                              // AND only when the counterparty has not been auto-linked.
                              if (isAutoLinked(e)) return null;
                              if (!isEngagementPending(e.engagement_status)) return null;
                              const ageHours = (Date.now() - new Date(e.created_at).getTime()) / 3600_000;
                              if (ageHours < slaThresholdHours) return null;
                              const overdueBy = Math.round(ageHours - slaThresholdHours);
                              const reminders = e.sla_reminder_count ?? 0;
                              return (
                                <Badge
                                  variant="outline"
                                  className="whitespace-nowrap text-[10px] font-medium px-2 py-0.5 bg-amber-50 text-amber-800 border-amber-300"
                                  title={`Awaiting outreach for ${Math.round(ageHours)}h (SLA: ${slaThresholdHours}h)${reminders ? ` · ${reminders} reminder${reminders === 1 ? '' : 's'} sent` : ''}`}
                                >
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  SLA +{overdueBy}h
                                  {reminders > 0 && <span className="ml-1 opacity-70">({reminders})</span>}
                                </Badge>
                              );
                            })()}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div>{new Date(e.created_at).toLocaleDateString()}</div>
                          {e.sla_reminder_sent_at && (
                            <div className="text-[10px] mt-0.5">
                              Reminded {new Date(e.sla_reminder_sent_at).toLocaleDateString()}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end flex-wrap">
                            {/* Add contact: dedicated discovery affordance for unregistered counterparties.
                                Distinct from "Mark contacted" — captures a discovered email so Notify can run.
                                Shown whenever the row has no usable email and the engagement isn't terminal. */}
                            {!isTerminal && !isUsableOutreachEmail(e.counterparty_email) && (
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() =>
                                  setAddContactFor({
                                    id: e.id,
                                    match_id: e.match_id,
                                    counterparty_org_name: e.counterparty_org?.name ?? null,
                                    counterparty_email: e.counterparty_email,
                                    commodity: e.matches?.commodity ?? null,
                                  })
                                }
                                disabled={actionLoadingId === e.id}
                                title="Capture a discovered contact email so outreach can be sent"
                                aria-label="Add contact details"
                              >
                                <UserPlus className="h-3 w-3 mr-1" /> Add contact
                              </Button>
                            )}
                            {/* Send outreach (formerly "Notify"): platform-sent email via Resend. Only offered for
                                pre-acceptance states with a deliverable email. Distinct from "Record contact" which is audit-only. */}
                            {(e.engagement_status === "notification_sent" || e.engagement_status === "pending") && (() => {
                              const usable = isUsableOutreachEmail(e.counterparty_email);
                              const reason = !e.counterparty_email
                                ? "Cannot send outreach: no valid counterparty email on file. Use Add contact first."
                                : !usable
                                  ? "Cannot send outreach: counterparty email uses a non-deliverable test domain (.invalid). Use Add contact to replace it."
                                  : "Platform sends an outreach email via Resend";
                              return (
                                <Button
                                  size="sm" variant="outline"
                                  onClick={() => sendNotification(e)}
                                  disabled={actionLoadingId === e.id || !usable}
                                  title={reason}
                                  aria-label={reason}
                                >
                                  <Mail className="h-3 w-3 mr-1" /> Send outreach
                                </Button>
                              );
                            })()}
                            {/* Record contact: audit-only log of how the admin reached the counterparty
                                outside the platform (phone, WhatsApp, in person, LinkedIn).
                                Choosing "Email" inside the dialog still routes to the platform send path. */}
                            {!isTerminal && (
                              <Button
                                size="sm" variant="outline"
                                onClick={() => openContactDialog(e)}
                                disabled={actionLoadingId === e.id}
                                title="Log how you reached the counterparty (off-platform). For platform-sent email, use Send outreach."
                              >
                                <Send className="h-3 w-3 mr-1" /> Record contact
                              </Button>
                            )}
                            {!isTerminal && (
                              <Button
                                size="sm" variant="outline"
                                onClick={() => setStatus(e, "declined")}
                                disabled={actionLoadingId === e.id}
                              >
                                <XCircle className="h-3 w-3 mr-1" /> Decline
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant={e.support_notes ? "default" : "ghost"}
                              onClick={() => openSupportNotes(e)}
                              title={e.support_notes ? "View / edit reviewer support notes" : "Add reviewer support notes (admin-only)"}
                              className={e.support_notes ? "bg-amber-100 text-amber-900 hover:bg-amber-200 border border-amber-300" : ""}
                            >
                              <StickyNote className="h-3 w-3 mr-1" />
                              Notes{e.support_notes ? " •" : ""}
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => openLog(e)}
                            >
                              <History className="h-3 w-3 mr-1" /> Log
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {notesOpenId === e.id && (
                        <TableRow key={`${e.id}-notes`} className="bg-slate-50/60 hover:bg-slate-50/60">
                          <TableCell colSpan={6} className="py-4">
                            <div className="space-y-2 max-w-3xl">
                              <div className="flex items-center justify-between gap-2">
                                <Label htmlFor={`support-notes-${e.id}`} className="text-xs font-semibold flex items-center gap-1.5 text-slate-700">
                                  <StickyNote className="h-3.5 w-3.5" />
                                  Reviewer support notes
                                  <Badge variant="outline" className="ml-1 text-[10px] font-medium px-1.5 py-0 bg-slate-100 text-slate-600 border-slate-300">
                                    Admin-only
                                  </Badge>
                                </Label>
                                {e.support_notes_updated_at && (
                                  <span className="text-[10px] text-muted-foreground">
                                    Last edited {new Date(e.support_notes_updated_at).toLocaleString()}
                                  </span>
                                )}
                              </div>
                              <Textarea
                                id={`support-notes-${e.id}`}
                                value={notesDraft}
                                onChange={(ev) => setNotesDraft(ev.target.value)}
                                placeholder="Reviewer-only context: outreach quality, contact difficulties, sanction concerns, escalation notes. Never visible to counterparties or initiators."
                                rows={4}
                                maxLength={4000}
                                className="text-sm bg-white"
                              />
                              {(() => {
                                const previous = (e.support_notes ?? "").trim();
                                const next = notesDraft.trim();
                                if (previous === next) return null;
                                const changeLabel =
                                  previous.length === 0
                                    ? "New note (not yet saved)"
                                    : next.length === 0
                                      ? "Note will be cleared"
                                      : "Pending changes vs. saved version";
                                const prevLines = previous ? previous.split("\n") : [];
                                const nextLines = next ? next.split("\n") : [];
                                const prevSet = new Set(prevLines);
                                const nextSet = new Set(nextLines);
                                return (
                                  <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2.5 text-xs space-y-1.5">
                                    <div className="flex items-center gap-1.5 font-semibold text-amber-900">
                                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                                      {changeLabel}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                      <div className="space-y-1">
                                        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">Before (saved)</div>
                                        <div className="rounded border border-slate-200 bg-white p-2 font-mono text-[11px] leading-relaxed max-h-32 overflow-auto whitespace-pre-wrap break-words">
                                          {prevLines.length === 0
                                            ? <span className="italic text-slate-400">— empty —</span>
                                            : prevLines.map((line, i) => (
                                                <div
                                                  key={`p-${i}`}
                                                  className={!nextSet.has(line) ? "bg-rose-100 text-rose-900 -mx-2 px-2" : ""}
                                                >
                                                  {line || "\u00A0"}
                                                </div>
                                              ))}
                                        </div>
                                      </div>
                                      <div className="space-y-1">
                                        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">After (draft)</div>
                                        <div className="rounded border border-slate-200 bg-white p-2 font-mono text-[11px] leading-relaxed max-h-32 overflow-auto whitespace-pre-wrap break-words">
                                          {nextLines.length === 0
                                            ? <span className="italic text-slate-400">— empty —</span>
                                            : nextLines.map((line, i) => (
                                                <div
                                                  key={`n-${i}`}
                                                  className={!prevSet.has(line) ? "bg-emerald-100 text-emerald-900 -mx-2 px-2" : ""}
                                                >
                                                  {line || "\u00A0"}
                                                </div>
                                              ))}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-3 text-[10px] text-slate-600 pt-0.5">
                                      <span>{previous.length} → {next.length} chars</span>
                                      <span className="text-rose-700">− {prevLines.filter(l => !nextSet.has(l)).length} removed</span>
                                      <span className="text-emerald-700">+ {nextLines.filter(l => !prevSet.has(l)).length} added</span>
                                    </div>
                                  </div>
                                );
                              })()}
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] text-muted-foreground">
                                  {notesDraft.length} / 4000
                                </span>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setNotesOpenId(null)}
                                    disabled={notesSaving}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => saveSupportNotes(e)}
                                    disabled={notesSaving}
                                  >
                                    {notesSaving
                                      ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                      : <Save className="h-3 w-3 mr-1" />}
                                    Save notes
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Record contact dialog ──────────────────────────────────────────
          Three sibling actions, one rule each:
            • Add contact   — capture/discovery (AddContactDialog), unblocks email outreach
            • Send outreach — platform sends an email via Resend (row button)
            • Record contact — THIS dialog: audit-only log of off-platform contact
          When the admin selects "Email" inside this dialog, the footer routes
          them into the platform send path (Preview & send) so we never
          silently log "I emailed them" without actually sending. */}
      <Dialog open={!!contactDialog} onOpenChange={(o) => !o && setContactDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record contact with counterparty</DialogTitle>
            <DialogDescription>
              Log how you reached the counterparty <strong>outside the platform</strong> (phone, WhatsApp, LinkedIn, in person). This is an audit-only record — Izenzo does not send anything on your behalf. To send a platform email, close this dialog and use <em>Send outreach</em>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="method">Contact method</Label>
              <SafeSelect label="Contact method" value={contactMethod} onValueChange={handleMethodChange}>
                <SelectTrigger id="method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="phone">Phone</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="linkedin">LinkedIn</SelectItem>
                  <SelectItem value="in_person">In person</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </SafeSelect>
              <p className="text-xs text-muted-foreground">
                {contactMethod === "email"
                  ? "Email is the only method where the platform can send the outreach for you. Choosing Email here will open the preview-and-send flow — it does not silently log a contact."
                  : "This is an audit-only record of how you reached the counterparty off-platform. No message is sent."}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="detail">{CONTACT_METHOD_META[contactMethod]?.label ?? "Contact detail"}</Label>
              <Input
                id="detail"
                value={contactDetail}
                onChange={(e) => setContactDetail(e.target.value)}
                placeholder={CONTACT_METHOD_META[contactMethod]?.placeholder ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={contactNotes}
                onChange={(e) => setContactNotes(e.target.value)}
                placeholder="Outcome, next steps, anything material to the audit trail."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactDialog(null)}>Cancel</Button>
            {contactMethod === "email" ? (
              <Button onClick={openOutreachDialog} disabled={outreachLoading}>
                {outreachLoading && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                <Eye className="h-3 w-3 mr-2" />
                Preview &amp; send email
              </Button>
            ) : (
              <Button onClick={submitContact} disabled={actionLoadingId === contactDialog?.id}>
                {actionLoadingId === contactDialog?.id && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                Record contact
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Outreach email preview & send dialog ───────────────────────── */}
      <Dialog open={!!outreachDialog} onOpenChange={(o) => !o && !outreachSending && setOutreachDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send outreach email</DialogTitle>
            <DialogDescription>
              Review the message before it's sent. Replies will route to <strong>support@izenzo.co.za</strong>.
              On send, the engagement will be marked <strong>contacted</strong> and a full snapshot logged to the immutable trail.
            </DialogDescription>
          </DialogHeader>

          {outreachLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              {outreachSuppressed && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    This address is on the suppression list (previously bounced or unsubscribed). Sending will be blocked. Use a different method to reach this counterparty.
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label>Recipient</Label>
                <Input value={outreachRecipient} readOnly className="font-mono text-sm bg-muted" />
              </div>

              {outreachContext && (
                <div className="rounded-sm border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                  <p className="font-semibold text-slate-700 uppercase tracking-wide text-[10px]">Trade context (auto-included)</p>
                  {outreachContext.commodity && <p><span className="text-muted-foreground">Commodity:</span> {outreachContext.commodity}</p>}
                  {outreachContext.role && <p><span className="text-muted-foreground">Their role:</span> {outreachContext.role}</p>}
                  {outreachContext.quantity && <p><span className="text-muted-foreground">Volume:</span> {outreachContext.quantity}</p>}
                  {outreachContext.price && <p><span className="text-muted-foreground">Price:</span> {outreachContext.price}</p>}
                  {outreachContext.initiator && <p><span className="text-muted-foreground">On behalf of:</span> {outreachContext.initiator}</p>}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="cp-name">Recipient name (optional, for greeting)</Label>
                <Input
                  id="cp-name"
                  value={outreachCounterpartyName}
                  onChange={(e) => setOutreachCounterpartyName(e.target.value)}
                  placeholder="e.g. Jane Smith"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="subj">Subject</Label>
                  <span
                    className={
                      "text-[11px] tabular-nums " +
                      (outreachSubject.length > 190
                        ? "text-destructive font-medium"
                        : "text-muted-foreground")
                    }
                  >
                    {outreachSubject.length}/200
                  </span>
                </div>
                <Input
                  id="subj"
                  value={outreachSubject}
                  onChange={(e) => setOutreachSubject(e.target.value.slice(0, 200))}
                  maxLength={200}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="msg">Personal message (optional, appears above the trade details)</Label>
                <Textarea
                  id="msg"
                  value={outreachMessage}
                  onChange={(e) => setOutreachMessage(e.target.value)}
                  rows={5}
                  maxLength={5000}
                  placeholder="Add any context that will help the counterparty understand why we're reaching out."
                />
                <p className="text-[11px] text-muted-foreground">
                  The trade details, your signature, and the Izenzo footer are added automatically.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOutreachDialog(null)} disabled={outreachSending}>
              Cancel
            </Button>
            <Button onClick={sendOutreach} disabled={outreachSending || outreachLoading || outreachSuppressed || !outreachSubject.trim()}>
              {outreachSending && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
              <Send className="h-3 w-3 mr-2" />
              Send email &amp; mark contacted
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Outreach log dialog ────────────────────────────────────────── */}
      <Dialog open={!!logDialog} onOpenChange={(o) => !o && setLogDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Outreach log</DialogTitle>
            <DialogDescription>
              Immutable history of every status change and contact attempt for this engagement.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-3">
            {logsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : logs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No outreach entries recorded yet.
              </p>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="border border-slate-200 rounded-sm p-3 text-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={
                          log.actor_type === "counterparty"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] uppercase tracking-wide"
                            : log.actor_type === "system"
                            ? "bg-violet-50 text-violet-700 border-violet-200 text-[10px] uppercase tracking-wide"
                            : "bg-sky-50 text-sky-700 border-sky-200 text-[10px] uppercase tracking-wide"
                        }
                      >
                        {ACTOR_TYPE_LABEL[log.actor_type] ?? log.actor_type}
                      </Badge>
                      <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 text-[10px] uppercase tracking-wide">
                        {ENTRY_TYPE_LABEL[log.entry_type] ?? log.entry_type}
                      </Badge>
                      {log.previous_status !== log.new_status && (
                        <Badge variant="outline" className={STATUS_STYLES[log.new_status] ?? ""}>
                          {log.previous_status} → {log.new_status}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    By <span className="font-medium text-slate-700">{log.admin_name ?? log.admin_email ?? "Unknown actor"}</span>
                    {log.contact_method && log.contact_detail && (
                      <>
                        {" · "}
                        {log.contact_method}: <span className="font-mono">{log.contact_detail}</span>
                      </>
                    )}
                  </p>
                  {log.notes && (
                    <p className="text-xs text-slate-700 mt-2 whitespace-pre-wrap">{log.notes}</p>
                  )}
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogDialog(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add-contact dialog (capture discovered email/phone for unregistered counterparties). */}
      <AddContactDialog
        open={!!addContactFor}
        onOpenChange={(open) => !open && setAddContactFor(null)}
        engagement={addContactFor}
        onSaved={() => fetchEngagements()}
      />
    </div>
  );
}
