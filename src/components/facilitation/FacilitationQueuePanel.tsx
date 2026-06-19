/**
 * FacilitationQueuePanel — HQ admin queue listing for facilitation cases.
 *
 * Batch 7 — adds due date, overdue badge, last-activity age, and an
 * "Overdue only" filter.
 *
 * Batch 8 — management view: extended filters (country, sector, value
 * range, currency, open/closed, final outcome, requester organisation,
 * owner, date range, warning-only), extended columns (case age, status,
 * owner, requester, country, sector, value, contact attempts, final
 * outcome, linked organisation, POI reference, closed date), management
 * metrics strip, and admin-gated CSV + evidence-pack export buttons.
 *
 * All labels are plain English. No raw enum codes, no UUIDs in user
 * surfaces. Exports are role-gated server-side; the client only hides
 * controls cosmetically.
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
import { INTERNAL_STATUSES, INTERNAL_STATUS_LABELS, OUTCOMES, type FacilitationInternalStatus } from "@/lib/facilitation-case-state";
import { FacilitationCaseDrawer } from "@/components/facilitation/FacilitationCaseDrawer";
import { FacilitationManagementMetrics } from "@/components/facilitation/FacilitationManagementMetrics";
import { friendlyFacilitationError } from "@/lib/facilitation-labels";
import { Download, FileDown } from "lucide-react";

type Row = {
  id: string;
  case_number: string;
  internal_status: FacilitationInternalStatus;
  counterparty_legal_name: string | null;
  counterparty_country: string | null;
  sector: string | null;
  role: string;
  urgency: string;
  estimated_value_amount: number | null;
  estimated_value_currency: string | null;
  created_at: string;
  closed_at: string | null;
  case_owner_id: string | null;
  case_owner_label: string | null;
  requesting_org_id: string | null;
  requesting_org_name: string | null;
  requesting_user_id: string | null;
  requesting_user_label: string | null;
  linked_organization_id: string | null;
  linked_organization_name: string | null;
  poi_conversion_reference: string | null;
  final_outcome: string | null;
  next_action_due_at: string | null;
  owner_assignment_due_at: string | null;
  is_overdue: boolean | null;
  last_activity_at: string | null;
};

type Filters = {
  status: string;
  urgency: string;
  q: string;
  assignedToMe: boolean;
  overdueOnly: boolean;
  warningOnly: boolean;
  country: string;
  sector: string;
  currency: string;
  valueMin: string;
  valueMax: string;
  openOrClosed: "" | "open" | "closed";
  finalOutcome: string;
  dateFrom: string;
  dateTo: string;
};

const EMPTY_FILTERS: Filters = {
  status: "",
  urgency: "",
  q: "",
  assignedToMe: false,
  overdueOnly: false,
  warningOnly: false,
  country: "",
  sector: "",
  currency: "",
  valueMin: "",
  valueMax: "",
  openOrClosed: "",
  finalOutcome: "",
  dateFrom: "",
  dateTo: "",
};

const fmtShort = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString() : "—";

const ageDaysLabel = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 36e5));
  if (d < 1) return "<1d";
  return `${d}d`;
};

const fmtValue = (amt: number | null, ccy: string | null) => {
  if (amt == null) return "—";
  return `${ccy ?? ""} ${amt.toLocaleString()}`.trim();
};

const OUTCOME_LABELS: Record<string, string> = {
  converted_to_known_counterparty_poi: "Converted to POI",
  counterparty_declined: "Counterparty declined",
  unable_to_proceed: "Unable to proceed",
  duplicate: "Duplicate",
  blocked_by_compliance: "Blocked by compliance",
  cancelled_by_requester: "Cancelled by requester",
};

export const FacilitationQueuePanel: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [packDownloadingId, setPackDownloadingId] = useState<string | null>(null);
  // Batch 10 — last sealed evidence pack info (read-only display).
  const [lastSeal, setLastSeal] = useState<{
    case_number: string;
    algo: string;
    digest_hex: string;
    canonical_bytes: number;
    sealed_at: string;
    function_version: string;
  } | null>(null);



  const buildBody = useCallback(() => ({
    status: filters.status || null,
    urgency: filters.urgency || null,
    q: filters.q || null,
    assigned_to_me: filters.assignedToMe || null,
    overdue_only: filters.overdueOnly || null,
    warning_only: filters.warningOnly || null,
    country: filters.country || null,
    sector: filters.sector || null,
    currency: filters.currency || null,
    value_min: filters.valueMin ? Number(filters.valueMin) : null,
    value_max: filters.valueMax ? Number(filters.valueMax) : null,
    open_or_closed: filters.openOrClosed || null,
    final_outcome: filters.finalOutcome || null,
    date_from: filters.dateFrom || null,
    date_to: filters.dateTo || null,
    limit: 100,
    offset: 0,
  }), [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("list-facilitation-cases", { body: buildBody() });
      if (error) throw error;
      setRows(((data as { cases: Row[] }).cases) ?? []);
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not load facilitation cases. Please try again."));
    } finally {
      setLoading(false);
    }
  }, [buildBody]);

  useEffect(() => { void load(); }, [load]);

  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;
      if (!token) throw new Error("Sign in required");
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID as string;
      const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/facilitation-export-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(buildBody()),
      });
      if (resp.status === 403) { toast.error("You don't have permission to export."); return; }
      if (!resp.ok) { toast.error("Could not generate the CSV. Please try again."); return; }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `facilitation-cases-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded.");
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not generate the CSV. Please try again."));
    } finally {
      setExporting(false);
    }
  }, [buildBody]);

  const downloadEvidencePack = useCallback(async (caseId: string, caseNumber: string) => {
    setPackDownloadingId(caseId);
    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;
      if (!token) throw new Error("Sign in required");
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID as string;
      const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/facilitation-export-evidence-pack`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ case_id: caseId }),
      });
      if (resp.status === 403) { toast.error("You don't have permission to export the evidence pack."); return; }
      if (!resp.ok) { toast.error("Could not generate the evidence pack. Please try again."); return; }
      // Batch 10 — response is now `{ pack, seal }`. Parse the envelope so we
      // can both download the sealed JSON and surface the digest in the UI.
      const envelope = await resp.json() as {
        pack: unknown;
        seal: { algo: string; digest_hex: string; canonical_bytes: number; sealed_at: string; function_version: string };
      };
      if (!envelope?.seal?.digest_hex) {
        toast.error("Evidence pack returned without a seal. Please contact the platform team.");
        return;
      }
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `evidence-pack-${caseNumber}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setLastSeal({ case_number: caseNumber, ...envelope.seal });
      toast.success(`Evidence pack downloaded · SHA-256 ${envelope.seal.digest_hex.slice(0, 12)}…`);
    } catch (err: unknown) {
      toast.error(await friendlyFacilitationError(err, "Could not generate the evidence pack. Please try again."));
    } finally {
      setPackDownloadingId(null);
    }
  }, []);


  return (
    <>
      <FacilitationManagementMetrics />
      {lastSeal ? (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="py-3 px-4 text-xs text-slate-700">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-medium text-slate-900">Last evidence pack hash</span>
              <span className="text-slate-500">Case</span>
              <span className="font-mono">{lastSeal.case_number}</span>
              <span className="text-slate-500">Algorithm</span>
              <span className="font-mono uppercase">{lastSeal.algo}</span>
              <span className="text-slate-500">SHA-256 digest</span>
              <span className="font-mono break-all">{lastSeal.digest_hex}</span>
              <span className="text-slate-500">Canonical bytes</span>
              <span className="font-mono">{lastSeal.canonical_bytes.toLocaleString()}</span>
              <span className="text-slate-500">Sealed at</span>
              <span className="font-mono">{lastSeal.sealed_at}</span>
              <span className="text-slate-500">Producer</span>
              <span className="font-mono">{lastSeal.function_version}</span>
            </div>
            <p className="mt-2 text-[11px] text-slate-500 leading-snug">
              Verify locally: the digest is computed over a canonical-JSON serialisation
              of the <code>pack</code> object (deterministic key ordering, UTF-8, no
              whitespace) — NOT the surrounding envelope. To verify a downloaded file,
              extract its <code>pack</code> field, re-serialise with sorted keys, and
              compute SHA-256. The resulting digest must equal the value shown above.
            </p>
          </CardContent>
        </Card>
      ) : null}
      <FiltersBar
        filters={filters}
        setFilters={setFilters}
        load={load}
        onExportCsv={exportCsv}
        exporting={exporting}
      />

      {rows.length === 0 && !loading ? (
        <Card><CardContent className="py-12 text-center text-sm text-slate-500">
          No facilitation cases match the current filters.
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Requester org</TableHead>
                  <TableHead>Requester user</TableHead>
                  <TableHead>Counterparty</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Linked org</TableHead>
                  <TableHead>POI reference</TableHead>
                  <TableHead>Final outcome</TableHead>
                  <TableHead>Closed</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const due = r.next_action_due_at ?? r.owner_assignment_due_at;
                  const dueOverdue = !!due && new Date(due).getTime() < Date.now();
                  const warning = r.is_overdue || r.internal_status === "blocked_by_compliance";
                  return (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenCaseId(r.id)}>
                      <TableCell className="font-mono text-xs">{r.case_number}</TableCell>
                      <TableCell className="text-xs text-slate-600">{fmtShort(r.created_at)}</TableCell>
                      <TableCell className="text-xs text-slate-600">{ageDaysLabel(r.created_at)}</TableCell>
                      <TableCell className="space-x-1">
                        <Badge variant="secondary">{INTERNAL_STATUS_LABELS[r.internal_status] ?? r.internal_status}</Badge>
                        {r.is_overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                        {warning && !r.is_overdue ? <Badge variant="outline" className="border-amber-300 text-amber-700">Warning</Badge> : null}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700">{r.case_owner_label ?? "Unassigned"}</TableCell>
                      <TableCell className="text-xs text-slate-700">{r.requesting_org_name ?? "—"}</TableCell>
                      <TableCell className="text-xs text-slate-700">{r.requesting_user_label ?? "—"}</TableCell>
                      <TableCell className="text-sm">{r.counterparty_legal_name ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.counterparty_country ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.sector ?? "—"}</TableCell>
                      <TableCell className="text-xs">{fmtValue(r.estimated_value_amount, r.estimated_value_currency)}</TableCell>
                      <TableCell className={`text-xs ${dueOverdue ? "text-rose-700 font-medium" : "text-slate-700"}`}>{fmtShort(due)}</TableCell>
                      <TableCell className="text-xs">{r.linked_organization_name ?? "—"}</TableCell>
                      <TableCell className="text-xs font-mono">{r.poi_conversion_reference ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.final_outcome ? OUTCOME_LABELS[r.final_outcome] ?? r.final_outcome.replace(/_/g, " ") : "—"}</TableCell>
                      <TableCell className="text-xs text-slate-600">{fmtShort(r.closed_at)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void downloadEvidencePack(r.id, r.case_number)}
                          disabled={packDownloadingId === r.id}
                          title="Download evidence pack (platform admins only)"
                        >
                          <FileDown className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <FacilitationCaseDrawer caseId={openCaseId} onClose={() => setOpenCaseId(null)} onChanged={() => void load()} />
    </>
  );
};

const FiltersBar: React.FC<{
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  load: () => void;
  onExportCsv: () => void;
  exporting: boolean;
}> = ({ filters, setFilters, load, onExportCsv, exporting }) => {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Search case number…" className="max-w-xs" value={filters.q} onChange={(e) => set("q", e.target.value)} />
        <Select value={filters.status || "__all"} onValueChange={(v) => set("status", v === "__all" ? "" : v)}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All statuses</SelectItem>
            {INTERNAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{INTERNAL_STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.urgency || "__all"} onValueChange={(v) => set("urgency", v === "__all" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All urgency" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All urgency</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.openOrClosed || "__all"} onValueChange={(v) => set("openOrClosed", v === "__all" ? "" : (v as "open" | "closed"))}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Open and closed" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Open and closed</SelectItem>
            <SelectItem value="open">Open only</SelectItem>
            <SelectItem value="closed">Closed only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.finalOutcome || "__all"} onValueChange={(v) => set("finalOutcome", v === "__all" ? "" : v)}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Any final outcome" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Any final outcome</SelectItem>
            {OUTCOMES.map((o) => (
              <SelectItem key={o} value={o}>{OUTCOME_LABELS[o] ?? o.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Country" className="w-32" value={filters.country} onChange={(e) => set("country", e.target.value)} />
        <Input placeholder="Sector" className="w-40" value={filters.sector} onChange={(e) => set("sector", e.target.value)} />
        <Input placeholder="Currency (3-letter)" className="w-44" value={filters.currency} onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 3))} />
        <Input placeholder="Min value" type="number" className="w-28" value={filters.valueMin} onChange={(e) => set("valueMin", e.target.value)} />
        <Input placeholder="Max value" type="number" className="w-28" value={filters.valueMax} onChange={(e) => set("valueMax", e.target.value)} />
        <Input placeholder="From date" type="date" className="w-40" value={filters.dateFrom} onChange={(e) => set("dateFrom", e.target.value)} />
        <Input placeholder="To date" type="date" className="w-40" value={filters.dateTo} onChange={(e) => set("dateTo", e.target.value)} />
        <label className="text-xs text-slate-600 flex items-center gap-1">
          <input type="checkbox" checked={filters.assignedToMe} onChange={(e) => set("assignedToMe", e.target.checked)} />
          Assigned to me
        </label>
        <label className="text-xs text-slate-600 flex items-center gap-1">
          <input type="checkbox" checked={filters.overdueOnly} onChange={(e) => set("overdueOnly", e.target.checked)} />
          Overdue only
        </label>
        <label className="text-xs text-slate-600 flex items-center gap-1">
          <input type="checkbox" checked={filters.warningOnly} onChange={(e) => set("warningOnly", e.target.checked)} />
          Warning only
        </label>
        <Button onClick={load} variant="outline" size="sm">Refresh</Button>
        <Button onClick={onExportCsv} variant="outline" size="sm" disabled={exporting}>
          <Download className="h-4 w-4 mr-1" />
          {exporting ? "Preparing CSV…" : "Export CSV"}
        </Button>
      </div>
    </div>
  );
};

export default FacilitationQueuePanel;
