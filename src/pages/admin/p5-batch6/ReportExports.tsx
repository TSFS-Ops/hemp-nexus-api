/**
 * P-5 Batch 6 — Phase 5: Report-export ledger summary.
 *
 * Reads only via Phase 4 safe projection p5b6_list_report_exports_safe.
 * Scope payload internals are NEVER projected or rendered.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Row = {
  id: string;
  report_code: string;
  requested_by_role: string;
  status: string;
  requested_at: string;
  completed_at: string | null;
};

export default function P5Batch6ReportExports() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase
      .rpc("p5b6_list_report_exports_safe" as never, { _limit: 100, _offset: 0 } as never)
      .then(({ data, error: e }: any) => {
        if (cancelled) return;
        if (e) setError(e.message);
        else setRows((data ?? []) as Row[]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Report Exports Ledger</h1>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/p5-batch6">Back</Link>
        </Button>
      </header>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && rows?.length === 0 && (
        <p className="text-sm text-muted-foreground">No export records.</p>
      )}
      {!loading && !error && rows && rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="font-mono">{r.report_code}</span>
                <Badge variant="secondary">{r.requested_by_role}</Badge>
                <Badge>{r.status}</Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(r.requested_at).toLocaleString()}
                  {r.completed_at && ` → ${new Date(r.completed_at).toLocaleString()}`}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
