/**
 * Batch 17 — Readiness blockers view.
 * Uses ReadinessBanner SSOT copy. Never marks anything production-ready.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { REGISTRY_READINESS_LABEL, type RegistryReadinessState } from "@/lib/registry-readiness";
import { REGISTRY_OPS_EMPTY_COPY } from "@/lib/registry-operations-centre-ssot";

interface Blocker {
  id: string; area: string; state: RegistryReadinessState; severity: string;
  safe_reason: string; required_action: string; owner: string | null;
  created_at: string; updated_at: string; linked_business_decision_id: string | null; link: string;
}

export default function AdminRegistryOperationsReadiness() {
  const [items, setItems] = useState<Blocker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("registry-operations-readiness", { body: {} });
        if (error) throw error;
        setItems((data?.blockers ?? []) as Blocker[]);
      } catch (e: any) { setError(e?.message ?? "Failed to load readiness blockers"); }
    })();
  }, []);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">Readiness blockers</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Modules that have not yet reached the accepted production-ready gate. This view never claims anything is verified, live or production-ready.
      </p>
      {error && <Card className="mb-3 border-destructive/50"><CardContent className="p-3 text-sm text-destructive">{error}</CardContent></Card>}
      <Card>
        <CardContent className="p-0">
          <Table data-testid="ops-readiness-table">
            <TableHeader>
              <TableRow>
                <TableHead>Area</TableHead><TableHead>State</TableHead><TableHead>Severity</TableHead>
                <TableHead>Reason</TableHead><TableHead>Required action</TableHead><TableHead>Updated</TableHead><TableHead>Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(items ?? []).map((it) => (
                <TableRow key={it.id} data-testid={`ops-readiness-row-${it.state}`}>
                  <TableCell>{it.area}</TableCell>
                  <TableCell><Badge variant="outline" data-testid={`ops-readiness-state-${it.id}`}>{REGISTRY_READINESS_LABEL[it.state] ?? it.state}</Badge></TableCell>
                  <TableCell>{it.severity}</TableCell>
                  <TableCell className="text-xs">{it.safe_reason}</TableCell>
                  <TableCell className="text-xs">{it.required_action}</TableCell>
                  <TableCell className="text-xs">{new Date(it.updated_at).toLocaleString()}</TableCell>
                  <TableCell><Link className="text-primary hover:underline" to={it.link}>Open →</Link></TableCell>
                </TableRow>
              ))}
              {items !== null && items.length === 0 && <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">{REGISTRY_OPS_EMPTY_COPY.readiness}</TableCell></TableRow>}
              {items === null && !error && <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
