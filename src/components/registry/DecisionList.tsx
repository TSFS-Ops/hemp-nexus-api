/**
 * Batch 1 — Business decision register list (M018).
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  BUSINESS_DECISION_CATEGORY_LABEL,
  BUSINESS_DECISION_STATUS_LABEL,
  type BusinessDecisionRow,
} from "@/lib/business-decisions";
import { DecisionForm } from "./DecisionForm";

export function DecisionList({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<BusinessDecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("business_decisions")
        .select("*")
        .order("created_at", { ascending: false });
      setRows((data ?? []) as BusinessDecisionRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Business decision register</CardTitle>
        {canEdit && (
          <Button size="sm" onClick={() => setCreating(true)}>Record decision</Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No business decisions recorded yet. Decisions about country approval, data sources,
            providers, public display, API output, outreach use, commercial use,
            institutional demos and wording will appear here once recorded.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} data-testid={`decision-row-${r.id}`}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell className="text-xs">
                    {BUSINESS_DECISION_CATEGORY_LABEL[r.category]}
                  </TableCell>
                  <TableCell className="text-xs">
                    {BUSINESS_DECISION_STATUS_LABEL[r.status]}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.effective_at ? new Date(r.effective_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.review_at ? new Date(r.review_at).toLocaleDateString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {creating && (
          <DecisionForm
            open={creating}
            onOpenChange={setCreating}
            onCreated={() => { setCreating(false); void load(); }}
          />
        )}
      </CardContent>
    </Card>
  );
}
