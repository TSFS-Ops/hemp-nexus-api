/**
 * Admin — Incidents & status-page management.
 * List, create, edit, resolve incidents and post public/internal updates.
 * Direct-table CRUD gated by RLS (platform_admin).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import { useToast } from "@/hooks/use-toast";
import {
  adminCreateIncident,
  adminDeleteIncident,
  adminListIncidentUpdates,
  adminListIncidents,
  adminPostIncidentUpdate,
  adminUpdateIncident,
  type AdminIncidentRow,
  type AdminIncidentUpdate,
  type SupportIncident,
} from "@/lib/support/client";
import { formatDistanceToNow } from "date-fns";

const STATUSES: SupportIncident["status"][] = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
  "scheduled",
  "in_progress",
  "completed",
];
const SEVERITIES: SupportIncident["severity"][] = [
  "minor",
  "major",
  "critical",
  "maintenance",
];

export default function AdminSupportIncidents() {
  const { toast } = useToast();
  const [rows, setRows] = useState<AdminIncidentRow[] | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [selected, setSelected] = useState<AdminIncidentRow | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await adminListIncidents());
    } catch (e) {
      toast({
        title: "Load failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <Link
              to="/admin/support"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Support queue
            </Link>
            <h1 className="text-2xl font-semibold mt-1">Incidents</h1>
            <p className="text-sm text-muted-foreground">
              Author and manage the public status page. Updates roll the
              incident status forward automatically.
            </p>
          </div>
          <Button onClick={() => setOpenNew(true)}>Declare incident</Button>
        </div>

        {!rows ? (
          <FullPageLoader />
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No incidents on record.
            </CardContent>
          </Card>
        ) : (
          rows.map((i) => (
            <Card
              key={i.id}
              className="cursor-pointer hover:border-primary/40"
              onClick={() => setSelected(i)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-muted-foreground">
                    {i.incident_number}
                  </span>
                  <Badge>{i.status.replace(/_/g, " ")}</Badge>
                  <Badge variant="outline">{i.severity}</Badge>
                  {!i.is_public && <Badge variant="secondary">internal</Badge>}
                  {i.resolved_at && (
                    <Badge variant="secondary">resolved</Badge>
                  )}
                </div>
                <CardTitle className="text-base">{i.title}</CardTitle>
                <CardDescription className="text-xs">
                  Started{" "}
                  {formatDistanceToNow(new Date(i.started_at), {
                    addSuffix: true,
                  })}
                  {i.affected_components.length > 0
                    ? ` · ${i.affected_components.join(", ")}`
                    : ""}
                </CardDescription>
              </CardHeader>
              {i.summary && (
                <CardContent className="pt-0 text-sm">{i.summary}</CardContent>
              )}
            </Card>
          ))
        )}
      </div>

      <NewIncidentDialog
        open={openNew}
        onOpenChange={setOpenNew}
        onCreated={() => {
          setOpenNew(false);
          load();
        }}
      />
      {selected && (
        <IncidentEditorDialog
          incident={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function NewIncidentDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<SupportIncident["status"]>("investigating");
  const [severity, setSeverity] = useState<SupportIncident["severity"]>("minor");
  const [isPublic, setIsPublic] = useState(true);
  const [components, setComponents] = useState("");

  async function submit() {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await adminCreateIncident({
        title: title.trim(),
        summary: summary.trim() || null,
        status,
        severity,
        is_public: isPublic,
        affected_components: components
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      toast({ title: "Incident declared" });
      setTitle("");
      setSummary("");
      setComponents("");
      onCreated();
    } catch (e) {
      toast({
        title: "Failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Declare incident</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Summary</Label>
            <Textarea
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) =>
                  setStatus(v as SupportIncident["status"])
                }
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
            </div>
            <div>
              <Label>Severity</Label>
              <Select
                value={severity}
                onValueChange={(v) =>
                  setSeverity(v as SupportIncident["severity"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Affected components (comma-separated)</Label>
            <Input
              value={components}
              onChange={(e) => setComponents(e.target.value)}
              placeholder="api, dashboard, webhooks"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
            <Label>Publish to status page</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Declare"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IncidentEditorDialog({
  incident,
  onClose,
  onChanged,
}: {
  incident: AdminIncidentRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [updates, setUpdates] = useState<AdminIncidentUpdate[] | null>(null);
  const [title, setTitle] = useState(incident.title);
  const [summary, setSummary] = useState(incident.summary ?? "");
  const [severity, setSeverity] = useState(incident.severity);
  const [isPublic, setIsPublic] = useState(incident.is_public);
  const [components, setComponents] = useState(
    incident.affected_components.join(", ")
  );
  const [updateStatus, setUpdateStatus] = useState<SupportIncident["status"]>(
    incident.status
  );
  const [updateBody, setUpdateBody] = useState("");
  const [updatePublic, setUpdatePublic] = useState(true);

  const loadUpdates = useCallback(async () => {
    try {
      setUpdates(await adminListIncidentUpdates(incident.id));
    } catch (e) {
      toast({
        title: "Failed to load updates",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  }, [incident.id, toast]);

  useEffect(() => {
    loadUpdates();
  }, [loadUpdates]);

  async function saveDetails() {
    setBusy(true);
    try {
      await adminUpdateIncident(incident.id, {
        title: title.trim(),
        summary: summary.trim() || null,
        severity,
        is_public: isPublic,
        affected_components: components
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      toast({ title: "Saved" });
      onChanged();
    } catch (e) {
      toast({
        title: "Save failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function postUpdate() {
    if (!updateBody.trim()) {
      toast({ title: "Update body required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await adminPostIncidentUpdate({
        incident_id: incident.id,
        status: updateStatus,
        body: updateBody.trim(),
        is_public: updatePublic,
      });
      toast({ title: "Update posted" });
      setUpdateBody("");
      await loadUpdates();
      onChanged();
    } catch (e) {
      toast({
        title: "Post failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!confirm("Delete this incident and all its updates?")) return;
    setBusy(true);
    try {
      await adminDeleteIncident(incident.id);
      toast({ title: "Deleted" });
      onChanged();
    } catch (e) {
      toast({
        title: "Delete failed",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">
              {incident.incident_number}
            </span>
            <span>{incident.title}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Details</h3>
            <div>
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label>Summary</Label>
              <Textarea
                rows={3}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Severity</Label>
                <Select
                  value={severity}
                  onValueChange={(v) =>
                    setSeverity(v as SupportIncident["severity"])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Switch checked={isPublic} onCheckedChange={setIsPublic} />
                <Label>Public on status page</Label>
              </div>
            </div>
            <div>
              <Label>Affected components</Label>
              <Input
                value={components}
                onChange={(e) => setComponents(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={saveDetails} disabled={busy}>
                Save details
              </Button>
              <Button variant="destructive" onClick={del} disabled={busy}>
                Delete
              </Button>
            </div>
          </section>

          <section className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold">Post update</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>New status</Label>
                <Select
                  value={updateStatus}
                  onValueChange={(v) =>
                    setUpdateStatus(v as SupportIncident["status"])
                  }
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
              </div>
              <div className="flex items-end gap-2">
                <Switch
                  checked={updatePublic}
                  onCheckedChange={setUpdatePublic}
                />
                <Label>Public</Label>
              </div>
            </div>
            <Textarea
              rows={3}
              placeholder="What has changed since the last update?"
              value={updateBody}
              onChange={(e) => setUpdateBody(e.target.value)}
            />
            <Button onClick={postUpdate} disabled={busy}>
              Post update
            </Button>
          </section>

          <section className="space-y-2 border-t pt-4">
            <h3 className="text-sm font-semibold">Timeline</h3>
            {!updates ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : updates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No updates yet.</p>
            ) : (
              updates.map((u) => (
                <div key={u.id} className="border rounded p-3 text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge>{u.status.replace(/_/g, " ")}</Badge>
                    {!u.is_public && (
                      <Badge variant="secondary">internal</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(u.created_at), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap">{u.body}</div>
                </div>
              ))
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
