/**
 * FacilitationQueuePanel - HQ admin queue listing for facilitation cases.
 *
 * Batch 7 — adds due date, overdue badge, last-activity age, and an
 * "Overdue only" filter.
 */
import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { INTERNAL_STATUSES, INTERNAL_STATUS_LABELS, type FacilitationInternalStatus } from "@/lib/facilitation-case-state";
import { FacilitationCaseDrawer } from "@/components/facilitation/FacilitationCaseDrawer";
import { friendlyFacilitationError } from "@/lib/facilitation-labels";

type Row = {
  id: string; case_number: string; internal_status: FacilitationInternalStatus;
  counterparty_legal_name: string; urgency: string; role: string;
  created_at: string; case_owner_id: string | null;
  next_action_due_at: string | null;
  owner_assignment_due_at: string | null;
  is_overdue: boolean | null;
  last_activity_at: string | null;
};

const fmtShort = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString() : "—";

const ageLabel = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const h = Math.floor(ms / 36e5);
  if (h < 1) return "<1h";
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

export const FacilitationQueuePanel: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [urgency, setUrgency] = useState<string>("");
  const [q, setQ] = useState("");
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("list-facilitation-cases", {
        body: {
          status: status || null, urgency: urgency || null, q: q || null,
          assigned_to_me: assignedToMe || null,
          overdue_only: overdueOnly || null,
          limit: 100, offset: 0,
        },
      });
      if (error) throw error;
      setRows(((data as { cases: Row[] }).cases) ?? []);
    } catch (err: unknown) { toast.error(await friendlyFacilitationError(err, "Could not load facilitation cases. Please try again.")); }
    finally { setLoading(false); }
  }, [status, urgency, q, assignedToMe, overdueOnly]);

  useEffect(() => { void load(); }, [load]);

  if (rows.length === 0 && !loading) {
    return (
      <>
        <Filters {...{ status, setStatus, urgency, setUrgency, q, setQ, assignedToMe, setAssignedToMe, overdueOnly, setOverdueOnly, load }} />
        <Card><CardContent className="py-12 text-center text-sm text-slate-500">
          No facilitation cases yet. When a user requests help with an unknown counterparty, their case will appear here.
        </CardContent></Card>
      </>
    );
  }

  return (
    <>
      <Filters {...{ status, setStatus, urgency, setUrgency, q, setQ, assignedToMe, setAssignedToMe, overdueOnly, setOverdueOnly, load }} />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Urgency</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Last action</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const due = r.next_action_due_at ?? r.owner_assignment_due_at;
                const dueOverdue = !!due && new Date(due).getTime() < Date.now();
                return (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenCaseId(r.id)}>
                    <TableCell className="font-mono text-xs">{r.case_number}</TableCell>
                    <TableCell>{r.counterparty_legal_name}</TableCell>
                    <TableCell className="space-x-1">
                      <Badge variant="secondary">{INTERNAL_STATUS_LABELS[r.internal_status] ?? r.internal_status}</Badge>
                      {r.is_overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                      {!r.case_owner_id && r.owner_assignment_due_at && new Date(r.owner_assignment_due_at).getTime() < Date.now()
                        ? <Badge variant="outline" className="border-rose-300 text-rose-700">Unassigned</Badge>
                        : null}
                    </TableCell>
                    <TableCell><Badge variant="outline">{r.urgency}</Badge></TableCell>
                    <TableCell className={`text-xs ${dueOverdue ? "text-rose-700 font-medium" : "text-slate-700"}`}>
                      {fmtShort(due)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{ageLabel(r.last_activity_at)}</TableCell>
                    <TableCell className="text-xs text-slate-500">{new Date(r.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <FacilitationCaseDrawer caseId={openCaseId} onClose={() => setOpenCaseId(null)} onChanged={() => void load()} />
    </>
  );
};

const Filters: React.FC<{
  status: string; setStatus: (v: string) => void;
  urgency: string; setUrgency: (v: string) => void;
  q: string; setQ: (v: string) => void;
  assignedToMe: boolean; setAssignedToMe: (v: boolean) => void;
  overdueOnly: boolean; setOverdueOnly: (v: boolean) => void;
  load: () => void;
}> = ({ status, setStatus, urgency, setUrgency, q, setQ, assignedToMe, setAssignedToMe, overdueOnly, setOverdueOnly, load }) => (
  <div className="mb-4 flex flex-wrap gap-2 items-center">
    <Input placeholder="Search case number…" className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} />
    <Select value={status || "__all"} onValueChange={(v) => setStatus(v === "__all" ? "" : v)}>
      <SelectTrigger className="w-56"><SelectValue placeholder="All statuses" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">All statuses</SelectItem>
        {INTERNAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{INTERNAL_STATUS_LABELS[s]}</SelectItem>)}
      </SelectContent>
    </Select>
    <Select value={urgency || "__all"} onValueChange={(v) => setUrgency(v === "__all" ? "" : v)}>
      <SelectTrigger className="w-40"><SelectValue placeholder="All urgency" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">All urgency</SelectItem>
        <SelectItem value="low">Low</SelectItem>
        <SelectItem value="normal">Normal</SelectItem>
        <SelectItem value="high">High</SelectItem>
        <SelectItem value="critical">Critical</SelectItem>
      </SelectContent>
    </Select>
    <label className="text-xs text-slate-600 flex items-center gap-1">
      <input type="checkbox" checked={assignedToMe} onChange={(e) => setAssignedToMe(e.target.checked)} />
      Assigned to me
    </label>
    <label className="text-xs text-slate-600 flex items-center gap-1">
      <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
      Overdue only
    </label>
    <Button onClick={load} variant="outline" size="sm">Refresh</Button>
  </div>
);

export default FacilitationQueuePanel;
