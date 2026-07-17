import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CWStatusBadge } from "./CWStatusBadge";
import {
  CASE_STATUSES,
  CASE_STATUS_LABELS,
  CASE_TYPES_LAUNCH,
  CASE_TYPE_LABELS,
  RISK_BANDS,
  RISK_BAND_LABELS,
  type CaseSummary,
  type QueueFilters,
} from "@/lib/compliance-workbench";
import { relativeFromNow } from "@/lib/funder-workspace/ui/labels";
import { Filter, Search } from "lucide-react";

interface Props {
  cases: CaseSummary[];
  initialFilters?: QueueFilters;
  showFilters?: boolean;
  onRowHref?: (c: CaseSummary) => string;
  emptyLabel?: string;
}

export function CaseQueueTable({
  cases,
  initialFilters = {},
  showFilters = true,
  onRowHref,
  emptyLabel = "No cases match your filters.",
}: Props) {
  const [f, setF] = useState<QueueFilters>(initialFilters);
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => applyFilters(cases, f), [cases, f]);

  const href = (c: CaseSummary) =>
    onRowHref ? onRowHref(c) : `/hq/compliance/cases/${encodeURIComponent(c.reference)}`;

  return (
    <div className="space-y-3">
      {showFilters && (
        <Card className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Search cases"
                className="pl-8"
                placeholder="Search reference, organisation, task…"
                value={f.text ?? ""}
                onChange={(e) => setF((p) => ({ ...p, text: e.target.value || undefined }))}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded((x) => !x)}
              aria-expanded={expanded}
            >
              <Filter className="mr-1 h-3.5 w-3.5" />
              Filters
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setF({})}>
              Reset
            </Button>
          </div>

          {expanded && (
            <div className="mt-3 grid gap-3 border-t border-border pt-3 md:grid-cols-4">
              <FilterSelect
                label="Case type"
                value={f.caseTypes?.[0]}
                onChange={(v) => setF((p) => ({ ...p, caseTypes: v ? [v as (typeof CASE_TYPES_LAUNCH)[number]] : undefined }))}
                options={CASE_TYPES_LAUNCH.map((t) => ({ value: t, label: CASE_TYPE_LABELS[t] }))}
              />
              <FilterSelect
                label="Status"
                value={f.statuses?.[0]}
                onChange={(v) => setF((p) => ({ ...p, statuses: v ? [v as (typeof CASE_STATUSES)[number]] : undefined }))}
                options={CASE_STATUSES.map((s) => ({ value: s, label: CASE_STATUS_LABELS[s] }))}
              />
              <FilterSelect
                label="Risk band"
                value={f.riskBands?.[0]}
                onChange={(v) => setF((p) => ({ ...p, riskBands: v ? [v as (typeof RISK_BANDS)[number]] : undefined }))}
                options={RISK_BANDS.map((r) => ({ value: r, label: RISK_BAND_LABELS[r] }))}
              />
              <div className="flex flex-col gap-2 text-sm">
                <FilterCheckbox
                  label="Assigned to me"
                  checked={!!f.assignedToMe}
                  onChange={(v) => setF((p) => ({ ...p, assignedToMe: v || undefined }))}
                />
                <FilterCheckbox
                  label="Unassigned"
                  checked={!!f.unassigned}
                  onChange={(v) => setF((p) => ({ ...p, unassigned: v || undefined }))}
                />
                <FilterCheckbox
                  label="Overdue"
                  checked={!!f.overdue}
                  onChange={(v) => setF((p) => ({ ...p, overdue: v || undefined }))}
                />
                <FilterCheckbox
                  label="Provider-dependent"
                  checked={!!f.providerDependent}
                  onChange={(v) => setF((p) => ({ ...p, providerDependent: v || undefined }))}
                />
                <FilterCheckbox
                  label="More info required"
                  checked={!!f.moreInformationRequired}
                  onChange={(v) => setF((p) => ({ ...p, moreInformationRequired: v || undefined }))}
                />
                <FilterCheckbox
                  label="Active hold"
                  checked={!!f.hasHold}
                  onChange={(v) => setF((p) => ({ ...p, hasHold: v || undefined }))}
                />
                <FilterCheckbox
                  label="Pending approval"
                  checked={!!f.hasApproval}
                  onChange={(v) => setF((p) => ({ ...p, hasApproval: v || undefined }))}
                />
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Analyst</TableHead>
              <TableHead>SLA</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead>Last activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c) => (
                <TableRow key={c.internalId} className="hover:bg-muted/50">
                  <TableCell className="font-mono text-xs">
                    <Link to={href(c)} className="text-primary hover:underline">
                      {c.reference}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{CASE_TYPE_LABELS[c.type]}</TableCell>
                  <TableCell className="text-sm">{c.primarySubject.displayName}</TableCell>
                  <TableCell>
                    <CWStatusBadge kind="risk" value={c.riskBand ?? undefined} />
                  </TableCell>
                  <TableCell>
                    <CWStatusBadge kind="case_status" value={c.status} />
                  </TableCell>
                  <TableCell className="text-sm">
                    {c.assignment.analystDisplayName ?? (
                      <span className="italic text-muted-foreground">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span
                      className={
                        c.sla.breached
                          ? "font-medium text-destructive"
                          : c.sla.warning
                          ? "font-medium text-amber-700 dark:text-amber-400"
                          : ""
                      }
                    >
                      {c.sla.targetAt ? relativeFromNow(c.sla.targetAt) : "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.hasActiveHold && <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">Hold</span>}
                      {c.hasOpenRfi && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400">RFI</span>}
                      {c.hasPendingApproval && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">Approval</span>}
                      {c.providerDependent && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Provider</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.lastActivityAt ? relativeFromNow(c.lastActivityAt) : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value?: string;
  onChange: (v?: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Select value={value ?? "__all"} onValueChange={(v) => onChange(v === "__all" ? undefined : v)}>
        <SelectTrigger>
          <SelectValue placeholder="Any" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">Any</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function FilterCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} />
      <span>{label}</span>
    </label>
  );
}

function applyFilters(cases: CaseSummary[], f: QueueFilters): CaseSummary[] {
  return cases.filter((c) => {
    if (f.unassigned && c.assignment.analystDisplayName) return false;
    if (f.overdue && !c.sla.breached) return false;
    if (f.providerDependent && !c.providerDependent) return false;
    if (f.moreInformationRequired && c.status !== "awaiting_customer") return false;
    if (f.riskBands?.length && (!c.riskBand || !f.riskBands.includes(c.riskBand))) return false;
    if (f.caseTypes?.length && !f.caseTypes.includes(c.type)) return false;
    if (f.statuses?.length && !f.statuses.includes(c.status)) return false;
    if (f.hasHold && !c.hasActiveHold) return false;
    if (f.hasApproval && !c.hasPendingApproval) return false;
    if (f.text) {
      const t = f.text.toLowerCase();
      const hay = `${c.reference} ${c.primarySubject.displayName} ${c.currentTask ?? ""}`.toLowerCase();
      if (!hay.includes(t)) return false;
    }
    return true;
  });
}
