/**
 * Batch V-UI — Admin manual-review queue for IDV cases.
 *
 * platform_admin only. Lists idv_person cases requiring review; opening
 * a case shows document context and lets the admin record a decision via
 * the existing `idv-manual-review` edge function.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { idvSafeLabel } from "@/components/idv/idv-status-labels";
import { IdvReviewCase } from "./IdvReviewCase";

interface QueueRow {
  subject_id: string;
  display_label: string | null;
  latest_state: string;
  updated_at: string | null;
}

const REVIEWABLE_STATES = new Set([
  "manual_review_required",
  "blocked_pending_admin_decision",
  "provider_error",
  "provider_pending",
  "provider_not_available",
]);

export default function IdvReviewQueue() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const { data: subjects, error: sErr } = await supabase
        .from("p5scr_subjects")
        .select("id, display_label, updated_at")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (sErr) throw sErr;

      const results: QueueRow[] = [];
      for (const s of subjects ?? []) {
        const { data: check } = await supabase
          .from("p5scr_check_results")
          .select("state, decided_at, category")
          .eq("subject_id", s.id)
          .eq("category", "idv_person")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const state = (check?.state as string) ?? "pending";
        if (REVIEWABLE_STATES.has(state)) {
          results.push({
            subject_id: s.id,
            display_label: (s.display_label as string) ?? null,
            latest_state: state,
            updated_at: (check?.decided_at as string) ?? (s.updated_at as string),
          });
        }
      }
      setRows(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load queue");
      setRows([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (selected) {
    return (
      <IdvReviewCase
        subjectId={selected}
        onBack={() => {
          setSelected(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">IDV manual review</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Category: idv_person. Person-only decisions. Does not verify the
            company.
          </p>
        </div>
        <Button variant="ghost" onClick={() => navigate("/desk")}>Close</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cases requiring review</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {rows === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {rows && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No cases awaiting review.</p>
          )}
          {rows && rows.length > 0 && (
            <table className="w-full text-sm" data-testid="idv-review-queue">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2">Person</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Updated</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.subject_id} className="border-b">
                    <td className="py-2">{r.display_label ?? r.subject_id.slice(0, 8)}</td>
                    <td className="py-2">
                      <Badge variant="secondary">{idvSafeLabel(r.latest_state).label}</Badge>
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {r.updated_at ? new Date(r.updated_at).toLocaleString() : "—"}
                    </td>
                    <td className="py-2 text-right">
                      <Button size="sm" onClick={() => setSelected(r.subject_id)}>Open</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
