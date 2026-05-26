/**
 * AdminBasicMemoryPanel — Basic Memory Record v1 · HQ-only viewer.
 *
 * Read-only list + filter + detail dialog over public.basic_memory_records.
 *
 * v1 scope is intentionally minimal:
 *   - list (default created_at desc, capped page size)
 *   - filters: date range, trigger_event_type, outcome,
 *     environment_classification
 *   - detail dialog showing every approved v1 field
 *   - NO create / edit / delete / correction / export
 *   - NO user/counterparty exposure (mounted only under /hq)
 *   - NO scoring, reputation, AI summary or matching influence
 *
 * Data access: relies on RLS which restricts SELECT to platform_admin /
 * auditor roles. The component is mounted only inside the HQ shell,
 * which itself is wrapped by RequireAuth role="platform_admin".
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BASIC_MEMORY_TRIGGER_TYPES,
  BASIC_MEMORY_TRIGGER_LABELS,
  BASIC_MEMORY_OUTCOMES,
  BASIC_MEMORY_OUTCOME_LABELS,
  BASIC_MEMORY_ENVIRONMENTS,
  type BasicMemoryTriggerType,
  type BasicMemoryOutcome,
  type BasicMemoryEnvironment,
} from "@/lib/basic-memory/outcomes";

const PAGE_LIMIT = 100;

const EMPTY_STATE_COPY =
  "No Basic Memory Record exists yet because no meaningful outcome has been recorded.";

export const BASIC_MEMORY_RECORD_EXPLANATION =
  "Basic Memory Record created. This stores the retained outcome of this transaction path and links to the evidence that supports it.";

interface MemoryRow {
  id: string;
  created_at: string;
  trigger_event_type: string;
  outcome: string;
  outcome_reason: string;
  outcome_summary: string | null;
  environment_classification: string;
  match_id: string | null;
  poi_id: string | null;
  wad_id: string | null;
  engagement_id: string | null;
  dispute_id: string | null;
  source_table: string;
  source_record_id: string;
  source_function: string;
  status_snapshot: unknown;
  audit_event_ids: string[];
}

interface Filters {
  from: string;
  to: string;
  trigger: "all" | BasicMemoryTriggerType;
  outcome: "all" | BasicMemoryOutcome;
  env: "all" | BasicMemoryEnvironment;
}

function useBasicMemoryRecords(filters: Filters) {
  return useQuery({
    queryKey: ["basic-memory-records", filters],
    queryFn: async () => {
      let q = supabase
        .from("basic_memory_records")
        .select(
          "id, created_at, trigger_event_type, outcome, outcome_reason, outcome_summary, environment_classification, match_id, poi_id, wad_id, engagement_id, dispute_id, source_table, source_record_id, source_function, status_snapshot, audit_event_ids",
        )
        .order("created_at", { ascending: false })
        .limit(PAGE_LIMIT);
      if (filters.from)
        q = q.gte("created_at", new Date(filters.from).toISOString());
      if (filters.to) q = q.lte("created_at", new Date(filters.to).toISOString());
      if (filters.trigger !== "all")
        q = q.eq("trigger_event_type", filters.trigger);
      if (filters.outcome !== "all") q = q.eq("outcome", filters.outcome);
      if (filters.env !== "all")
        q = q.eq("environment_classification", filters.env);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as MemoryRow[];
    },
  });
}

function envBadgeVariant(
  env: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (env === "live") return "default";
  if (env === "demo") return "secondary";
  return "outline";
}

export function AdminBasicMemoryPanel() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [trigger, setTrigger] = useState<Filters["trigger"]>("all");
  const [outcome, setOutcome] = useState<Filters["outcome"]>("all");
  const [env, setEnv] = useState<Filters["env"]>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const filters = useMemo<Filters>(
    () => ({ from, to, trigger, outcome, env }),
    [from, to, trigger, outcome, env],
  );

  const { data, isLoading, isError, error } = useBasicMemoryRecords(filters);
  const selected = useMemo(
    () => data?.find((r) => r.id === openId) ?? null,
    [data, openId],
  );

  return (
    <div className="space-y-4" data-testid="basic-memory-panel">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground mb-1 block">
                From
              </label>
              <Input
                type="date"
                className="h-9 text-xs"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                data-testid="bm-filter-from"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground mb-1 block">
                To
              </label>
              <Input
                type="date"
                className="h-9 text-xs"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                data-testid="bm-filter-to"
              />
            </div>
            <div className="min-w-[180px]">
              <label className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground mb-1 block">
                Trigger
              </label>
              <Select
                value={trigger}
                onValueChange={(v) => setTrigger(v as Filters["trigger"])}
              >
                <SelectTrigger className="h-9 text-xs" data-testid="bm-filter-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All triggers</SelectItem>
                  {BASIC_MEMORY_TRIGGER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {BASIC_MEMORY_TRIGGER_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[180px]">
              <label className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground mb-1 block">
                Outcome
              </label>
              <Select
                value={outcome}
                onValueChange={(v) => setOutcome(v as Filters["outcome"])}
              >
                <SelectTrigger className="h-9 text-xs" data-testid="bm-filter-outcome">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All outcomes</SelectItem>
                  {BASIC_MEMORY_OUTCOMES.map((o) => (
                    <SelectItem key={o} value={o}>
                      {BASIC_MEMORY_OUTCOME_LABELS[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[160px]">
              <label className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground mb-1 block">
                Environment
              </label>
              <Select
                value={env}
                onValueChange={(v) => setEnv(v as Filters["env"])}
              >
                <SelectTrigger className="h-9 text-xs" data-testid="bm-filter-env">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All environments</SelectItem>
                  {BASIC_MEMORY_ENVIRONMENTS.map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[10px] text-muted-foreground font-mono ml-auto">
              Basic Memory v1 · HQ-only view · retained outcomes · no export
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading && (
            <div className="p-5 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {isError && (
            <div
              className="p-5 text-sm text-destructive"
              data-testid="bm-error"
            >
              Failed to load Basic Memory Records
              {error instanceof Error ? `: ${error.message}` : "."}
            </div>
          )}
          {!isLoading && !isError && data && data.length === 0 && (
            <div
              className="p-5 text-sm text-muted-foreground italic"
              data-testid="bm-empty"
            >
              {EMPTY_STATE_COPY}
            </div>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-border" data-testid="bm-list">
              {data.map((r) => (
                <li
                  key={r.id}
                  className="px-4 py-3 hover:bg-muted/40 cursor-pointer flex items-center justify-between gap-4"
                  onClick={() => setOpenId(r.id)}
                  data-testid="bm-row"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {r.trigger_event_type}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {BASIC_MEMORY_OUTCOME_LABELS[
                          r.outcome as BasicMemoryOutcome
                        ] ?? r.outcome}
                      </Badge>
                      <Badge
                        variant={envBadgeVariant(r.environment_classification)}
                        className="text-[10px]"
                        data-testid="bm-env-badge"
                      >
                        {r.environment_classification}
                      </Badge>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {r.outcome_reason}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">
                      {r.source_table} · {r.source_record_id.slice(0, 8)}…
                      {r.match_id
                        ? ` · match ${r.match_id.slice(0, 8)}…`
                        : ""}
                    </p>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                    {format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      >
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
          data-testid="bm-detail"
        >
          <DialogHeader>
            <DialogTitle>Basic Memory Record</DialogTitle>
            <DialogDescription>
              {BASIC_MEMORY_RECORD_EXPLANATION}
            </DialogDescription>
          </DialogHeader>
          {selected && <BasicMemoryDetail row={selected} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 text-xs border-b border-border py-2">
      <div className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground">
        {label}
      </div>
      <div className={mono ? "font-mono break-all" : "break-words"}>
        {value ?? <span className="text-muted-foreground italic">—</span>}
      </div>
    </div>
  );
}

function BasicMemoryDetail({ row }: { row: MemoryRow }) {
  return (
    <div className="space-y-1">
      <Field
        label="Outcome"
        value={
          <Badge variant="secondary" className="text-[10px]">
            {BASIC_MEMORY_OUTCOME_LABELS[row.outcome as BasicMemoryOutcome] ??
              row.outcome}
          </Badge>
        }
        mono={false}
      />
      <Field label="Outcome reason" value={row.outcome_reason} />
      <Field
        label="Outcome summary"
        value={row.outcome_summary || null}
        mono={false}
      />
      <Field
        label="Environment"
        value={
          <Badge
            variant={envBadgeVariant(row.environment_classification)}
            className="text-[10px]"
          >
            {row.environment_classification}
          </Badge>
        }
        mono={false}
      />
      <Field label="Trigger" value={row.trigger_event_type} />
      <Field label="Created at" value={format(new Date(row.created_at), "yyyy-MM-dd HH:mm:ss")} />
      <Field label="Match ID" value={row.match_id} />
      <Field label="POI ID" value={row.poi_id} />
      <Field label="WaD ID" value={row.wad_id} />
      <Field label="Engagement ID" value={row.engagement_id} />
      <Field label="Dispute ID" value={row.dispute_id} />
      <Field label="Source table" value={row.source_table} />
      <Field label="Source record ID" value={row.source_record_id} />
      <Field label="Source function" value={row.source_function} />
      <Field
        label="Audit event IDs"
        value={
          row.audit_event_ids?.length ? (
            <ul className="space-y-0.5" data-testid="bm-detail-audit-ids">
              {row.audit_event_ids.map((id) => (
                <li key={id} className="text-[11px]">
                  {id}
                </li>
              ))}
            </ul>
          ) : null
        }
      />
      <div className="pt-3">
        <div className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground mb-1">
          Status snapshot
        </div>
        <pre
          className="text-[11px] font-mono bg-muted/40 border border-border rounded-sm p-3 overflow-auto max-h-[40vh] whitespace-pre-wrap break-all"
          data-testid="bm-detail-snapshot"
        >
          {JSON.stringify(row.status_snapshot ?? {}, null, 2)}
        </pre>
      </div>
    </div>
  );
}
