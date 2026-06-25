/**
 * P-5 Batch 4 Stage 4 — read-only audit view.
 *
 * Loads the latest audit events for a chosen case via the Stage 3
 * admin-audience edge function. Append-only — no mutation surfaces.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  p5b4SummaryClient,
  type P5B4AdminAuditEvent,
} from "@/lib/p5-batch4/summary-client";

export default function P5Batch4Audit() {
  const [caseId, setCaseId] = useState("");
  const [events, setEvents] = useState<P5B4AdminAuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await p5b4SummaryClient.getAdminCase(caseId.trim(), ["audit"]);
      setEvents(res.audit ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    if (!caseId) return;
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [caseId, load]);

  return (
    <div className="space-y-4 p-6" data-testid="p5b4-admin-audit">
      <div>
        <h1 className="text-2xl font-semibold">Audit Trail</h1>
        <p className="text-sm text-muted-foreground">
          Append-only events for a Batch 4 case. Read-only.
        </p>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="p5b4-audit-case">Case ID</Label>
          <Input
            id="p5b4-audit-case"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            placeholder="paste case UUID"
          />
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={!caseId.trim()}>
          Reload
        </Button>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {error ? (
        <p className="text-sm text-destructive" data-testid="p5b4-audit-error">
          {error}
        </p>
      ) : null}

      <div className="space-y-2">
        {events.map((e) => (
          <Card key={e.id} data-testid="p5b4-audit-row">
            <CardHeader className="space-y-0.5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{e.event_type}</CardTitle>
                <span className="text-xs text-muted-foreground">
                  {new Date(e.created_at).toLocaleString()}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="text-foreground">{e.external_safe}</div>
              {e.internal ? (
                <div className="font-mono text-xs text-muted-foreground">{e.internal}</div>
              ) : null}
            </CardContent>
          </Card>
        ))}
        {!loading && events.length === 0 && caseId ? (
          <p className="text-sm text-muted-foreground">No events for this case.</p>
        ) : null}
      </div>
    </div>
  );
}
