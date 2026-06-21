/**
 * Batch 17 — Unified operations queue.
 * Read-only safe queue across registry work item types. Filterable + paginated.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_OPS_WORK_ITEM_TYPES,
  REGISTRY_OPS_WORK_ITEM_LABEL,
  REGISTRY_OPS_SLA_STATES,
  REGISTRY_OPS_SLA_LABEL,
  REGISTRY_OPS_SLA_TONE,
  REGISTRY_OPS_SEVERITIES,
  REGISTRY_OPS_SEVERITY_LABEL,
  REGISTRY_OPS_SOURCE_MODULES,
  REGISTRY_OPS_SOURCE_MODULE_LABEL,
  REGISTRY_OPS_EMPTY_COPY,
  safeWorkItemLabel,
} from "@/lib/registry-operations-centre-ssot";

interface WorkItem {
  id: string;
  work_item_type: string;
  source_module: string;
  company_name: string | null;
  country: string | null;
  severity: string;
  status: string;
  sla_state: string;
  age_hours: number;
  next_action: string;
  safe_reason: string;
  link: string;
  created_at: string;
}

function slaBadgeVariant(state: string) {
  const tone = (REGISTRY_OPS_SLA_TONE as Record<string, string>)[state] ?? "neutral";
  if (tone === "danger") return "destructive" as const;
  if (tone === "warn") return "secondary" as const;
  return "outline" as const;
}

export default function AdminRegistryOperationsQueue() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState("");
  const [filterSla, setFilterSla] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [filterModule, setFilterModule] = useState("");
  const [search, setSearch] = useState("");

  async function load(cursor?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterType) params.set("type", filterType);
      if (filterSla) params.set("sla", filterSla);
      if (filterSeverity) params.set("severity", filterSeverity);
      if (filterModule) params.set("module", filterModule);
      if (search) params.set("q", search);
      if (cursor) params.set("cursor", cursor);
      params.set("limit", "50");
      const { data, error } = await supabase.functions.invoke(`registry-operations-queue?${params.toString()}`, { body: {} });
      if (error) throw error;
      const newItems = (data?.items ?? []) as WorkItem[];
      setItems(cursor ? [...items, ...newItems] : newItems);
      setNextCursor((data?.next_cursor ?? null) as string | null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load operations queue");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <main className="max-w-7xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">Unified operations queue</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Safe operational work items across registry modules. No raw bank details. No full API keys. No provider payloads.
      </p>

      <Card className="mb-3">
        <CardContent className="p-3 grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
          <label className="text-xs flex flex-col gap-1">
            Type
            <select className="border rounded px-2 py-1 text-sm" value={filterType} onChange={(e) => setFilterType(e.target.value)} data-testid="ops-queue-filter-type">
              <option value="">All</option>
              {REGISTRY_OPS_WORK_ITEM_TYPES.map((t) => <option key={t} value={t}>{REGISTRY_OPS_WORK_ITEM_LABEL[t]}</option>)}
            </select>
          </label>
          <label className="text-xs flex flex-col gap-1">
            SLA
            <select className="border rounded px-2 py-1 text-sm" value={filterSla} onChange={(e) => setFilterSla(e.target.value)} data-testid="ops-queue-filter-sla">
              <option value="">All</option>
              {REGISTRY_OPS_SLA_STATES.map((s) => <option key={s} value={s}>{REGISTRY_OPS_SLA_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="text-xs flex flex-col gap-1">
            Severity
            <select className="border rounded px-2 py-1 text-sm" value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)} data-testid="ops-queue-filter-severity">
              <option value="">All</option>
              {REGISTRY_OPS_SEVERITIES.map((s) => <option key={s} value={s}>{REGISTRY_OPS_SEVERITY_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="text-xs flex flex-col gap-1">
            Module
            <select className="border rounded px-2 py-1 text-sm" value={filterModule} onChange={(e) => setFilterModule(e.target.value)} data-testid="ops-queue-filter-module">
              <option value="">All</option>
              {REGISTRY_OPS_SOURCE_MODULES.map((m) => <option key={m} value={m}>{REGISTRY_OPS_SOURCE_MODULE_LABEL[m]}</option>)}
            </select>
          </label>
          <label className="text-xs flex flex-col gap-1 md:col-span-1">
            Search
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Company / ref" data-testid="ops-queue-search" />
          </label>
          <Button onClick={() => load(null)} disabled={loading} data-testid="ops-queue-apply">Apply</Button>
        </CardContent>
      </Card>

      {error && (
        <Card className="mb-3 border-destructive/50">
          <CardContent className="p-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table data-testid="ops-queue-table">
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Next action</TableHead>
                <TableHead>Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id} data-testid={`ops-queue-row-${it.work_item_type}`}>
                  <TableCell>{safeWorkItemLabel(it.work_item_type)}</TableCell>
                  <TableCell>{(REGISTRY_OPS_SOURCE_MODULE_LABEL as Record<string, string>)[it.source_module] ?? it.source_module}</TableCell>
                  <TableCell>{it.company_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={slaBadgeVariant(it.sla_state)} data-testid={`ops-queue-sla-${it.id}`}>
                      {(REGISTRY_OPS_SLA_LABEL as Record<string, string>)[it.sla_state] ?? it.sla_state}
                    </Badge>
                  </TableCell>
                  <TableCell>{(REGISTRY_OPS_SEVERITY_LABEL as Record<string, string>)[it.severity] ?? it.severity}</TableCell>
                  <TableCell>{it.age_hours}h</TableCell>
                  <TableCell className="text-xs">{it.next_action}</TableCell>
                  <TableCell><Link to={it.link} className="text-primary hover:underline">Open →</Link></TableCell>
                </TableRow>
              ))}
              {items.length === 0 && !loading && (
                <TableRow><TableCell colSpan={8} className="text-sm text-muted-foreground">{REGISTRY_OPS_EMPTY_COPY.queue}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {nextCursor && (
        <div className="mt-3">
          <Button variant="outline" onClick={() => load(nextCursor)} disabled={loading} data-testid="ops-queue-load-more">Load more</Button>
        </div>
      )}
    </main>
  );
}
