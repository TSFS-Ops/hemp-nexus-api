/**
 * P-5 Batch 6 — Phase 5: Funder-safe read-only exception surface.
 *
 * Reads only via Phase 4 safe projection p5b6_list_exceptions_safe.
 * Server-side scope restricts funders to funder_escalation queue and
 * FUNDER_REVIEW_EXCEPTION type. Note/audit bodies are not projected.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LegacyBanner } from "@/lib/funder-workspace/ui";

type Row = {
  id: string;
  exception_type: string;
  queue: string;
  priority: string;
  status: string;
  external_safe_summary: string;
  created_at: string;
};

export default function P5Batch6FunderExceptions() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: e } = await (supabase.rpc as any)(
        "p5b6_list_exceptions_safe",
        { _limit: 50, _offset: 0 },
      );
      if (cancelled) return;
      if (e) setError(e.message);
      else setRows((data ?? []) as Row[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);


  return (
    <div className="space-y-4 p-6">
      <LegacyBanner surface="P-5 Batch 6 exceptions" />
      <h1 className="text-2xl font-semibold">Funder Exceptions</h1>
      <p className="text-sm text-muted-foreground">
        Read-only view of funder-relevant exceptions.
      </p>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && rows?.length === 0 && (
        <p className="text-sm text-muted-foreground">No funder-relevant exceptions.</p>
      )}
      {!loading && !error && rows && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <Badge variant="outline">{r.priority}</Badge>
                <Badge variant="secondary">{r.queue}</Badge>
                <span className="font-medium">{r.exception_type}</span>
                <span className="text-muted-foreground">{r.status}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
