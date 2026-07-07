/**
 * Batch V-UI -- Admin manual-review queue for IDV cases.
 *
 * platform_admin only. Lists idv_person cases requiring review; opening
 * a case shows document context and lets the admin record a decision via
 * the existing `idv-manual-review` edge function.
 *
 * Batch V-UI-Fix-4: `p5scr_manual_reviews` is the source of truth for
 * user-opened IDV manual-review cases. This queue now reads OPEN
 * (undecided) idv_person cases directly from that table instead of
 * `p5scr_check_results`, which nothing in the person-IDV flow writes to.
 * Admin decisions still go through `idv-manual-review`, which now also
 * projects the resolved state into the gate-readable `p5scr_idv_records`
 * table -- so there is a single source of truth end-to-end and no
 * split-brain between what the admin sees/approves and what the user/
 * gate reads.
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

export default function IdvReviewQueue() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      // Batch V-UI-Fix-4: read OPEN idv_person cases from
      // p5scr_manual_reviews -- the true source of truth for
      // user-opened manual-review cases. decided_at IS NULL means the
      // case is still awaiting an admin decision.
      const { data: reviews, error: rErr } = await supabase
        .from("p5scr_manual_reviews")
        .select("id, subject_id, reason, opened_at, updated_at")
        .eq("category", "idv_person")
        .is("decided_at", null)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (rErr) throw rErr;

      const results: QueueRow[] = [];
      for (const r of reviews ?? []) {
        const subjectId = r.subject_id as string;
        const { data: subj } = await supabase
          .from("p5scr_subjects")
          .select("display_label")
          .eq("id", subjectId)
          .maybeSingle();
        results.push({
          subject_id: subjectId,
          display_label: (subj?.display_label as string) ?? null,
          // An open, undecided case is always "manual review required"
          // from the admin's perspective -- this is the safe, generic
          // status for anything still awaiting a decision.
          latest_state: "manual_review_required",
          updated_at: (r.updated_at as string) ?? (r.opened_at as string) ?? null,
        });
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
