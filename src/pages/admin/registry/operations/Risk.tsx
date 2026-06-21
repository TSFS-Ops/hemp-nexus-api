/**
 * Batch 17 — Operations risk view.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_OPS_RISK_CATEGORY_LABEL,
  REGISTRY_OPS_SEVERITY_LABEL,
  REGISTRY_OPS_SEVERITY_TONE,
  REGISTRY_OPS_EMPTY_COPY,
  safeRiskLabel,
} from "@/lib/registry-operations-centre-ssot";

interface RiskItem {
  id: string; category: string; severity: string; module: string;
  company_name: string | null; country: string | null;
  safe_reason: string; created_at: string; status: string; owner: string | null; link: string;
}

function variant(s: string) {
  const tone = (REGISTRY_OPS_SEVERITY_TONE as Record<string, string>)[s] ?? "neutral";
  if (tone === "danger") return "destructive" as const;
  if (tone === "warn") return "secondary" as const;
  return "outline" as const;
}

export default function AdminRegistryOperationsRisk() {
  const [items, setItems] = useState<RiskItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("registry-operations-risk", { body: {} });
        if (error) throw error;
        setItems((data?.items ?? []) as RiskItem[]);
      } catch (e: any) { setError(e?.message ?? "Failed to load risk view"); }
    })();
  }, []);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">Registry risk</h1>
      <p className="text-sm text-muted-foreground mb-4">Safe risk items across registry modules. No raw bank details, no full API keys, no provider payloads.</p>
      {error && <Card className="mb-3 border-destructive/50"><CardContent className="p-3 text-sm text-destructive">{error}</CardContent></Card>}
      <Card>
        <CardContent className="p-0">
          <Table data-testid="ops-risk-table">
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead><TableHead>Module</TableHead><TableHead>Severity</TableHead>
                <TableHead>Status</TableHead><TableHead>Reason</TableHead><TableHead>Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(items ?? []).map((it) => (
                <TableRow key={it.id} data-testid={`ops-risk-row-${it.category}`}>
                  <TableCell>{safeRiskLabel(it.category)}</TableCell>
                  <TableCell>{it.module}</TableCell>
                  <TableCell><Badge variant={variant(it.severity)}>{(REGISTRY_OPS_SEVERITY_LABEL as Record<string, string>)[it.severity] ?? it.severity}</Badge></TableCell>
                  <TableCell>{it.status}</TableCell>
                  <TableCell className="text-xs">{it.safe_reason}</TableCell>
                  <TableCell><Link className="text-primary hover:underline" to={it.link}>Open →</Link></TableCell>
                </TableRow>
              ))}
              {items !== null && items.length === 0 && <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">{REGISTRY_OPS_EMPTY_COPY.risk}</TableCell></TableRow>}
              {items === null && !error && <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
