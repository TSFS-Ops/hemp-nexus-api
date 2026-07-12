/**
 * Institutional Funder Evidence Workspace — Batch 5
 * Admin-facing working-review panels on the release detail page.
 * Platform admins can:
 *   - assign an RFI to a colleague (by auth.users id string),
 *   - answer an RFI (message + status → answered),
 *   - see shared comments raised by the funder,
 *   - see decision history for auditing.
 *
 * Admins do NOT record funder decisions.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  answerRfi,
  assignRfi,
  listDecisionsForAdmin,
  listReleaseRfisForAdmin,
  listRfiMessagesForAdmin,
  listSharedCommentsForAdmin,
  type DecisionRow,
  type NoteRow,
  type RfiMessageRow,
  type RfiRow,
} from "@/lib/funder-workspace/workflow-client";

// ─── Admin RFI panel ────────────────────────────────────────
export function AdminRfiPanel({ releaseId }: { releaseId: string }) {
  const [rfis, setRfis] = useState<RfiRow[]>([]);
  const [open, setOpen] = useState<RfiRow | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRfis(await listReleaseRfisForAdmin(releaseId));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [releaseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Card data-testid="fw-admin-rfi-panel">
      <CardHeader>
        <CardTitle className="text-base">Funder requests for information</CardTitle>
      </CardHeader>
      <CardContent>
        {rfis.length === 0 ? (
          <p className="text-sm text-muted-foreground">No funder requests yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Raised</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rfis.map((r) => (
                <TableRow key={r.id} data-testid={`fw-admin-rfi-row-${r.id}`}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{r.status}</Badge>
                  </TableCell>
                  <TableCell className="capitalize">{r.priority}</TableCell>
                  <TableCell className="text-xs">
                    {new Date(r.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setOpen(r)}>
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {open && (
        <AdminRfiDialog
          rfi={open}
          onClose={() => setOpen(null)}
          onChanged={() => void refresh()}
        />
      )}
    </Card>
  );
}

function AdminRfiDialog({
  rfi,
  onClose,
  onChanged,
}: {
  rfi: RfiRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<RfiMessageRow[]>([]);
  const [answer, setAnswer] = useState("");
  const [assignee, setAssignee] = useState(rfi.assigned_to ?? "");
  const [busy, setBusy] = useState(false);
  const [pickerOptions, setPickerOptions] = useState<
    { user_id: string; display_name: string | null; email: string | null }[] | null
  >(null);
  const terminal = ["closed", "withdrawn"].includes(rfi.status);

  const refresh = useCallback(async () => {
    setMessages(await listRfiMessagesForAdmin(rfi.id));
  }, [rfi.id]);

  useEffect(() => {
    void refresh();
    // Try to load the safe admin picker; fall back to raw id input if RPC fails.
    import("@/lib/funder-workspace/admin-client")
      .then((m) => m.listAssignableAdminUsers())
      .then(setPickerOptions)
      .catch(() => setPickerOptions(null));
  }, [refresh]);


  const doAssign = async () => {
    setBusy(true);
    try {
      await assignRfi(rfi.id, assignee.trim() || null);
      toast.success("Assignee updated");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doAnswer = async () => {
    if (answer.trim() === "") return;
    setBusy(true);
    try {
      await answerRfi(rfi.id, answer.trim());
      setAnswer("");
      toast.success("Answer sent");
      await refresh();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl" data-testid="fw-admin-rfi-dialog">
        <DialogHeader>
          <DialogTitle>{rfi.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{rfi.status}</Badge>
            <Badge variant="secondary" className="capitalize">{rfi.priority}</Badge>
          </div>
          <p className="text-sm whitespace-pre-wrap">{rfi.description}</p>
          <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">No messages yet.</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="p-2 text-sm">
                  <div className="text-xs text-muted-foreground">
                    {m.author_side === "izenzo_admin"
                      ? "Izenzo Admin"
                      : m.author_side === "system"
                        ? "System"
                        : "Funder"}
                    {" · "}
                    {new Date(m.created_at).toLocaleString()}
                  </div>
                  <div className="whitespace-pre-wrap">{m.message_body}</div>
                </div>
              ))
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 items-end">
            <div className="col-span-2">
              <Label htmlFor="rfi-assignee">Assignee</Label>
              {pickerOptions && pickerOptions.length > 0 ? (
                <select
                  id="rfi-assignee"
                  data-testid="fw-admin-rfi-assignee-picker"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  className="w-full border rounded h-9 px-2 text-sm bg-background"
                >
                  <option value="">— Unassigned —</option>
                  {pickerOptions.map((u) => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.display_name || u.email || u.user_id}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id="rfi-assignee"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  placeholder="Auth user id (fallback — safe picker unavailable)"
                />
              )}
            </div>
            <Button
              onClick={doAssign}
              disabled={busy || terminal}
              data-testid="fw-admin-rfi-assign"
            >
              Update assignee
            </Button>

          </div>
          {!terminal && (
            <div className="space-y-2">
              <Label htmlFor="rfi-answer">Answer</Label>
              <Textarea
                id="rfi-answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={3}
                maxLength={4000}
              />
              <Button
                onClick={doAnswer}
                disabled={busy || answer.trim() === ""}
                data-testid="fw-admin-rfi-answer"
              >
                Send answer
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Admin shared comments (read-only) ──────────────────────
export function AdminSharedCommentsPanel({ releaseId }: { releaseId: string }) {
  const [items, setItems] = useState<NoteRow[]>([]);
  useEffect(() => {
    (async () => {
      try {
        setItems(await listSharedCommentsForAdmin(releaseId));
      } catch (e) {
        toast.error((e as Error).message);
      }
    })();
  }, [releaseId]);
  return (
    <Card data-testid="fw-admin-shared-comments">
      <CardHeader>
        <CardTitle className="text-base">Shared comments from funder</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No shared comments raised by the funder.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((n) => (
              <div key={n.id} className="border rounded-md p-2">
                <div className="text-xs text-muted-foreground">
                  {new Date(n.created_at).toLocaleString()}
                  {n.superseded_by && (
                    <Badge variant="secondary" className="ml-2">Superseded</Badge>
                  )}
                  {n.deleted_at && (
                    <Badge variant="destructive" className="ml-2">Deleted</Badge>
                  )}
                </div>
                <div
                  className={
                    "text-sm whitespace-pre-wrap" +
                    (n.deleted_at ? " opacity-50 line-through" : "")
                  }
                >
                  {n.body}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Admin decision history (read-only) ─────────────────────
export function AdminDecisionHistoryPanel({ releaseId }: { releaseId: string }) {
  const [items, setItems] = useState<DecisionRow[]>([]);
  useEffect(() => {
    (async () => {
      try {
        setItems(await listDecisionsForAdmin(releaseId));
      } catch (e) {
        toast.error((e as Error).message);
      }
    })();
  }, [releaseId]);
  const current = items.find((d) => d.is_current) ?? null;
  return (
    <Card data-testid="fw-admin-decision-history">
      <CardHeader>
        <CardTitle className="text-base">Funder decision history</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-sm">
          <span className="text-muted-foreground">Current:</span>{" "}
          {current ? (
            <>
              <Badge variant="secondary">{current.decision_status}</Badge>
              <span className="ml-2 text-xs text-muted-foreground">
                v{current.decision_version} ·{" "}
                {new Date(current.created_at).toLocaleString()}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">No decision recorded</span>
          )}
        </div>
        {items.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recorded</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>v{d.decision_version}</TableCell>
                  <TableCell>
                    <Badge variant={d.is_current ? "default" : "secondary"}>
                      {d.decision_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {new Date(d.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs whitespace-pre-wrap">
                    {d.reason ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground">
          Admins can view all decisions but never record decisions on behalf
          of a funder organisation.
        </p>
      </CardContent>
    </Card>
  );
}
