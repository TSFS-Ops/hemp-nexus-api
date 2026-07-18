/**
 * Admin ticket detail — full triage cockpit.
 * - Customer + internal thread
 * - Reply to customer / add internal note
 * - Status transitions with reason
 * - Assign to team / individual + escalate priority
 * - Attachments (respects is_internal_only)
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import { BackButton } from "@/components/BackButton";
import { useToast } from "@/hooks/use-toast";
import {
  getTicketInternal,
  listCustomerMessages,
  listInternalNotes,
  postCustomerMessage,
  postInternalNote,
  updateStatus,
  assignTicket,
  escalateTicket,
  listTeams,
  listAttachments,
  attachmentDownloadUrl,
  listTicketEvents,
  type SupportTicketDetail,
  type SupportMessage,
  type SupportAttachment,
  type SupportStatus,
  type SupportPriority,
  type SupportTicketEvent,
} from "@/lib/support/client";
import { formatDistanceToNow, format } from "date-fns";
import { AlertTriangle, ArrowUpRight, Clock } from "lucide-react";

const STATUSES: SupportStatus[] = [
  "new",
  "in_progress",
  "waiting_for_customer",
  "confirmation_requested",
  "resolved",
  "closed",
  "reopened",
  "cancelled",
];
const PRIORITIES: SupportPriority[] = ["urgent", "high", "medium", "low"];

export default function AdminTicketDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { toast } = useToast();
  const [t, setT] = useState<SupportTicketDetail | null>(null);
  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [notes, setNotes] = useState<SupportMessage[]>([]);
  const [atts, setAtts] = useState<SupportAttachment[]>([]);
  const [teams, setTeams] = useState<Array<{ key: string; label: string }>>([]);
  const [events, setEvents] = useState<SupportTicketEvent[]>([]);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [assigneeInput, setAssigneeInput] = useState("");
  const [teamSel, setTeamSel] = useState<string>("");
  const [statusSel, setStatusSel] = useState<SupportStatus>("in_progress");
  const [statusReason, setStatusReason] = useState("");
  const [prioritySel, setPrioritySel] = useState<SupportPriority>("medium");
  const [escalateReason, setEscalateReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ticket, m, n, a, tm, ev] = await Promise.all([
        getTicketInternal(id, "admin ticket detail view"),
        listCustomerMessages(id),
        listInternalNotes(id),
        listAttachments(id),
        listTeams(),
        listTicketEvents(id).catch(() => [] as SupportTicketEvent[]),
      ]);
      setT(ticket);
      setMsgs(m);
      setNotes(n);
      setAtts(a);
      setTeams(tm);
      setEvents(ev);
      setStatusSel(ticket.status);
      setPrioritySel(ticket.priority);
      setTeamSel(ticket.current_team_key ?? "");
    } catch (e) {
      toast({
        title: "Failed to load ticket",
        description: (e as Error).message,
        variant: "destructive",
      });
      nav("/admin/support");
    }
  }, [id, nav, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function guarded(fn: () => Promise<void>, okTitle: string) {
    setBusy(true);
    try {
      await fn();
      toast({ title: okTitle });
      await load();
    } catch (e) {
      toast({
        title: "Action failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!t) return <FullPageLoader />;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <BackButton />

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-muted-foreground">
                {t.ticket_number}
              </span>
              <Badge>{t.status.replace(/_/g, " ")}</Badge>
              <Badge variant="outline">{t.priority}</Badge>
              {t.current_team_key && (
                <Badge variant="secondary">team: {t.current_team_key}</Badge>
              )}
              {t.current_assignee_user_id && (
                <Badge variant="secondary">assignee set</Badge>
              )}
            </div>
            <CardTitle className="text-xl mt-1">{t.subject}</CardTitle>
            <CardDescription>
              Opened{" "}
              {format(new Date(t.created_at), "PPpp")} ·{" "}
              {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
              {t.first_response_at
                ? ` · first response ${formatDistanceToNow(new Date(t.first_response_at), { addSuffix: true })}`
                : t.sla_first_response_due_at
                  ? ` · FR due ${formatDistanceToNow(new Date(t.sla_first_response_due_at), { addSuffix: true })}`
                  : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {t.intended_action && (
              <div>
                <div className="font-medium">Intended</div>
                <p className="text-muted-foreground whitespace-pre-wrap">
                  {t.intended_action}
                </p>
              </div>
            )}
            {t.actual_result && (
              <div>
                <div className="font-medium">Actual</div>
                <p className="text-muted-foreground whitespace-pre-wrap">
                  {t.actual_result}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Tabs defaultValue="customer">
              <TabsList>
                <TabsTrigger value="customer">
                  Customer thread ({msgs.length})
                </TabsTrigger>
                <TabsTrigger value="notes">
                  Internal notes ({notes.length})
                </TabsTrigger>
                <TabsTrigger value="attachments">
                  Attachments ({atts.length})
                </TabsTrigger>
                <TabsTrigger value="timeline">
                  Timeline ({events.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="customer" className="space-y-3">
                {msgs.map((m) => (
                  <MessageBubble key={m.id} m={m} />
                ))}
                <div className="border-t pt-3 space-y-2">
                  <Textarea
                    rows={3}
                    placeholder="Reply visible to the customer…"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <Button
                      disabled={busy || !reply.trim()}
                      onClick={() =>
                        guarded(async () => {
                          await postCustomerMessage(id, reply.trim());
                          setReply("");
                        }, "Reply sent")
                      }
                    >
                      Send reply
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="notes" className="space-y-3">
                {notes.map((m) => (
                  <MessageBubble key={m.id} m={m} internal />
                ))}
                <div className="border-t pt-3 space-y-2">
                  <Textarea
                    rows={3}
                    placeholder="Internal note (never visible to the customer)…"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <Button
                      variant="secondary"
                      disabled={busy || !note.trim()}
                      onClick={() =>
                        guarded(async () => {
                          await postInternalNote(id, note.trim());
                          setNote("");
                        }, "Note added")
                      }
                    >
                      Add internal note
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="attachments" className="space-y-2">
                {atts.length === 0 && (
                  <div className="text-sm text-muted-foreground">
                    No attachments on this ticket.
                  </div>
                )}
                {atts.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between border rounded-md p-2 text-sm"
                  >
                    <div>
                      <div className="font-medium">{a.filename}</div>
                      <div className="text-xs text-muted-foreground">
                        {(a.size_bytes / 1024).toFixed(1)} KB · {a.scan_status}
                        {a.is_internal_only ? " · internal-only" : ""}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          const u = await attachmentDownloadUrl(a.storage_path);
                          window.open(u, "_blank", "noopener,noreferrer");
                        } catch (e) {
                          toast({
                            title: "Download failed",
                            description: (e as Error).message,
                            variant: "destructive",
                          });
                        }
                      }}
                      disabled={a.scan_status === "infected"}
                    >
                      Download
                    </Button>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="timeline" className="space-y-2">
                <TimelineList events={events} ticket={t} />
              </TabsContent>
            </Tabs>
          </div>


          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Select
                  value={statusSel}
                  onValueChange={(v) => setStatusSel(v as SupportStatus)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Reason (audited)"
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                />
                <Button
                  className="w-full"
                  disabled={busy || !statusReason.trim()}
                  onClick={() =>
                    guarded(
                      () => updateStatus(id, statusSel, statusReason.trim()),
                      "Status updated"
                    )
                  }
                >
                  Update status
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Assign</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Select value={teamSel} onValueChange={setTeamSel}>
                  <SelectTrigger>
                    <SelectValue placeholder="Team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((t) => (
                      <SelectItem key={t.key} value={t.key}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Assignee user id (uuid, optional)"
                  value={assigneeInput}
                  onChange={(e) => setAssigneeInput(e.target.value)}
                />
                <Button
                  className="w-full"
                  disabled={busy || !teamSel}
                  onClick={() =>
                    guarded(async () => {
                      await assignTicket(
                        id,
                        assigneeInput.trim() || null,
                        teamSel || null,
                        "Manual assignment"
                      );
                      setAssigneeInput("");
                    }, "Assignment updated")
                  }
                >
                  Save assignment
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Escalate priority</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Select
                  value={prioritySel}
                  onValueChange={(v) => setPrioritySel(v as SupportPriority)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Reason (audited)"
                  value={escalateReason}
                  onChange={(e) => setEscalateReason(e.target.value)}
                />
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={busy || !escalateReason.trim()}
                  onClick={() =>
                    guarded(
                      () =>
                        escalateTicket(id, prioritySel, escalateReason.trim()),
                      "Priority updated"
                    )
                  }
                >
                  Apply
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  m,
  internal,
}: {
  m: SupportMessage;
  internal?: boolean;
}) {
  return (
    <div
      className={
        "rounded-md border p-3 space-y-1 " +
        (internal ? "bg-amber-50 border-amber-200" : "bg-muted/30")
      }
    >
      <div className="text-xs text-muted-foreground">
        {format(new Date(m.created_at), "PPpp")}
      </div>
      <div className="text-sm whitespace-pre-wrap">{m.body}</div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Timeline / audit trail
// -----------------------------------------------------------------------------

const EVENT_LABEL: Record<string, string> = {
  created: "Ticket created",
  status_changed: "Status changed",
  priority_changed: "Priority changed",
  assigned: "Assignment changed",
  customer_message_posted: "Customer message posted",
  internal_note_posted: "Internal note added",
  attachment_added: "Attachment added",
  auto_escalated: "Auto-escalated (SLA breach)",
};

function fmtGate(g: unknown): string {
  if (g === "first_response") return "first-response deadline";
  if (g === "resolution") return "resolution deadline";
  return String(g ?? "");
}

function TimelineList({
  events,
  ticket,
}: {
  events: SupportTicketEvent[];
  ticket: SupportTicketDetail;
}) {
  if (events.length === 0) {
    return (
      <div className="text-sm text-muted-foreground border rounded-md p-3">
        No timeline entries recorded for this ticket yet.
      </div>
    );
  }
  return (
    <ol className="relative border-l border-border ml-2 space-y-3">
      {events.map((e) => {
        const isEsc = e.event_kind === "auto_escalated";
        const gate = isEsc ? fmtGate(e.payload.gate) : null;
        const from = isEsc ? String(e.payload.from_priority ?? "") : "";
        const to = isEsc ? String(e.payload.to_priority ?? "") : "";
        const dueAt =
          isEsc && typeof e.payload.sla_due_at === "string"
            ? new Date(e.payload.sla_due_at)
            : isEsc && e.payload.gate === "first_response" && ticket.sla_first_response_due_at
              ? new Date(ticket.sla_first_response_due_at)
              : isEsc && e.payload.gate === "resolution" && (ticket as any).sla_resolution_due_at
                ? new Date((ticket as any).sla_resolution_due_at)
                : null;
        const at = new Date(e.created_at);
        const overdueBy = dueAt
          ? Math.max(0, Math.round((at.getTime() - dueAt.getTime()) / 60000))
          : null;
        return (
          <li key={e.id} className="ml-4">
            <span
              className={
                "absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-background " +
                (isEsc ? "bg-amber-500" : "bg-muted-foreground")
              }
            />
            <div
              className={
                "rounded-md border p-3 text-sm " +
                (isEsc ? "bg-amber-50 border-amber-200" : "bg-muted/20")
              }
            >
              <div className="flex items-center gap-2 flex-wrap">
                {isEsc ? (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                ) : (
                  <Clock className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="font-medium">
                  {EVENT_LABEL[e.event_kind] ?? e.event_kind.replace(/_/g, " ")}
                </span>
                {isEsc && (
                  <Badge variant="outline" className="ml-1">
                    {gate}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {format(at, "PPpp")} · {formatDistanceToNow(at, { addSuffix: true })}
                </span>
              </div>
              {isEsc && (
                <div className="mt-2 text-xs text-muted-foreground space-y-1">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span>Priority</span>
                    <Badge variant="secondary">{from}</Badge>
                    <ArrowUpRight className="h-3 w-3" />
                    <Badge>{to}</Badge>
                  </div>
                  {dueAt ? (
                    <div>
                      Triggered by the <strong>{gate}</strong> ({format(dueAt, "PPpp")}),
                      breached by{" "}
                      <span className="font-mono">
                        {overdueBy != null ? `${overdueBy} min` : "—"}
                      </span>{" "}
                      before this run.
                    </div>
                  ) : (
                    <div>Triggered by the {gate}.</div>
                  )}
                </div>
              )}
              {!isEsc && Object.keys(e.payload ?? {}).length > 0 && (
                <pre className="mt-2 text-[11px] font-mono whitespace-pre-wrap text-muted-foreground">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

