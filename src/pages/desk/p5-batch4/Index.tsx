/**
 * P-5 Batch 4 Stage 5 — organisation / counterparty user case list.
 *
 * Surfaces ONLY cases the calling user is authorised to see. Reads via
 * the Stage 3 audience-filtered edge function (org_user audience). Does
 * NOT touch p5_batch4_* tables directly and does NOT call admin-only
 * RPC wrappers.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { P5B4DeskStatusBadge } from "./components/P5B4DeskStatusBadge";
import {
  p5b4OrgUserClient,
  type P5B4OrgUserCaseSummary,
} from "@/lib/p5-batch4/org-user-client";

export default function P5Batch4DeskIndex() {
  const [cases, setCases] = useState<P5B4OrgUserCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await p5b4OrgUserClient.listMyCases();
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
    <div className="space-y-4" data-testid="p5b4-desk-cases">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">My cases</h1>
          <p className="text-sm text-muted-foreground">
            Track the cases you are responsible for, see current status and
            upload any documents we have asked for.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {error ? (
        <p className="text-sm text-destructive" data-testid="p5b4-desk-cases-error">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3">
        {cases.map((c) => (
          <Card key={c.id} data-testid="p5b4-desk-case-row">
            <CardHeader className="space-y-1">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  <Link
                    className="hover:underline"
                    to={`/desk/p5-batch4/${c.id}`}
                  >
                    {c.case_reference}
                  </Link>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <P5B4DeskStatusBadge kind="execution" value={c.execution_status} />
                  <P5B4DeskStatusBadge kind="readiness" value={c.readiness_status} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span>{c.process_type.replace(/_/g, " ")}</span>
              {c.blocker_count > 0 ? (
                <span className="text-destructive">
                  {c.blocker_count} item{c.blocker_count === 1 ? "" : "s"} need attention
                </span>
              ) : null}
              {c.due_at ? (
                <span>Due {new Date(c.due_at).toLocaleDateString()}</span>
              ) : null}
            </CardContent>
          </Card>
        ))}
        {!loading && cases.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="p5b4-desk-cases-empty">
            You have no active cases.
          </p>
        ) : null}
      </div>
    </div>
  );
}
