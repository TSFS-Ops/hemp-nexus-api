/**
 * P011 — Reusable "Why this rating?" drawer.
 *
 * Renders the band, plain-English meaning, methodology version, last
 * calculated timestamp, top 3 supporting factors, all checks with status
 * chips, missing inputs, workflow effect, next action, and the verbatim
 * disclaimer. Admin block (full input breakdown, override reason, audit
 * event IDs) is gated by RLS on the source query.
 *
 * The drawer never recalculates — it only reads. Recalculation is event-
 * driven server-side via `compute-evidence-rating`.
 */
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  EVIDENCE_RATING_BAND_LABELS,
  EVIDENCE_RATING_BAND_USER_MEANING,
  EVIDENCE_RATING_DISCLAIMER,
  type EvidenceRatingBand,
} from "@/lib/evidence-rating";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organisationId: string;
  counterpartyId: string;
}

interface SnapshotRow {
  rating_band: EvidenceRatingBand;
  methodology_version: string;
  calculated_at: string;
  freshness_state: string;
  supporting_factors_json: unknown;
  input_summary_json: unknown;
  missing_inputs_json: unknown;
  stale_inputs_json: unknown;
  workflow_effect_json: unknown;
  has_admin_override: boolean;
}

const STATUS_TONE: Record<string, string> = {
  completed: "bg-primary/10 text-primary border-primary/30",
  not_run: "bg-muted text-muted-foreground border-border",
  pending: "bg-secondary text-secondary-foreground border-border",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  expired: "bg-destructive/10 text-destructive border-destructive/30",
  stale: "bg-accent text-accent-foreground border-border",
  not_applicable: "bg-muted text-muted-foreground border-border",
};

export function EvidenceRatingDrawer({
  open,
  onOpenChange,
  organisationId,
  counterpartyId,
}: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["evidence-rating", organisationId, counterpartyId],
    queryFn: async (): Promise<SnapshotRow | null> => {
      const { data, error } = await supabase
        .from("counterparty_evidence_ratings" as never)
        .select(
          "rating_band, methodology_version, calculated_at, freshness_state, supporting_factors_json, input_summary_json, missing_inputs_json, stale_inputs_json, workflow_effect_json, has_admin_override",
        )
        .eq("organisation_id", organisationId)
        .eq("counterparty_id", counterpartyId)
        .maybeSingle();
      if (error) return null;
      return (data as unknown as SnapshotRow) ?? null;
    },
    enabled: open,
  });

  const band: EvidenceRatingBand = data?.rating_band ?? "limited_information";
  const supporting = Array.isArray(data?.supporting_factors_json)
    ? (data!.supporting_factors_json as string[])
    : [];
  const missing = Array.isArray(data?.missing_inputs_json)
    ? (data!.missing_inputs_json as string[])
    : [];
  const stale = Array.isArray(data?.stale_inputs_json)
    ? (data!.stale_inputs_json as string[])
    : [];
  const checks =
    data?.input_summary_json && typeof data.input_summary_json === "object"
      ? (data.input_summary_json as Record<string, { label: string; status: string }>)
      : {};
  const workflow =
    data?.workflow_effect_json && typeof data.workflow_effect_json === "object"
      ? (data.workflow_effect_json as {
          blocks_wad_progression?: boolean;
          requires_admin_review?: boolean;
        })
      : {};

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Why this rating?</SheetTitle>
          <SheetDescription>
            Counterparty Rating Methodology v{data?.methodology_version ?? "1.0"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4 text-sm">
          <div>
            <Badge variant="outline" className="text-sm">
              {EVIDENCE_RATING_BAND_LABELS[band]}
            </Badge>
            <p className="mt-2 text-muted-foreground">
              {EVIDENCE_RATING_BAND_USER_MEANING[band]}
            </p>
          </div>

          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <>
              {data?.calculated_at && (
                <p className="text-xs text-muted-foreground">
                  Last calculated: {new Date(data.calculated_at).toLocaleString()} ·
                  freshness: {data.freshness_state}
                </p>
              )}

              {supporting.length > 0 && (
                <section>
                  <h4 className="font-medium mb-1">Top supporting factors</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    {supporting.slice(0, 3).map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </section>
              )}

              {Object.keys(checks).length > 0 && (
                <section>
                  <h4 className="font-medium mb-1">Checks</h4>
                  <ul className="space-y-1">
                    {Object.entries(checks).map(([k, c]) => (
                      <li key={k} className="flex justify-between items-center">
                        <span>{c.label}</span>
                        <Badge variant="outline" className={STATUS_TONE[c.status] ?? ""}>
                          {c.status.replace(/_/g, " ")}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {missing.length > 0 && (
                <section>
                  <h4 className="font-medium mb-1">Missing for next higher band</h4>
                  <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                    {missing.map((m, i) => (
                      <li key={i}>{m.replace(/_/g, " ")}</li>
                    ))}
                  </ul>
                </section>
              )}

              {stale.length > 0 && (
                <section>
                  <h4 className="font-medium mb-1">Stale inputs</h4>
                  <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                    {stale.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </section>
              )}

              {(workflow.blocks_wad_progression || workflow.requires_admin_review) && (
                <section>
                  <h4 className="font-medium mb-1">Workflow effect</h4>
                  <ul className="list-disc pl-5 space-y-1">
                    {workflow.requires_admin_review && (
                      <li>Admin or compliance review required before progression.</li>
                    )}
                    {workflow.blocks_wad_progression && (
                      <li>WaD progression is held pending review.</li>
                    )}
                  </ul>
                </section>
              )}

              {data?.has_admin_override && (
                <p className="text-xs text-muted-foreground">
                  An admin override is currently in effect on this rating.
                </p>
              )}
            </>
          )}

          <Separator />

          <p className="text-xs text-muted-foreground italic">
            {EVIDENCE_RATING_DISCLAIMER}
          </p>

          <p className="text-xs">
            <Link to="/docs/counterparty-rating-methodology" className="underline">
              Read the full Counterparty Rating Methodology
            </Link>
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
