/**
 * Batch 11 — Claimant-facing claims list at /registry/claims.
 * Shows the authenticated user's own claims with workflow_status,
 * SLA, and link to a status detail page.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_DISCLOSURE,
} from "@/lib/registry-claim-workflow";

type Row = {
  id: string;
  workflow_status: string;
  company_name: string;
  company_reference: string;
  country_code: string;
  sla_due_at: string | null;
  created_at: string;
};

export default function RegistryClaimsList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("registry_company_claims")
          .select("id, workflow_status, company_name, company_reference, country_code, sla_due_at, created_at")
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (!cancelled) setRows((data ?? []) as Row[]);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="container mx-auto py-8 space-y-6">
      <ReadinessBanner state="shell_ready" />
      <Card>
        <CardHeader>
          <CardTitle>Your claims</CardTitle>
          <p className="text-sm text-muted-foreground">
            {REGISTRY_CLAIM_APPROVAL_NON_VERIFICATION_DISCLOSURE}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">You have not started any claims yet.</p>
          )}
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between border rounded p-3">
              <div>
                <div className="font-medium">{r.company_name}</div>
                <div className="text-xs text-muted-foreground">
                  {r.company_reference} · {r.country_code}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{r.workflow_status}</Badge>
                <Button asChild size="sm" variant="ghost">
                  <Link to={`/registry/claims/${r.id}`}>View</Link>
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
