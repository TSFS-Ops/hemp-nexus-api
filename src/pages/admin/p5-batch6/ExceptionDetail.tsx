/**
 * P-5 Batch 6 — Phase 5: Exception detail surface.
 *
 * Reads only via Phase 4 safe projections:
 *   - p5b6_get_exception_safe
 *   - p5b6_get_dispute_safe
 *   - p5b6_get_timeline_safe
 *
 * Writes/actions only via Phase 3 RPCs:
 *   - p5b6_update_exception_status
 *   - p5b6_assign_exception
 *   - p5b6_add_note
 *
 * No raw metadata, raw audit payloads, raw dispute internals or
 * report-export scope internals are rendered.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  P5_BATCH6_STATUSES,
  P5_BATCH6_NOTE_TYPES,
} from "@/lib/p5-batch6-exception-registry";

type ExceptionDetail = {
  id: string;
  exception_type: string;
  queue: string;
  priority: string;
  status: string;
  external_safe_summary: string;
  org_id: string | null;
  assigned_to_role: string | null;
  linked_memory_ref: string | null;
  linked_finality_ref: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

type DisputeRow = {
  id: string;
  exception_id: string;
  dispute_state: string;
  pauses_memory: boolean;
  created_at: string;
  updated_at: string;
};

type TimelineRow = {
  kind: "note" | "audit";
  event_at: string;
  event_code: string;
  actor_role: string | null;
  body_visible: string | null;
};

export default function P5Batch6ExceptionDetail() {
  const { exceptionId } = useParams<{ exceptionId: string }>();
  const [detail, setDetail] = useState<ExceptionDetail | null>(null);
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newStatus, setNewStatus] = useState<string>("");
  const [assignRole, setAssignRole] = useState<string>("");
  const [noteType, setNoteType] = useState<string>(P5_BATCH6_NOTE_TYPES[0] ?? "");
  const [noteBody, setNoteBody] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!exceptionId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      supabase.rpc("p5b6_get_exception_safe" as never, { _id: exceptionId } as never),
      supabase.rpc("p5b6_get_dispute_safe" as never, { _exception_id: exceptionId } as never),
      supabase.rpc("p5b6_get_timeline_safe" as never, { _exception_id: exceptionId } as never),
    ])
      .then(([d, dis, tl]: any[]) => {
        if (d.error) throw d.error;
        const first = (d.data ?? [])[0] ?? null;
        setDetail(first);
        setDisputes((dis.data ?? []) as DisputeRow[]);
        setTimeline((tl.data ?? []) as TimelineRow[]);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load exception");
      })
      .finally(() => setLoading(false));
  }, [exceptionId]);

  useEffect(() => { refresh(); }, [refresh]);

  const runAction = async (fn: () => Promise<{ error: unknown }>, label: string) => {
    setBusy(true);
    try {
      const { error: e } = await fn();
      if (e) {
        const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? "Action failed");
        toast({ title: label, description: msg, variant: "destructive" });
      } else {
        toast({ title: label, description: "Recorded." });
        refresh();
      }
    } catch (err) {
      toast({
        title: label,
        description: err instanceof Error ? err.message : "Action failed",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!detail) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-muted-foreground">Exception not found or not visible to your role.</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/p5-batch6">Back to workbench</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{detail.priority}</Badge>
            <Badge variant="secondary">{detail.queue}</Badge>
            <Badge>{detail.status}</Badge>
          </div>
          <h1 className="text-2xl font-semibold">{detail.exception_type}</h1>
          <p className="text-sm text-muted-foreground">{detail.external_safe_summary}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/p5-batch6">Back</Link>
        </Button>
      </header>

      <section className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">References</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div><span className="text-muted-foreground">Org:</span> {detail.org_id ?? "—"}</div>
            <div><span className="text-muted-foreground">Assigned role:</span> {detail.assigned_to_role ?? "—"}</div>
            <div><span className="text-muted-foreground">Memory ref:</span> {detail.linked_memory_ref ?? "—"}</div>
            <div><span className="text-muted-foreground">Finality ref:</span> {detail.linked_finality_ref ?? "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Lifecycle</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div><span className="text-muted-foreground">Created:</span> {new Date(detail.created_at).toLocaleString()}</div>
            <div><span className="text-muted-foreground">Updated:</span> {new Date(detail.updated_at).toLocaleString()}</div>
            <div><span className="text-muted-foreground">Resolved:</span> {detail.resolved_at ? new Date(detail.resolved_at).toLocaleString() : "—"}</div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm">Update status</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger><SelectValue placeholder="New status" /></SelectTrigger>
              <SelectContent>
                {P5_BATCH6_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={busy || !newStatus}
              onClick={() => runAction(
                () => supabase.rpc("p5b6_update_exception_status" as never, {
                  _exception_id: detail.id,
                  _new_status: newStatus,
                } as never) as any,
                "Update status",
              )}
            >
              Apply
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Assign</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Input
              placeholder="Role e.g. governance_reviewer"
              value={assignRole}
              onChange={(e) => setAssignRole(e.target.value)}
            />
            <Button
              size="sm"
              disabled={busy || !assignRole}
              onClick={() => runAction(
                () => supabase.rpc("p5b6_assign_exception" as never, {
                  _exception_id: detail.id,
                  _assigned_to_role: assignRole,
                } as never) as any,
                "Assign exception",
              )}
            >
              Assign
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Add note</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Select value={noteType} onValueChange={setNoteType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {P5_BATCH6_NOTE_TYPES.map((n) => (
                  <SelectItem key={n} value={n}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Note body"
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
            />
            <Button
              size="sm"
              disabled={busy || !noteBody || !noteType}
              onClick={() => runAction(
                () => supabase.rpc("p5b6_add_note" as never, {
                  _exception_id: detail.id,
                  _note_type: noteType,
                  _body: noteBody,
                } as never) as any,
                "Add note",
              ).then(() => setNoteBody(""))}
            >
              Add
            </Button>
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Disputes</h2>
        {disputes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No disputes recorded.</p>
        ) : (
          <div className="space-y-2">
            {disputes.map((d) => (
              <Card key={d.id}>
                <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm">
                  <Badge>{d.dispute_state}</Badge>
                  {d.pauses_memory && <Badge variant="destructive">Pauses Memory</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(d.updated_at).toLocaleString()}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Timeline</h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">No timeline entries.</p>
        ) : (
          <div className="space-y-2">
            {timeline.map((t, i) => (
              <Card key={`${t.kind}-${i}`}>
                <CardContent className="space-y-1 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant={t.kind === "audit" ? "secondary" : "outline"}>{t.kind}</Badge>
                    <span className="font-mono text-xs">{t.event_code}</span>
                    <span className="text-xs text-muted-foreground">{t.actor_role ?? "—"}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(t.event_at).toLocaleString()}
                    </span>
                  </div>
                  {t.body_visible && (
                    <p className="whitespace-pre-wrap text-sm">{t.body_visible}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
