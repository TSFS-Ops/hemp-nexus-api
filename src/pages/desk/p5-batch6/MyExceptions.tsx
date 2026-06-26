/**
 * P-5 Batch 6 — Phase 5: Tenant-safe read-only exception surface.
 *
 * Reads only via Phase 4 safe projection p5b6_list_exceptions_safe.
 * Server-side scope restricts tenants to their own org_id rows.
 * Note bodies and audit bodies are not exposed to tenants by the projection.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Row = {
  id: string;
  exception_type: string;
  queue: string;
  priority: string;
  status: string;
  external_safe_summary: string;
  created_at: string;
};

export default function P5Batch6MyExceptions() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase
      .rpc("p5b6_list_exceptions_safe" as never, { _limit: 50, _offset: 0 } as never)
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
      <h1 className="text-2xl font-semibold">My Exceptions</h1>
      <p className="text-sm text-muted-foreground">
        Read-only view of open exceptions affecting your organisation.
      </p>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && rows?.length === 0 && (
        <p className="text-sm text-muted-foreground">No open exceptions.</p>
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
