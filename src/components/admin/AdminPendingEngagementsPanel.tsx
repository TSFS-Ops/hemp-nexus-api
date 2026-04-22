/**
 * AdminPendingEngagementsPanel
 * ────────────────────────────
 * The dedicated admin queue for POI hold-point engagements.
 *
 * Surfaces every POI engagement awaiting outreach or response, with controls to:
 *   • Send the counterparty notification email (via notification-dispatch)
 *   • Mark as "contacted" (mandatory contact_method + contact_detail)
 *   • Mark as "declined" or "expired"
 *   • View the immutable outreach log per engagement
 *
 * Wired exclusively to the existing `poi-engagements` edge function - no new
 * backend logic. All state transitions are server-validated.
 */

import { useEffect, useMemo, useState } from "react";
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
  Inbox, Mail, CheckCircle2, XCircle, Clock, Send, RefreshCw, Loader2, History, AlertTriangle, Eye,
} from "lucide-react";
import { toast } from "sonner";

interface Engagement {
  id: string;
  match_id: string;
  org_id: string;
  counterparty_org_id: string | null;
  counterparty_email: string | null;
  counterparty_type: string | null;
  engagement_status: "pending" | "notification_sent" | "contacted" | "accepted" | "declined" | "expired";
  contact_method: string | null;
  contacted_at: string | null;
  responded_at: string | null;
  admin_notes: string | null;
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

const FILTER_TABS = [
  { value: "active", label: "Active queue" },
  { value: "pending", label: "Pending" },
  { value: "notification_sent", label: "Awaiting outreach" },
  { value: "contacted", label: "Contacted" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "all", label: "All" },
] as const;

export function AdminPendingEngagementsPanel() {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>("active");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

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
      const { data, error } = await supabase.functions.invoke("poi-engagements", {
        method: "GET",
      });
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
    fetchSlaSettings();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return engagements;
    if (filter === "active") {
      return engagements.filter((e) =>
        ["pending", "notification_sent", "contacted"].includes(e.engagement_status)
      );
    }
    return engagements.filter((e) => e.engagement_status === filter);
  }, [engagements, filter]);

  const stats = useMemo(() => ({
    total: engagements.length,
    pending: engagements.filter((e) => e.engagement_status === "pending").length,
    notified: engagements.filter((e) => e.engagement_status === "notification_sent").length,
    contacted: engagements.filter((e) => e.engagement_status === "contacted").length,
    accepted: engagements.filter((e) => e.engagement_status === "accepted").length,
  }), [engagements]);

  // ── Send notification via the existing notification-dispatch path ──
  const sendNotification = async (eng: Engagement) => {
    if (!eng.counterparty_email) {
      toast.error("No counterparty email on file. Add one before sending.");
      return;
    }
    setActionLoadingId(eng.id);
    try {
      const { error: dispatchErr } = await supabase.functions.invoke("notification-dispatch", {
        body: {
          template: "poi-counterparty-notify",
          recipient: eng.counterparty_email,
          match_id: eng.match_id,
          engagement_id: eng.id,
        },
      });
      if (dispatchErr) throw dispatchErr;

      // Update status to notification_sent
      const { error: updateErr } = await supabase.functions.invoke(
        `poi-engagements/${eng.id}`,
        {
          method: "PATCH",
          body: { engagement_status: "notification_sent" },
        }
      );
      if (updateErr) throw updateErr;

      toast.success(`Notification sent to ${eng.counterparty_email}`);
      fetchEngagements();
    } catch (err) {
      console.error("Send notification error:", err);
      toast.error("Failed to send notification");
    } finally {
      setActionLoadingId(null);
    }
  };

  // ── Open the "Mark as contacted" dialog ──
  const openContactDialog = (eng: Engagement) => {
    setContactDialog(eng);
    setContactMethod("email");
    setContactDetail(eng.counterparty_email ?? "");
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
      toast.error("Failed to mark as contacted");
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
        await supabase.functions.invoke(`poi-engagements/${eng.id}`, {
          method: "PATCH",
          body: { counterparty_email: contactDetail.trim() },
        });
      }

      const { data, error } = await supabase.functions.invoke(
        `poi-engagements/${eng.id}/preview-outreach`,
        { method: "POST", body: {} }
      );
      if (error) throw error;

      const td = data?.template_data ?? {};
      setOutreachRecipient(data?.recipient ?? "");
      setOutreachSuppressed(!!data?.suppressed);
      setOutreachSubject(data?.subject ?? "");
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
      toast.error(err?.message || "Could not load email preview");
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
          body: {
            subject: outreachSubject.trim(),
            custom_message: outreachMessage.trim() || undefined,
            counterparty_name: outreachCounterpartyName.trim() || undefined,
          },
        }
      );
      if (error) throw error;
      toast.success(`Email sent to ${data?.sent_to ?? outreachRecipient}`);
      setOutreachDialog(null);
      fetchEngagements();
    } catch (err: any) {
      console.error("Send outreach error:", err);
      toast.error(err?.message || "Failed to send outreach email");
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
            POI hold-point queue. Review counterparties awaiting outreach, send notifications,
            and record manual contact attempts. Every action is written to an immutable outreach log.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchEngagements} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total", value: stats.total, icon: Inbox },
          { label: "Pending", value: stats.pending, icon: Clock },
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
                      <TableRow key={e.id}>
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
                          {e.counterparty_email && (
                            <p className="text-xs text-muted-foreground">{e.counterparty_email}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`whitespace-nowrap text-[11px] font-medium px-2 py-0.5 ${STATUS_STYLES[e.engagement_status] ?? ""}`}
                          >
                            {STATUS_LABELS[e.engagement_status] ?? e.engagement_status.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(e.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end flex-wrap">
                            {e.engagement_status === "pending" && (
                              <Button
                                size="sm" variant="outline"
                                onClick={() => sendNotification(e)}
                                disabled={actionLoadingId === e.id || !e.counterparty_email}
                                title={!e.counterparty_email ? "No email on file" : "Send notification email"}
                              >
                                <Mail className="h-3 w-3 mr-1" /> Notify
                              </Button>
                            )}
                            {!isTerminal && (
                              <Button
                                size="sm" variant="outline"
                                onClick={() => openContactDialog(e)}
                                disabled={actionLoadingId === e.id}
                              >
                                <Send className="h-3 w-3 mr-1" /> Mark contacted
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
                              size="sm" variant="ghost"
                              onClick={() => openLog(e)}
                            >
                              <History className="h-3 w-3 mr-1" /> Log
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Mark as contacted dialog ───────────────────────────────────── */}
      <Dialog open={!!contactDialog} onOpenChange={(o) => !o && setContactDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log outreach to counterparty</DialogTitle>
            <DialogDescription>
              Record how you contacted the counterparty. This is logged for the audit trail only - the platform does not send anything on your behalf.
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
                  ? "Email is the only method where the platform can send the outreach for you. You'll preview and edit the message before it's sent."
                  : "This is a record of how you reached the counterparty. No message is sent - it's only logged in the immutable outreach trail."}
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
                <Label htmlFor="subj">Subject</Label>
                <Input
                  id="subj"
                  value={outreachSubject}
                  onChange={(e) => setOutreachSubject(e.target.value)}
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
    </div>
  );
}
