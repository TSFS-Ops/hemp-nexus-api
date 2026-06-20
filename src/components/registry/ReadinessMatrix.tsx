/**
 * Batch 1 — Admin readiness matrix (M019). Lists every Business Registry
 * module with its current readiness state and last change.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { ReadinessBadge } from "./ReadinessBadge";
import type { RegistryReadinessState } from "@/lib/registry-readiness";
import { ReadinessTransitionDialog } from "./ReadinessTransitionDialog";
import { Button } from "@/components/ui/button";

interface ModuleRow {
  module_code: string;
  module_name: string;
  category: string;
  current_state: RegistryReadinessState;
  updated_at: string;
}

export function ReadinessMatrix({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<ModuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ModuleRow | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("registry_modules")
        .select("module_code, module_name, category, current_state, updated_at")
        .order("module_code", { ascending: true });
      setRows((data ?? []) as ModuleRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Module readiness matrix</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Last change</TableHead>
                {canEdit && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.module_code} data-testid={`module-row-${r.module_code}`}>
                  <TableCell className="font-mono text-xs">{r.module_code}</TableCell>
                  <TableCell>{r.module_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.category}</TableCell>
                  <TableCell><ReadinessBadge state={r.current_state} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.updated_at).toLocaleString()}
                  </TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                        Change state
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {editing && (
          <ReadinessTransitionDialog
            module={editing}
            open={!!editing}
            onOpenChange={(v) => !v && setEditing(null)}
            onChanged={() => { setEditing(null); void load(); }}
          />
        )}
      </CardContent>
    </Card>
  );
}
