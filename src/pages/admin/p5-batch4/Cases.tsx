/**
 * P-5 Batch 4 Stage 4 — admin case list.
 *
 * Reads via the Stage 3 audience-filtered edge function (admin scope).
 * Does NOT touch batch-4 tables directly.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { P5B4StatusBadge } from "./components/P5B4StatusBadge";
import {
  p5b4SummaryClient,
  type P5B4AdminCaseSummary,
} from "@/lib/p5-batch4/summary-client";

export default function P5Batch4Cases() {
  const [cases, setCases] = useState<P5B4AdminCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await p5b4SummaryClient.listAdminCases();
      setCases(res.cases);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4 p-6" data-testid="p5b4-admin-cases">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Execution Cases</h1>
          <p className="text-sm text-muted-foreground">
            Admin-safe summary. Provider-dependent items render as Provider-Dependent.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {error ? (
        <p className="text-sm text-destructive" data-testid="p5b4-cases-error">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3">
        {cases.map((c) => (
          <Card key={c.id} data-testid="p5b4-case-row">
            <CardHeader className="space-y-1">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  <Link
                    className="hover:underline"
                    to={`/admin/p5-batch4/cases/${c.id}`}
                  >
                    {c.case_reference}
                  </Link>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <P5B4StatusBadge kind="execution" value={c.execution_status} />
                  <P5B4StatusBadge kind="readiness" value={c.readiness_status} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span>Process: {c.process_type.replace(/_/g, " ")}</span>
              <span>Blockers: {c.blocker_count}</span>
              <span>Warnings: {c.warning_count}</span>
              {c.due_at ? <span>Due: {new Date(c.due_at).toLocaleDateString()}</span> : null}
            </CardContent>
          </Card>
        ))}
        {!loading && cases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cases yet.</p>
        ) : null}
      </div>
    </div>
  );
}
