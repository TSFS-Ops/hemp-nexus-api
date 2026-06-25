/**
 * P-5 Batch 5 — Phase 5
 * Organisation Finality view.
 *
 * Shows only records available to the user's organisation. Internal
 * platform notes, unshared funder notes, raw provider payloads and other
 * organisations' records are never rendered.
 */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import P5B5WarningBanners from "@/components/p5-batch5/WarningBanners";
import P5B5MemoryHistoryPanel, {
  type P5B5MemoryHistoryRow,
  type P5B5MemoryHistorySummary,
} from "@/components/p5-batch5/MemoryHistoryPanel";
import P5B5ApiSafePreviewPanel from "@/components/p5-batch5/ApiSafePreviewPanel";
import P5B5ReasonedActionDialog from "@/components/p5-batch5/ReasonedActionDialog";
import {
  canExportP5B5,
  canPerformFinalityAction,
  type P5B5Role,
} from "@/lib/p5-batch5/permissions";
import { P5B5_APPROVED_PHRASES } from "@/lib/p5-batch5/wording";
import type { P5B5ProjectionInput } from "@/lib/p5-batch5/api-safe";

const ORG_ROLE: P5B5Role = "organisation_owner_admin";

const EMPTY_PROJECTION: P5B5ProjectionInput = {
  finality_status: "none",
  memory_status: "not_written",
  dispute_status: "none",
  correction_status: "none",
};

const EMPTY_SUMMARY: P5B5MemoryHistorySummary = {
  subject_label: "Your organisation",
  current_memory_status: "not_written",
  confidence_marker: null,
  latest_finality_status: null,
  latest_outcome_code: null,
  evidence_rating: null,
  has_open_dispute: false,
  has_open_correction: false,
  final_record_count: 0,
  last_updated_at: null,
  permitted_reliance_level: "operational",
};

const EMPTY_ROWS: ReadonlyArray<P5B5MemoryHistoryRow> = [];

export default function OrganisationFinality() {
  // Same-org context is required for organisation roles to see any caps.
  // The actual organisation id is resolved by the data hook (not wired here).
  const ctx = { acting_organisation_id: "self", record_organisation_id: "self" };
  const [dialog, setDialog] = useState<null | "mark_dispute" | "request_dispute_correction">(null);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Finality &amp; Memory</h1>
        <p className="text-sm text-muted-foreground">
          {P5B5_APPROVED_PHRASES.EVIDENCE_BASIS}
        </p>
      </div>

      <P5B5WarningBanners input={EMPTY_PROJECTION} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your organisation&apos;s finality records</CardTitle>
          <CardDescription>
            Only records belonging to your organisation are shown. Other organisations&apos;
            records, internal platform notes and raw provider payloads are never displayed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {canPerformFinalityAction(ORG_ROLE, "mark_dispute", ctx) && (
              <Button size="sm" variant="outline" onClick={() => setDialog("mark_dispute")} data-p5b5-action="mark_dispute">
                Mark Under Dispute
              </Button>
            )}
            {canPerformFinalityAction(ORG_ROLE, "request_finality", ctx) && (
              <Button size="sm" variant="outline" data-p5b5-action="request_finality">
                Request Finality
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setDialog("request_dispute_correction")} data-p5b5-action="request_correction">
              Request Correction
            </Button>
            {canExportP5B5(ORG_ROLE, "finality_summary", ctx) && (
              <Button size="sm" variant="outline" data-p5b5-action="export_finality_summary">
                Export My Finality Summary
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <P5B5MemoryHistoryPanel role={ORG_ROLE} context={ctx} summary={EMPTY_SUMMARY} rows={EMPTY_ROWS} />

      <P5B5ApiSafePreviewPanel role={ORG_ROLE} context={ctx} input={EMPTY_PROJECTION} />

      {dialog && (
        <P5B5ReasonedActionDialog
          open={dialog !== null}
          onOpenChange={(o) => !o && setDialog(null)}
          action={dialog}
          permitted={dialog === "mark_dispute" ? canPerformFinalityAction(ORG_ROLE, "mark_dispute", ctx) : true}
          onSubmit={async () => {
            // Wired to the guarded Phase 2 RPC by a follow-up data hook.
          }}
        />
      )}
    </div>
  );
}
