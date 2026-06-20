/**
 * Batch 2 — Admin Provenance tab (M010). Lists registry data sources.
 * Read-only list view; record/edit goes through the
 * registry-provenance-record edge function (admin/compliance only).
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { REGISTRY_SOURCE_TYPE_LABEL, type RegistrySourceType } from "@/lib/registry-provenance";

interface SourceRow {
  id: string;
  source_name: string;
  source_type: RegistrySourceType;
  countries: string[] | null;
  licence_status: string;
  public_display_allowed: boolean;
  api_output_allowed: boolean;
  updated_at: string;
}

export function ProvenanceSourceList() {
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from("registry_data_sources" as never)
          .select("id, source_name, source_type, countries, licence_status, public_display_allowed, api_output_allowed, updated_at")
          .order("source_name", { ascending: true });
        setRows((data ?? []) as unknown as SourceRow[]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registry data sources</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Presence in any data source does not imply that a record has been
          checked. Every field-level entry must record its own confidence and
          verification level.
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sources recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Countries</TableHead>
                <TableHead>Licence</TableHead>
                <TableHead>Public display</TableHead>
                <TableHead>API output</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} data-testid={`source-row-${r.id}`}>
                  <TableCell className="font-medium">{r.source_name}</TableCell>
                  <TableCell className="text-xs">{REGISTRY_SOURCE_TYPE_LABEL[r.source_type] ?? r.source_type}</TableCell>
                  <TableCell className="text-xs font-mono">{(r.countries ?? []).join(", ") || "—"}</TableCell>
                  <TableCell><Badge variant="outline">{r.licence_status}</Badge></TableCell>
                  <TableCell>{r.public_display_allowed ? "Allowed" : "Not allowed"}</TableCell>
                  <TableCell>{r.api_output_allowed ? "Allowed" : "Not allowed"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
