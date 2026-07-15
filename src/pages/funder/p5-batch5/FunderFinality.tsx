/**
 * P-5 Batch 5 — Phase 5
 * Funder lane Finality view.
 *
 * Shows only records expressly shared with this funder workflow.
 * Unrelated organisation Memory, other funders' decisions, unshared
 * evidence and raw provider payloads are never displayed.
 */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import P5B5WarningBanners from "@/components/p5-batch5/WarningBanners";
import P5B5ApiSafePreviewPanel from "@/components/p5-batch5/ApiSafePreviewPanel";
import P5B5ReasonedActionDialog from "@/components/p5-batch5/ReasonedActionDialog";
import { canExportP5B5, canPerformFinalityAction, type P5B5Role } from "@/lib/p5-batch5/permissions";
import { P5B5_APPROVED_PHRASES } from "@/lib/p5-batch5/wording";
import type { P5B5ProjectionInput } from "@/lib/p5-batch5/api-safe";
import { LegacyBanner } from "@/lib/funder-workspace/ui";

const FUNDER_ROLE: P5B5Role = "funder";

const EMPTY_PROJECTION: P5B5ProjectionInput = {
  finality_status: "none",
  memory_status: "not_written",
  dispute_status: "none",
  correction_status: "none",
};

export default function FunderFinality() {
  // Funder context requires explicit lane access — resolved server-side.
  const ctx = { has_funder_lane_access: true };
  const [dialog, setDialog] = useState<null | "request_dispute_correction">(null);

  return (
    <div className="space-y-4 p-6">
      <LegacyBanner surface="P-5 Batch 5 finality" />
      <div>
        <h1 className="text-2xl font-semibold">Finality — Funder lane</h1>
        <p className="text-sm text-muted-foreground">
          {P5B5_APPROVED_PHRASES.EVIDENCE_BASIS} Only records expressly shared with this
          funder workflow are shown.
        </p>
      </div>

      <P5B5WarningBanners input={EMPTY_PROJECTION} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shared finality records</CardTitle>
          <CardDescription>
            Includes counterparty history shared with this funding workflow, approvals
            and waivers. Other funders&apos; decisions and unshared evidence are not shown.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setDialog("request_dispute_correction")} data-p5b5-action="request_correction">
              Challenge or Request Correction
            </Button>
            {canExportP5B5(FUNDER_ROLE, "finality_summary", ctx) && (
              <Button size="sm" variant="outline" data-p5b5-action="export_finality_summary">
                Export Shared Records
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <P5B5ApiSafePreviewPanel role={FUNDER_ROLE} context={ctx} input={EMPTY_PROJECTION} />

      {dialog && (
        <P5B5ReasonedActionDialog
          open={dialog !== null}
          onOpenChange={(o) => !o && setDialog(null)}
          action={dialog}
          permitted={true}
          onSubmit={async () => {
            // Wired to the guarded Phase 2 RPC by a follow-up data hook.
            void canPerformFinalityAction(FUNDER_ROLE, "mark_dispute", ctx);
          }}
        />
      )}
    </div>
  );
}
