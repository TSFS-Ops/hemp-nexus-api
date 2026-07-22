/**
 * Institutional Funder Evidence Workspace — Batch 5
 * Funder-facing working-review panels rendered on the release detail
 * page. Server-side RPCs are authoritative for every mutation; UI role
 * checks are display-only.
 */
import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle } from "lucide-react";
import {
  addRfiMessage,
  canCreateNote,
  canCreateRfi,
  canRecordDecision,
    canSubmitRecommendation,
  closeRfi,
  createNote,
  createRfi,
  deleteNote,
  editNote,
  listDecisions,
  listNotes,
    listRecommendations,
  listReleaseRfis,
  listRfiMessages,
  recordDecision,
    submitRecommendation,
  requiresDecisionReason,
  withdrawRfi,
  type DecisionRow,
    type DecisionRecommendationRow,
  type DecisionStatus,
  type NoteRow,
  type RfiMessageRow,
  type RfiPriority,
    type RecommendationStatus,
  type RfiRow,
  type V1Role,
} from "@/lib/funder-workspace/workflow-client";
import { effectiveReleaseStatus } from "@/lib/funder-workspace/release-state";
import type { DealReleaseRow } from "@/lib/funder-workspace/types";

const RFI_STATUS_TONE: Record<string, "default" | "secondary" | "destructive"> = {
  open: "secondary",
  assigned: "secondary",
  in_progress: "default",
  answered: "default",
  closed: "secondary",
  withdrawn: "destructive",
};

const DECISION_STATUS_TONE: Record<string, "default" | "secondary" | "destructive"> = {
  not_started: "secondary",
  under_review: "secondary",
  info_requested: "secondary",
  conditional: "default",
  approved: "default",
  declined: "destructive",
  withdrawn: "destructive",
};

const RECOMMENDATION_STATUS_TONE: Record<string, "default" | "secondary" | "destructive"> = {
    conditional: "default",
    approved: "default",
    declined: "destructive",
};

function releaseIsWorkable(release: DealReleaseRow): boolean {
  const eff = effectiveReleaseStatus(release);
  return eff === "active";
}

