/**
 * P-5 Batch 6 — Phase 5: Admin / Governance / Compliance exception workbench.
 *
 * Reads exclusively via Phase 4 safe projections:
 *   - p5b6_get_queue_summary_safe
 *   - p5b6_list_exceptions_safe
 *
 * No direct table reads. No raw metadata, audit payloads, dispute internals
 * or report-export scope internals are rendered.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  P5_BATCH6_REVIEW_QUEUES,
  P5_BATCH6_STATUSES,
  P5_BATCH6_PRIORITIES,
} from "@/lib/p5-batch6-exception-registry";

type ExceptionRow = {
  id: string;
  exception_type: string;
  queue: string;
  priority: string;
  status: string;
  external_safe_summary: string;
  org_id: string | null;
  assigned_to_role: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

type QueueSummaryRow = {
  queue: string;
  priority: string;
  status: string;
  open_count: number;
};

const ANY = "__any__";

export default function P5Batch6Workbench() {
  const [queue, setQueue] = useState<string>(ANY);
  const [status, setStatus] = useState<string>(ANY);
  const [priority, setPriority] = useState<string>(ANY);
  const [rows, setRows] = useState<ExceptionRow[] | null>(null);
  const [summary, setSummary] = useState<QueueSummaryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      supabase.rpc("p5b6_list_exceptions_safe" as never, {
        _limit: 100,
        _offset: 0,
        _queue: queue === ANY ? null : queue,
        _status: status === ANY ? null : status,
        _priority: priority === ANY ? null : priority,
      } as never),
      supabase.rpc("p5b6_get_queue_summary_safe" as never, {} as never),
    ])
      .then(([listRes, sumRes]: any[]) => {
        if (cancelled) return;
        if (listRes.error) {
          setError(listRes.error.message);
        } else {
          setRows((listRes.data ?? []) as ExceptionRow[]);
        }
        if (!sumRes.error) {
          setSummary((sumRes.data ?? []) as QueueSummaryRow[]);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load exceptions");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [queue, status, priority]);

  const queueTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of summary ?? []) {
      map.set(r.queue, (map.get(r.queue) ?? 0) + Number(r.open_count));
    }
    return map;
  }, [summary]);

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Exceptions Workbench</h1>
          <p className="text-sm text-muted-foreground">
            Governance review queues — safe projection only.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/p5-batch6/exports">Report exports ledger</Link>
        </Button>
      </header>

      <section aria-label="Queue summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {P5_BATCH6_REVIEW_QUEUES.map((q) => (
          <Card key={q}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{q}</CardTitle>
              <CardDescription className="text-2xl font-semibold text-foreground">
                {queueTotals.get(q) ?? 0}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="flex flex-wrap gap-3" aria-label="Filters">
        <FilterSelect label="Queue" value={queue} onChange={setQueue} options={P5_BATCH6_REVIEW_QUEUES} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={P5_BATCH6_STATUSES} />
        <FilterSelect label="Priority" value={priority} onChange={setPriority} options={P5_BATCH6_PRIORITIES} />
      </section>

      <section aria-label="Exceptions">
        {loading && <p className="text-sm text-muted-foreground">Loading exceptions…</p>}
        {error && (
          <Card className="border-destructive">
            <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}
        {!loading && !error && rows?.length === 0 && (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No exceptions match the current filters.
            </CardContent>
          </Card>
        )}
        {!loading && !error && rows && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((r) => (
              <Link
                key={r.id}
                to={`/admin/p5-batch6/exceptions/${r.id}`}
                className="block"
              >
                <Card className="transition-colors hover:border-foreground">
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <Badge variant="outline">{r.priority}</Badge>
                    <Badge variant="secondary">{r.queue}</Badge>
                    <span className="font-medium">{r.exception_type}</span>
                    <span className="text-sm text-muted-foreground">{r.status}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
