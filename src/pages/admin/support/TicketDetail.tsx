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
  type SupportTicketDetail,
  type SupportMessage,
  type SupportAttachment,
  type SupportStatus,
  type SupportPriority,
} from "@/lib/support/client";
import { formatDistanceToNow, format } from "date-fns";

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
      const [ticket, m, n, a, tm] = await Promise.all([
        getTicketInternal(id, "admin ticket detail view"),
        listCustomerMessages(id),
        listInternalNotes(id),
        listAttachments(id),
        listTeams(),
      ]);
      setT(ticket);
      setMsgs(m);
      setNotes(n);
      setAtts(a);
      setTeams(tm);
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
