/**
 * Batch 17 — Operations SLA view.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  REGISTRY_OPS_SLA_LABEL,
  REGISTRY_OPS_SLA_TONE,
  REGISTRY_OPS_WORK_ITEM_LABEL,
  REGISTRY_OPS_EMPTY_COPY,
} from "@/lib/registry-operations-centre-ssot";

interface SlaItem {
  id: string; work_item_type: string; source_module: string;
  age_hours: number; sla_hours: number | null; sla_state: string;
  due_at: string | null; overdue_hours: number; link: string;
}

function variant(state: string) {
  const tone = (REGISTRY_OPS_SLA_TONE as Record<string, string>)[state] ?? "neutral";
  if (tone === "danger") return "destructive" as const;
  if (tone === "warn") return "secondary" as const;
  return "outline" as const;
}

export default function AdminRegistryOperationsSlas() {
  const [items, setItems] = useState<SlaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("registry-operations-slas", { body: {} });
        if (error) throw error;
        setItems((data?.items ?? []) as SlaItem[]);
      } catch (e: any) { setError(e?.message ?? "Failed to load SLA view"); }
    })();
  }, []);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">SLA view</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Default SLA guidance for registry work. SLAs never trigger automatic approvals — they only highlight overdue work.
      </p>
      {error && <Card className="mb-3 border-destructive/50"><CardContent className="p-3 text-sm text-destructive">{error}</CardContent></Card>}
      <Card>
        <CardContent className="p-0">
          <Table data-testid="ops-slas-table">
            <TableHeader>
              <TableRow>
                <TableHead>Work item</TableHead><TableHead>Module</TableHead><TableHead>SLA</TableHead>
                <TableHead>Age</TableHead><TableHead>Due</TableHead><TableHead>Overdue</TableHead><TableHead>Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(items ?? []).map((it) => (
                <TableRow key={it.id} data-testid={`ops-sla-row-${it.sla_state}`}>
                  <TableCell>{(REGISTRY_OPS_WORK_ITEM_LABEL as Record<string, string>)[it.work_item_type] ?? it.work_item_type}</TableCell>
                  <TableCell>{it.source_module}</TableCell>
                  <TableCell><Badge variant={variant(it.sla_state)} data-testid={`ops-sla-badge-${it.id}`}>{(REGISTRY_OPS_SLA_LABEL as Record<string, string>)[it.sla_state] ?? it.sla_state}</Badge></TableCell>
                  <TableCell>{it.age_hours}h</TableCell>
                  <TableCell className="text-xs">{it.due_at ? new Date(it.due_at).toLocaleString() : "—"}</TableCell>
                  <TableCell>{it.overdue_hours > 0 ? `${it.overdue_hours}h` : "—"}</TableCell>
                  <TableCell><Link className="text-primary hover:underline" to={it.link}>Open →</Link></TableCell>
                </TableRow>
              ))}
              {items !== null && items.length === 0 && <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">{REGISTRY_OPS_EMPTY_COPY.slas}</TableCell></TableRow>}
              {items === null && !error && <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
