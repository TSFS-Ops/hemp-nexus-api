/**
 * AdminUploadAuditPanel
 * ─────────────────────
 * Admin-only forensic view of every match-document upload attempt logged via
 * the `match-document-upload-log` edge function. Each row in `audit_logs`
 * with `action = 'document.upload.attempt'` captures:
 *
 *   • Requesting user + their profile org_id
 *   • Match id and the three match org slots (initiator/buyer/seller)
 *   • Server-evaluated participant role(s) and is_participant verdict
 *   • Storage path, status code, error body
 *   • match_documents row creation result (db_error / document_id)
 *   • Phase (storage_upload | db_insert | validation | success) + outcome
 *   • Server + client request id correlation
 *
 * Use this surface to verify cases like James's: filter by match_id or
 * caller_user_id, expand a row, and read the exact RLS/storage failure mode
 * without guessing.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, XCircle, RefreshCw, Search, Eye, Copy } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface UploadAttemptRow {
  id: string;
  org_id: string | null;
  actor_user_id: string | null;
  entity_id: string | null;
  created_at: string;
  metadata: any;
}

const PAGE_SIZE = 100;

const PHASE_LABEL: Record<string, string> = {
  storage_upload: "Storage upload",
  db_insert: "DB insert",
  validation: "Validation",
  success: "Success",
};

function shorten(value: string | null | undefined, head = 8): string {
  if (!value) return "-";
  return value.length <= head + 2 ? value : `${value.slice(0, head)}…`;
}

function copyText(value: string) {
  navigator.clipboard.writeText(value).then(
    () => toast.success("Copied"),
    () => toast.error("Copy failed"),
  );
}

export function AdminUploadAuditPanel() {
  const [matchFilter, setMatchFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<"any" | "success" | "failure">("any");
  const [phaseFilter, setPhaseFilter] = useState<string>("any");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<UploadAttemptRow | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-upload-audit", matchFilter, userFilter, outcomeFilter, phaseFilter, page],
    queryFn: async () => {
      let q = supabase
        .from("audit_logs")
        .select("id, org_id, actor_user_id, entity_id, created_at, metadata", { count: "exact" })
        .eq("action", "document.upload.attempt")
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (matchFilter.trim()) q = q.eq("entity_id", matchFilter.trim());
      if (userFilter.trim()) q = q.eq("actor_user_id", userFilter.trim());
      if (outcomeFilter !== "any") q = q.eq("metadata->>outcome", outcomeFilter);
      if (phaseFilter !== "any") q = q.eq("metadata->>phase", phaseFilter);

      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as UploadAttemptRow[], total: count ?? 0 };
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const stats = useMemo(() => {
    const successes = rows.filter((r) => r.metadata?.outcome === "success").length;
    const failures = rows.filter((r) => r.metadata?.outcome === "failure").length;
    const nonParticipant = rows.filter((r) => r.metadata?.evaluated?.is_participant === false).length;
    return { successes, failures, nonParticipant };
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="space-y-1.5 lg:col-span-2">
          <Label className="text-xs text-muted-foreground">Match ID</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={matchFilter}
              onChange={(e) => { setMatchFilter(e.target.value); setPage(0); }}
              placeholder="Exact match UUID"
              className="pl-8 font-mono text-xs"
            />
          </div>
        </div>
        <div className="space-y-1.5 lg:col-span-2">
          <Label className="text-xs text-muted-foreground">Caller user ID</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={userFilter}
              onChange={(e) => { setUserFilter(e.target.value); setPage(0); }}
              placeholder="Exact user UUID"
              className="pl-8 font-mono text-xs"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Outcome</Label>
          <Select value={outcomeFilter} onValueChange={(v) => { setOutcomeFilter(v as any); setPage(0); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failure">Failure</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Phase</Label>
          <Select value={phaseFilter} onValueChange={(v) => { setPhaseFilter(v); setPage(0); }}>
            <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">All phases</SelectItem>
              <SelectItem value="storage_upload">Storage upload</SelectItem>
              <SelectItem value="db_insert">DB insert</SelectItem>
              <SelectItem value="validation">Validation</SelectItem>
              <SelectItem value="success">Success</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 ml-auto text-xs">
          <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-600" /> {stats.successes} success</Badge>
          <Badge variant="outline" className="gap-1"><XCircle className="h-3 w-3 text-destructive" /> {stats.failures} failed</Badge>
          <Badge variant="outline">{stats.nonParticipant} non-participant</Badge>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[160px]">When</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Phase</TableHead>
              <TableHead>Match</TableHead>
              <TableHead>Caller / org</TableHead>
              <TableHead>Participant</TableHead>
              <TableHead>Storage</TableHead>
              <TableHead>DB row</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-sm text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center py-8 text-sm text-muted-foreground">No upload attempts logged for the current filters.</TableCell></TableRow>
            ) : rows.map((r) => {
              const m = r.metadata ?? {};
              const ev = m.evaluated ?? {};
              const isFailure = m.outcome === "failure";
              const storageStatus = m.storage_status;
              const documentId = m.document_id;
              const dbErr = m.db_error;
              return (
                <TableRow key={r.id} className={isFailure ? "bg-destructive/5" : undefined}>
                  <TableCell className="font-mono text-[11px] whitespace-nowrap">
                    {format(new Date(r.created_at), "yyyy-MM-dd HH:mm:ss")}
                  </TableCell>
                  <TableCell>
                    {m.outcome === "success" ? (
                      <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-300 dark:text-emerald-400">success</Badge>
                    ) : (
                      <Badge variant="destructive">failure</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{PHASE_LABEL[m.phase] ?? m.phase ?? "-"}</TableCell>
                  <TableCell className="font-mono text-[11px]">
                    <button onClick={() => copyText(r.entity_id ?? "")} className="hover:underline" title={r.entity_id ?? ""}>
                      {shorten(r.entity_id)}
                    </button>
                  </TableCell>
                  <TableCell className="font-mono text-[11px]">
                    <div title={r.actor_user_id ?? ""}>{shorten(r.actor_user_id)}</div>
                    <div className="text-muted-foreground" title={ev.caller_org_id ?? ""}>org {shorten(ev.caller_org_id)}</div>
                  </TableCell>
                  <TableCell>
                    {ev.is_participant ? (
                      <Badge variant="outline" className="text-emerald-700 border-emerald-300 dark:text-emerald-400">
                        {(ev.participant_roles ?? []).join(", ") || "yes"}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-destructive border-destructive/30">org_not_on_match</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {storageStatus != null ? (
                      <span className={storageStatus >= 400 ? "text-destructive font-mono" : "font-mono"}>
                        {storageStatus}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                    {m.storage_error && <div className="text-[11px] text-destructive truncate max-w-[180px]" title={m.storage_error}>{m.storage_error}</div>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {documentId ? (
                      <span className="text-emerald-700 dark:text-emerald-400 font-mono" title={documentId}>created</span>
                    ) : dbErr ? (
                      <span className="text-destructive truncate max-w-[180px] block" title={dbErr}>{dbErr}</span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(r)}>
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{total} attempt{total === 1 ? "" : "s"} · page {page + 1} of {totalPages}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</Button>
          <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Upload attempt detail</DialogTitle>
            <DialogDescription>
              Server-evaluated participant decision and full metadata captured at the time of the attempt.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => copyText(JSON.stringify(selected, null, 2))}>
                  <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy diagnostic JSON
                </Button>
              </div>
              <pre className="text-[11px] bg-muted/40 border border-border rounded-sm p-3 max-h-[60vh] overflow-auto font-mono">
{JSON.stringify(selected, null, 2)}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
