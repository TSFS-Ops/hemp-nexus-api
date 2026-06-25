/**
 * P-5 Batch 4 Stage 6 — funder workspace (released cases).
 *
 * Lists ONLY cases that have an active, non-revoked, non-expired
 * release to the funder's organisation. Reads via the Stage 3
 * audience-filtered edge function (funder audience). No direct table
 * access, no admin/org-user clients, no cross-funder visibility.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { P5B4FunderShell } from "./components/P5B4FunderShell";
import { P5B4FunderStatusBadge } from "./components/P5B4FunderStatusBadge";
import { P5B4FunderUnavailable } from "./components/P5B4FunderUnavailable";
import {
  p5b4FunderClient,
  type P5B4FunderCaseSummary,
} from "@/lib/p5-batch4/funder-client";

export default function P5Batch4FunderIndex() {
  const [cases, setCases] = useState<P5B4FunderCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await p5b4FunderClient.listReleasedCases();
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
    <P5B4FunderShell
      title="Released cases"
      description="Cases that have been released to your funder organisation for review."
    >
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {error ? <P5B4FunderUnavailable message={error} /> : null}

      <div className="grid grid-cols-1 gap-3" data-testid="p5b4-funder-cases">
        {cases.map((c) => (
          <Card key={c.id} data-testid="p5b4-funder-case-row">
            <CardHeader className="space-y-1">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  <Link
                    className="hover:underline"
                    to={`/funder/p5-batch4/${c.id}`}
                  >
                    {c.case_reference}
                  </Link>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <P5B4FunderStatusBadge kind="execution" value={c.execution_status} />
                  <P5B4FunderStatusBadge kind="release" value={c.release_status} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span>{c.process_type.replace(/_/g, " ")}</span>
              <span>Pack: {c.pack_reference}</span>
              <span>
                Access expires {new Date(c.access_expires_at).toLocaleDateString()}
              </span>
            </CardContent>
          </Card>
        ))}
        {!loading && !error && cases.length === 0 ? (
          <P5B4FunderUnavailable message="No cases have been released to your funder organisation yet." />
        ) : null}
      </div>
    </P5B4FunderShell>
  );
}