// ─────────────────────────────────────────────────────────────
// RFI panel
// ─────────────────────────────────────────────────────────────
export function FunderRfiPanel({
  release,
  role,
  currentUserId,
}: {
  release: DealReleaseRow;
  role: V1Role | null;
  currentUserId: string | null;
}) {
  const [rfis, setRfis] = useState<RfiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [openRfiId, setOpenRfiId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRfis(await listReleaseRfis(release.id));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [release.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const workable = releaseIsWorkable(release);
  const mayCreate = canCreateRfi(role) && workable;

  return (
    <Card data-testid="fw-funder-rfi-panel">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Requests for information</CardTitle>
          <p className="text-xs text-muted-foreground">
            Ask Izenzo Admins for clarifications, additional evidence, or
            explanations relating to this release.
          </p>
        </div>
        {canCreateRfi(role) && (
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            disabled={!workable}
            title={workable ? undefined : "Release is not active"}
            data-testid="fw-funder-rfi-create"
          >
            Raise request
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!workable && (
          <Alert variant="destructive" className="mb-3">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Release is not active</AlertTitle>
            <AlertDescription>
              New requests cannot be raised. Existing history is shown for
              audit purposes.
            </AlertDescription>
          </Alert>
        )}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rfis.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No requests raised for this release yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Last update</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rfis.map((r) => (
                <TableRow key={r.id} data-testid={`fw-funder-rfi-row-${r.id}`}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell>
                    <Badge variant={RFI_STATUS_TONE[r.status] ?? "secondary"}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="capitalize">{r.priority}</TableCell>
                  <TableCell className="text-xs">
                    {r.due_date ? new Date(r.due_date).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {new Date(r.updated_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenRfiId(r.id)}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {creating && (
        <CreateRfiDialog
          releaseId={release.id}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void refresh();
          }}
        />
      )}

      {openRfiId && (
        <RfiDetailDialog
          rfiId={openRfiId}
          role={role}
          currentUserId={currentUserId}
          release={release}
          onClose={() => setOpenRfiId(null)}
          onChanged={() => void refresh()}
        />
      )}
    </Card>
  );
}

function CreateRfiDialog({
  releaseId,
  onClose,
  onCreated,
}: {
  releaseId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<RfiPriority>("normal");
  const [related, setRelated] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (title.trim() === "" || description.trim() === "") {
      toast.error("Title and description are required");
      return;
    }
    setBusy(true);
    try {
      await createRfi({
        release_id: releaseId,
        title: title.trim(),
        description: description.trim(),
        priority,
        related_evidence_item: related.trim() || null,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
      });
      toast.success("Request raised");
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent data-testid="fw-funder-rfi-dialog">
        <DialogHeader>
          <DialogTitle>Raise a request for information</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rfi-title">Title</Label>
          <Input
            id="rfi-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
          <Label htmlFor="rfi-desc">Description</Label>
          <Textarea
            id="rfi-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={4000}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rfi-priority">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as RfiPriority)}>
                <SelectTrigger id="rfi-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="rfi-due">Due date</Label>
              <Input
                id="rfi-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <Label htmlFor="rfi-related">Related evidence item (optional)</Label>
          <Input
            id="rfi-related"
            value={related}
            onChange={(e) => setRelated(e.target.value)}
            maxLength={200}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={busy} data-testid="fw-funder-rfi-submit">
            {busy ? "Submitting…" : "Submit request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RfiDetailDialog({
  rfiId,
  role,
  currentUserId,
  release,
  onClose,
  onChanged,
}: {
  rfiId: string;
  role: V1Role | null;
  currentUserId: string | null;
  release: DealReleaseRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<RfiMessageRow[]>([]);
  const [rfi, setRfi] = useState<RfiRow | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const workable = releaseIsWorkable(release);

  const refresh = useCallback(async () => {
    const rfis = await listReleaseRfis(release.id);
    const found = rfis.find((r) => r.id === rfiId) ?? null;
    setRfi(found);
    setMessages(await listRfiMessages(rfiId));
  }, [rfiId, release.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mayAct = canCreateRfi(role) && workable;
  const terminal = rfi ? ["closed", "withdrawn"].includes(rfi.status) : true;
  const mayWithdraw =
    !terminal &&
    (role === "admin" || (currentUserId && rfi?.created_by === currentUserId));

  const send = async () => {
    if (reply.trim() === "") return;
    setBusy(true);
    try {
      await addRfiMessage(rfiId, reply.trim());
      setReply("");
      await refresh();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doClose = async () => {
    setBusy(true);
    try {
      await closeRfi(rfiId, null);
      toast.success("Request closed");
      await refresh();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doWithdraw = async () => {
    setBusy(true);
    try {
      await withdrawRfi(rfiId, null);
      toast.success("Request withdrawn");
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rfi?.title ?? "Request"}</DialogTitle>
        </DialogHeader>
        {rfi && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant={RFI_STATUS_TONE[rfi.status] ?? "secondary"}>{rfi.status}</Badge>
              <Badge variant="secondary" className="capitalize">{rfi.priority}</Badge>
              {rfi.due_date && (
                <span className="text-xs text-muted-foreground">
                  Due {new Date(rfi.due_date).toLocaleDateString()}
                </span>
              )}
            </div>
            <p className="text-sm whitespace-pre-wrap">{rfi.description}</p>
            <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">
                  No messages yet.
                </div>
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
onClick={doClose}              )}
            </div>
            {mayAct && !terminal && (
              <div className="space-y-2">
                <Label htmlFor="rfi-reply">Reply</Label>
                <Textarea
                  id="rfi-reply"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={3}
                  maxLength={4000}
                />
                <div className="flex gap-2">
                  <Button
                    onClick={send}
                    disabled={busy || reply.trim() === ""}
                    data-testid="fw-funder-rfi-reply"
                  >
                    Send reply
                  </Button>
                  {mayAct && rfi?.status === "answered" && (
                    <Button variant="secondary" onClick={doClose} disabled={busy}>
                      Close request
                    </Button>
                  )}
                  {mayWithdraw && (
                    <Button variant="destructive" onClick={doWithdraw} disabled={busy}>
                      Withdraw
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Notes panel
// ─────────────────────────────────────────────────────────────
export function FunderNotesPanel({
  release,
  role,
  currentUserId,
}: {
  release: DealReleaseRow;
  role: V1Role | null;
  currentUserId: string | null;
}) {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [creating, setCreating] = useState<null | "internal_note" | "shared_comment">(null);
  const [editing, setEditing] = useState<NoteRow | null>(null);

  const refresh = useCallback(async () => {
    try {
      setNotes(await listNotes(release.id));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [release.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const workable = releaseIsWorkable(release);
  const mayCreate = canCreateNote(role) && workable;

  const internal = notes.filter((n) => n.note_type === "internal_note");
  const shared = notes.filter((n) => n.note_type === "shared_comment");

  return (
    <Card data-testid="fw-funder-notes-panel">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Notes and comments</CardTitle>
          <p className="text-xs text-muted-foreground">
            Internal notes are visible only inside your organisation.
            Shared comments are also visible to Izenzo Admins.
          </p>
        </div>
        <div className="flex gap-2">
          {mayCreate && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCreating("internal_note")}
                data-testid="fw-funder-note-create-internal"
              >
                New internal note
              </Button>
              <Button
                size="sm"
                onClick={() => setCreating("shared_comment")}
                data-testid="fw-funder-note-create-shared"
              >
                New shared comment
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <NotesSection
          title="Internal notes (funder-only)"
          notes={internal}
          role={role}
          currentUserId={currentUserId}
          onEdit={setEditing}
          onDelete={async (n) => {
            try {
              await deleteNote(n.id, null);
              await refresh();
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        />
        <NotesSection
          title="Shared comments (visible to Izenzo Admins)"
          notes={shared}
          role={role}
          currentUserId={currentUserId}
          onEdit={setEditing}
          onDelete={async (n) => {
            try {
              await deleteNote(n.id, null);
              await refresh();
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        />
      </CardContent>

      {creating && (
        <CreateNoteDialog
          releaseId={release.id}
          noteType={creating}
          onClose={() => setCreating(null)}
          onCreated={() => {
            setCreating(null);
            void refresh();
          }}
        />
      )}
      {editing && (
        <EditNoteDialog
          note={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
    </Card>
  );
}

function NotesSection({
  title,
  notes,
  role,
  currentUserId,
  onEdit,
  onDelete,
}: {
  title: string;
  notes: NoteRow[];
  role: V1Role | null;
  currentUserId: string | null;
  onEdit: (n: NoteRow) => void;
  onDelete: (n: NoteRow) => void;
}) {
  return (
    <div>
      <div className="text-sm font-medium mb-2">{title}</div>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => {
            const canEdit =
              !n.deleted_at &&
              !n.superseded_by &&
              (role === "admin" ||
                role === "approver" ||
                role === "reviewer") &&
              currentUserId != null &&
              n.author_user_id === currentUserId;
            const canDelete =
              !n.deleted_at &&
              currentUserId != null &&
              (n.author_user_id === currentUserId || role === "admin");
            return (
              <div
                key={n.id}
                className="border rounded-md p-2"
                data-testid={`fw-funder-note-${n.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">
                    {new Date(n.created_at).toLocaleString()}
                    {n.superseded_by && (
                      <Badge variant="secondary" className="ml-2">Superseded</Badge>
                    )}
                    {n.supersedes_note_id && (
                      <Badge variant="secondary" className="ml-2">Revised</Badge>
                    )}
                    {n.deleted_at && (
                      <Badge variant="destructive" className="ml-2">Deleted</Badge>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {canEdit && (
                      <Button variant="ghost" size="sm" onClick={() => onEdit(n)}>
                        Edit
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="ghost" size="sm" onClick={() => onDelete(n)}>
                        Delete
                      </Button>
                    )}
                  </div>
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
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreateNoteDialog({
  releaseId,
  noteType,
  onClose,
  onCreated,
}: {
  releaseId: string;
  noteType: "internal_note" | "shared_comment";
  onClose: () => void;
  onCreated: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (body.trim() === "") return;
    setBusy(true);
    try {
      await createNote({ release_id: releaseId, note_type: noteType, body: body.trim() });
      toast.success("Saved");
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {noteType === "internal_note" ? "New internal note" : "New shared comment"}
          </DialogTitle>
        </DialogHeader>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          maxLength={5000}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={busy || body.trim() === ""}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditNoteDialog({
  note,
  onClose,
  onSaved,
}: {
  note: NoteRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [body, setBody] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const inWindow = useMemo(
    () => new Date(note.editable_until).getTime() > Date.now(),
    [note.editable_until],
  );
  const submit = async () => {
    if (body.trim() === "") return;
    setBusy(true);
    try {
      await editNote(note.id, body.trim());
      toast.success(
        inWindow
          ? "Updated"
          : "New version created — the original remains visible.",
      );
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit note</DialogTitle>
        </DialogHeader>
        {!inWindow && (
          <Alert>
            <AlertTitle>Edit window has closed</AlertTitle>
            <AlertDescription>
              Saving will create a new version. The original remains visible
              and marked superseded.
            </AlertDescription>
          </Alert>
        )}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          maxLength={5000}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={busy || body.trim() === ""}>
            {busy ? "Saving…" : inWindow ? "Save" : "Save as new version"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Decision panel
// ─────────────────────────────────────────────────────────────
export function FunderDecisionPanel({
  release,
  role,
}: {
  release: DealReleaseRow;
  role: V1Role | null;
}) {
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [recording, setRecording] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setDecisions(await listDecisions(release.id));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [release.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const workable = releaseIsWorkable(release);
  const mayRecord = canRecordDecision(role) && workable;
  const current = decisions.find((d) => d.is_current) ?? null;
  const history = decisions.filter((d) => !d.is_current);

  return (
    <Card data-testid="fw-funder-decision-panel">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Decision</CardTitle>
          <p className="text-xs text-muted-foreground">
            Formal funder decision. Only Approvers may record or change a
            decision. Prior decisions remain visible for audit.
          </p>
        </div>
        {canRecordDecision(role) && (
          <Button
            size="sm"
            disabled={!workable}
            onClick={() => setRecording(true)}
            data-testid="fw-funder-decision-record"
          >
            {current ? "Record new version" : "Record decision"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm">
          <span className="text-muted-foreground">Current status:</span>{" "}
          {current ? (
            <>
              <Badge
                variant={DECISION_STATUS_TONE[current.decision_status] ?? "secondary"}
              >
                {current.decision_status}
              </Badge>
              <span className="ml-2 text-xs text-muted-foreground">
                v{current.decision_version} ·{" "}
                {new Date(current.created_at).toLocaleString()}
              </span>
              {current.reason && (
                <div className="mt-1 whitespace-pre-wrap">{current.reason}</div>
              )}
              {current.conditions && (
                <div className="mt-1">
                  <span className="text-xs text-muted-foreground">Conditions: </span>
                  <span className="whitespace-pre-wrap">{current.conditions}</span>
                </div>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">No decision recorded</span>
          )}
        </div>
        {history.length > 0 && (
          <div>
            <div className="text-sm font-medium mb-1">History</div>
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
                {history.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>v{d.decision_version}</TableCell>
                    <TableCell>
                      <Badge variant={DECISION_STATUS_TONE[d.decision_status] ?? "secondary"}>
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
          </div>
        )}
      </CardContent>

      {createElement(FunderRecommendationsPanel, { release, role })}

      {recording && (
        <RecordDecisionDialog
          releaseId={release.id}
                      hasCurrentDecision={current !== null}
          onClose={() => setRecording(false)}
          onSaved={() => {
            setRecording(false);
            void refresh();
          }}
        />
      )}
    </Card>
  );
}

function RecordDecisionDialog({
  releaseId,
  onClose,
  onSaved,
    hasCurrentDecision,
}: {
  releaseId: string;
  onClose: () => void;
  onSaved: () => void;
    hasCurrentDecision: boolean;
}) {
  const [status, setStatus] = useState<DecisionStatus>("under_review");
  const [reason, setReason] = useState("");
  const [conditions, setConditions] = useState("");
  const [busy, setBusy] = useState(false);
    const [supersessionReason, setSupersessionReason] = useState("");
    const [openRfiCount, setOpenRfiCount] = useState(0);

    useEffect(() => {
          let cancelled = false;
          void listReleaseRfis(releaseId).then((rows) => {
                  if (cancelled) return;
                  const openCount = rows.filter((r) => !("closed" === r.status || "withdrawn" === r.status)).length;
                  setOpenRfiCount(openCount);
          });
          return () => {
                  cancelled = true;
          };
    }, [releaseId]);

  const needsReason = requiresDecisionReason(status);

  const submit = async () => {
    if (needsReason && reason.trim() === "") {
      toast.error("A written reason is required for this decision.");
      return;
    }
        if (hasCurrentDecision && supersessionReason.trim() === "") {
                toast.error("A supersession reason is required when replacing an existing decision.");
                return;
        }
    setBusy(true);
    try {
      await recordDecision({
        release_id: releaseId,
        decision_status: status,
        reason: reason.trim() || null,
        conditions: conditions.trim() || null,
                supersession_reason: hasCurrentDecision ? supersessionReason.trim() || null : null,
      });
      toast.success("Decision recorded");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record decision</DialogTitle>
        </DialogHeader>
        {openRfiCount > 0 &&
                    createElement(
                                  Alert,
                      { className: "mb-2" },
                                  createElement(AlertTriangle, { className: "h-4 w-4" }),
                                  createElement(AlertTitle, null, "Unresolved requests for information"),
                                  createElement(
                                                  AlertDescription,
                                                  null,
                                                  `${openRfiCount} request${openRfiCount === 1 ? "" : "s"} for information ${openRfiCount === 1 ? "is" : "are"} still open for this release.`,
                                                ),
                                )}
        <div className="space-y-2">
          <Label htmlFor="decision-status">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as DecisionStatus)}>
            <SelectTrigger id="decision-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="not_started">Not started</SelectItem>
              <SelectItem value="under_review">Under review</SelectItem>
              <SelectItem value="info_requested">Info requested</SelectItem>
              <SelectItem value="conditional">Conditional</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="declined">Declined</SelectItem>
              <SelectItem value="withdrawn">Withdrawn</SelectItem>
            </SelectContent>
          </Select>
          <Label htmlFor="decision-reason">
            Reason{needsReason ? " (required)" : " (optional)"}
          </Label>
          <Textarea
            id="decision-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            maxLength={5000}
          />
          {status === "conditional" && (
            <>
              <Label htmlFor="decision-conditions">Conditions</Label>
              <Textarea
                id="decision-conditions"
                value={conditions}
                onChange={(e) => setConditions(e.target.value)}
                rows={3}
                maxLength={5000}
              />
            </>
          )}
          {hasCurrentDecision &&
                      createElement(
                                    "div",
                                    null,
                                    createElement(Label, { htmlFor: "decision-supersession-reason" }, "Reason for superseding prior decision (required)"),
                                    createElement(Textarea, {
                                                    id: "decision-supersession-reason",
                                                    value: supersessionReason,
                                                    onChange: (e: any) => setSupersessionReason(e.target.value),
                                                    rows: 3,
                                                    maxLength: 5000,
                                    }),
                                  )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            onClick={submit}
            disabled={busy || (needsReason && reason.trim() === "")}
            data-testid="fw-funder-decision-submit"
          >
            {busy ? "Recording…" : "Record decision"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Recommendations panel (Batch 10) — non-binding Reviewer/Approver
// recommendations. Never gates or blocks the formal Approver decision
// recorded above; purely advisory and always visible for context.
// ─────────────────────────────────────────────────────────────
function FunderRecommendationsPanel({
    release,
    role,
}: {
    release: DealReleaseRow;
    role: V1Role | null;
}) {
    const [recs, setRecs] = useState<DecisionRecommendationRow[]>([]);
    const [submitting, setSubmitting] = useState(false);

    const refresh = useCallback(async () => {
          try {
                  setRecs(await listRecommendations(release.id));
          } catch (e) {
                  toast.error((e as Error).message);
          }
    }, [release.id]);

    useEffect(() => {
          void refresh();
    }, [refresh]);

    const workable = releaseIsWorkable(release);
    const mayRecommend = canSubmitRecommendation(role) && workable;

    return createElement(
          "div",
      { className: "space-y-3 mt-4", "data-testid": "fw-funder-recommendations-panel" },
          createElement(
                  "div",
            { className: "flex items-center justify-between" },
                  createElement(
                            "div",
                    { className: "text-sm font-medium" },
                            "Reviewer / Approver recommendations (non-binding)",
                          ),
                  mayRecommend
                    ? createElement(
                                  Button,
                      {
                                      size: "sm",
                                      variant: "secondary",
                                      onClick: () => setSubmitting(true),
                                      "data-testid": "fw-funder-recommendation-open",
                      } as any,
                                  "Submit recommendation",
                                )
                    : null,
                ),
          recs.length === 0
            ? createElement(
                        "p",
              { className: "text-sm text-muted-foreground" },
                        "No recommendations submitted yet.",
                      )
            : createElement(
                        "div",
              { className: "space-y-2" },
                        recs.map((r) =>
                                      createElement(
                                                      "div",
                                        {
                                                          key: r.id,
                                                          className: "border rounded-md p-2",
                                                          "data-testid": `fw-funder-recommendation-${r.id}`,
                                        },
                                                      createElement(
                                                                        "div",
                                                        { className: "flex items-center gap-2" },
                                                                        createElement(
                                                                                            Badge,
                                                                          { variant: RECOMMENDATION_STATUS_TONE[r.recommended_status] ?? "secondary" },
                                                                                            r.recommended_status,
                                                                                          ),
                                                                        createElement(
                                                                                            "span",
                                                                          { className: "text-xs text-muted-foreground capitalize" },
                                                                                            r.recommended_by_role,
                                                                                          ),
                                                                        createElement(
                                                                                            "span",
                                                                          { className: "text-xs text-muted-foreground" },
                                                                                            new Date(r.created_at).toLocaleString(),
                                                                                          ),
                                                                      ),
                                                      createElement(
                                                                        "div",
                                                        { className: "text-sm whitespace-pre-wrap mt-1" },
                                                                        r.reason,
                                                                      ),
                                                      r.conditions
                                                        ? createElement(
                                                                              "div",
                                                          { className: "text-xs mt-1" },
                                                                              "Conditions: ",
                                                                              r.conditions,
                                                                            )
                                                        : null,
                                                    ),
                                           ),
                      ),
          submitting
            ? createElement(SubmitRecommendationDialog, {
                        releaseId: release.id,
                        onClose: () => setSubmitting(false),
                        onSubmitted: () => {
                                      setSubmitting(false);
                                      void refresh();
                        },
            })
            : null,
        );
}

function SubmitRecommendationDialog({
    releaseId,
    onClose,
    onSubmitted,
}: {
    releaseId: string;
    onClose: () => void;
    onSubmitted: () => void;
}) {
    const [status, setStatus] = useState<RecommendationStatus>("approved");
    const [reason, setReason] = useState("");
    const [conditions, setConditions] = useState("");
    const [busy, setBusy] = useState(false);

    const submit = async () => {
          if (reason.trim() === "") {
                  toast.error("A written reason is required.");
                  return;
          }
          if (status === "conditional" && conditions.trim() === "") {
                  toast.error("Conditions are required for a conditional recommendation.");
                  return;
          }
          setBusy(true);
          try {
                  await submitRecommendation({
                            release_id: releaseId,
                            recommended_status: status,
                            reason: reason.trim(),
                            conditions: conditions.trim() || null,
                  });
                  toast.success("Recommendation submitted");
                  onSubmitted();
          } catch (e) {
                  toast.error((e as Error).message);
          } finally {
                  setBusy(false);
          }
    };

    return createElement(
          Dialog,
      { open: true, onOpenChange: onClose },
          createElement(
                  DialogContent,
            { "data-testid": "fw-funder-recommendation-dialog" } as any,
                  createElement(
                            DialogHeader,
                            null,
                            createElement(DialogTitle, null, "Submit recommendation"),
                          ),
                  createElement(
                            "div",
                    { className: "space-y-2" },
                            createElement(Label, { htmlFor: "rec-status" }, "Recommended status"),
                            createElement(
                                        Select,
                              { value: status, onValueChange: (v: string) => setStatus(v as RecommendationStatus) },
                                        createElement(
                                                      SelectTrigger,
                                          { id: "rec-status" },
                                                      createElement(SelectValue, null),
                                                    ),
                                        createElement(
                                                      SelectContent,
                                                      null,
                                                      createElement(SelectItem, { value: "conditional" }, "Conditional"),
                                                      createElement(SelectItem, { value: "approved" }, "Approved"),
                                                      createElement(SelectItem, { value: "declined" }, "Declined"),
                                                    ),
                                      ),
                            createElement(Label, { htmlFor: "rec-reason" }, "Reason (required)"),
                            createElement(Textarea, {
                                        id: "rec-reason",
                                        value: reason,
                                        onChange: (e: any) => setReason(e.target.value),
                                        rows: 4,
                                        maxLength: 5000,
                            }),
                            status === "conditional"
                              ? createElement(
                                              "div",
                                              null,
                                              createElement(Label, { htmlFor: "rec-conditions" }, "Conditions (required)"),
                                              createElement(Textarea, {
                                                                id: "rec-conditions",
                                                                value: conditions,
                                                                onChange: (e: any) => setConditions(e.target.value),
                                                                rows: 3,
                                                                maxLength: 5000,
                                              }),
                                            )
                              : null,
                          ),
                  createElement(
                            DialogFooter,
                            null,
                            createElement(
                                        DialogClose,
                              { asChild: true },
                                        createElement(Button, { variant: "ghost" }, "Cancel"),
                                      ),
                            createElement(
                                        Button,
                              { onClick: submit, disabled: busy, "data-testid": "fw-funder-recommendation-submit" } as any,
                                        busy ? "Submitting…" : "Submit",
                                      ),
                          ),
                ),
        );
}
