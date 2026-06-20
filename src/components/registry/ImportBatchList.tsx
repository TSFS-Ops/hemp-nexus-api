/**
 * Batch 2 — Admin Import Batch list (M012). Lists controlled import batches
 * and their current lifecycle state. Mutations go through the
 * registry-import-batch-manage edge function.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { IMPORT_BATCH_STATE_LABEL, type ImportBatchState } from "@/lib/registry-import-batches";

interface BatchRow {
  id: string;
  batch_reference: string;
  country_code: string | null;
  state: ImportBatchState;
  schema_version: string;
  updated_at: string;
}

export function ImportBatchList() {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from("registry_import_batches" as never)
          .select("id, batch_reference, country_code, state, schema_version, updated_at")
          .order("updated_at", { ascending: false });
        setRows((data ?? []) as unknown as BatchRow[]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import batches</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          No import batch may become publicly visible automatically.
          Publication requires an approved business decision and recorded
          evidence link.
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No import batches recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Schema</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Last change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} data-testid={`batch-row-${r.id}`}>
                  <TableCell className="font-mono text-xs">{r.batch_reference}</TableCell>
                  <TableCell className="text-xs">{r.country_code ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.schema_version}</TableCell>
                  <TableCell><Badge variant="outline">{IMPORT_BATCH_STATE_LABEL[r.state] ?? r.state}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.updated_at).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
