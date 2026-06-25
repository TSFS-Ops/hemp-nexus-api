/**
 * P-5 Batch 5 — Phase 5
 * Admin Finality & Memory page.
 *
 * Display + action surface over the Phase 1-4 foundations. The UI never
 * mutates finality rows directly: every action opens a reasoned-action
 * dialog whose submit handler is expected to call the corresponding
 * Phase 1-3 guarded RPC. Defensive permission gating is also applied at
 * action button level, mirroring `permissions.ts`.
 */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import P5B5WarningBanners from "@/components/p5-batch5/WarningBanners";
import P5B5ReasonedActionDialog, { type P5B5DialogAction } from "@/components/p5-batch5/ReasonedActionDialog";
import P5B5ApiSafePreviewPanel from "@/components/p5-batch5/ApiSafePreviewPanel";
import P5B5MemoryHistoryPanel, {
  type P5B5MemoryHistoryRow,
  type P5B5MemoryHistorySummary,
} from "@/components/p5-batch5/MemoryHistoryPanel";
import {
  canExportP5B5,
  canPerformFinalityAction,
  type P5B5FinalityAction,
  type P5B5Role,
} from "@/lib/p5-batch5/permissions";
import { P5B5_FINALITY_STATUS_LABELS } from "@/lib/p5-batch5/outcomes";
import { P5B5_APPROVED_PHRASES } from "@/lib/p5-batch5/wording";
import type { P5B5ProjectionInput } from "@/lib/p5-batch5/api-safe";

// Admin context — server-side RLS is authoritative. Client role is read
// from the platform admin guard at the route layer; we display as super-admin
// here so all actions appear, then defensively re-check inside each handler.
const ADMIN_ROLE: P5B5Role = "platform_super_admin";

const ACTIONS: { key: P5B5DialogAction; action: P5B5FinalityAction | null; label: string }[] = [
  { key: "create_finality", action: "create_finality", label: "Create Finality Record" },
  { key: "add_correction", action: "add_correction", label: "Add Correction Record" },
  { key: "mark_dispute", action: "mark_dispute", label: "Mark Under Dispute" },
  { key: "resolve_dispute", action: "resolve_dispute", label: "Resolve Dispute" },
  { key: "supersede_finality", action: "supersede_finality", label: "Supersede Finality" },
  { key: "administrative_reclassification", action: "add_correction", label: "Administrative Reclassification" },
];

// Display fixture — production wiring fetches via server-side function.
// This page intentionally avoids querying p5_batch4_finality_records
// directly; data is shaped server-side and passed in.
const EMPTY_PROJECTION: P5B5ProjectionInput = {
  finality_status: "none",
  final_outcome_code: null,
  memory_status: "not_written",
  dispute_status: "none",
  correction_status: "none",
};

const EMPTY_SUMMARY: P5B5MemoryHistorySummary = {
  subject_label: "—",
  current_memory_status: "not_written",
  confidence_marker: null,
  latest_finality_status: null,
  latest_outcome_code: null,
  evidence_rating: null,
  has_open_dispute: false,
  has_open_correction: false,
  final_record_count: 0,
  last_updated_at: null,
  permitted_reliance_level: "audit",
};

const EMPTY_ROWS: ReadonlyArray<P5B5MemoryHistoryRow> = [];

export default function P5Batch5FinalityMemory() {
  const [dialog, setDialog] = useState<P5B5DialogAction | null>(null);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Finality & Memory — Admin</h1>
        <p className="text-sm text-muted-foreground">
          Platform-admin governance surface for P-5 Batch 5. Actions go through the
          guarded RPC pathway and cannot mutate finality rows directly.
        </p>
      </div>

      <P5B5WarningBanners input={EMPTY_PROJECTION} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Finality records</CardTitle>
          <CardDescription>
            Locked snapshots produced after evidence, approvals and controls are completed
            or waived. {P5B5_APPROVED_PHRASES.EVIDENCE_BASIS}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map((a) => {
              const permitted = a.action
                ? canPerformFinalityAction(ADMIN_ROLE, a.action)
                : true;
              if (!permitted) return null;
              return (
                <Button
                  key={a.key}
                  size="sm"
                  variant="outline"
                  onClick={() => setDialog(a.key)}
                  data-p5b5-action={a.key}
                >
                  {a.label}
                </Button>
              );
            })}
            {canExportP5B5(ADMIN_ROLE, "finality_summary") && (
              <Button size="sm" variant="outline" data-p5b5-action="export_finality_summary">
                Export Finality Summary
              </Button>
            )}
            {canExportP5B5(ADMIN_ROLE, "audit_pack") && (
              <Button size="sm" variant="outline" data-p5b5-action="export_audit_pack">
                Export Audit Pack
              </Button>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Finality ID</TableHead>
                <TableHead>Case</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead>Counterparty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Compliance</TableHead>
                <TableHead>Funder</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Memory</TableHead>
                <TableHead>Dispute</TableHead>
                <TableHead>Correction</TableHead>
                <TableHead>Current</TableHead>
                <TableHead>Superseded by</TableHead>
                <TableHead>Audit ref</TableHead>
                <TableHead>schema</TableHead>
                <TableHead>outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={20} className="text-center text-muted-foreground">
                  No finality records visible. Server-side listing is loaded by the
                  page&apos;s data hook (not wired in this scaffold).
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <P5B5MemoryHistoryPanel
        role={ADMIN_ROLE}
        summary={EMPTY_SUMMARY}
        rows={EMPTY_ROWS}
      />

      <P5B5ApiSafePreviewPanel role={ADMIN_ROLE} input={EMPTY_PROJECTION} />

      <div className="text-[11px] text-muted-foreground">
        <Badge variant="outline">Locked</Badge>{" "}
        {P5B5_FINALITY_STATUS_LABELS.final} records cannot be edited outside the
        controlled correction / supersession pathway.
      </div>

      {dialog && (
        <P5B5ReasonedActionDialog
          open={dialog !== null}
          onOpenChange={(o) => !o && setDialog(null)}
          action={dialog}
          permitted={
            ACTIONS.find((a) => a.key === dialog)?.action
              ? canPerformFinalityAction(
                  ADMIN_ROLE,
                  ACTIONS.find((a) => a.key === dialog)!.action!,
                )
              : true
          }
          onSubmit={async () => {
            // Wired to the guarded Phase 1-3 RPC by a follow-up data-layer
            // hook. Intentionally a no-op in this UI scaffold so no
            // unguarded mutation can occur.
          }}
        />
      )}
    </div>
  );
}
