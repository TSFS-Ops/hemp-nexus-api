/**
 * EvidenceReviewPanel — Stage 4
 *
 * Lists evidence items for a case and exposes approve / reject / request
 * correction actions. Reject/request correction require reason code + note.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { P5StatusBadge } from "./P5StatusBadge";
import { ReasonedActionDialog } from "./dialogs/ReasonedActionDialog";
import { p5Rpc } from "@/lib/p5-governance/rpc";
import { toast } from "sonner";
import type { P5Status, P5ReasonCode } from "@/lib/p5-governance/constants";
import type { P5Permissions } from "@/hooks/useP5Permissions";

export interface EvidenceItem {
  id: string;
  evidence_type: string;
  required: boolean;
  status: P5Status;
  evidence_version: number;
  expiry_date: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason_code: P5ReasonCode | null;
  reviewer_note: string | null;
  customer_safe_note: string | null;
  uploaded_file_id: string | null;
}

export function EvidenceReviewPanel({
  items,
  permissions,
  onChanged,
}: {
  items: EvidenceItem[];
  permissions: P5Permissions;
  onChanged?: () => void;
}) {
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<string | null>(null);

  const approve = async (id: string) => {
    try {
      await p5Rpc.reviewEvidence({ evidence_item_id: id, decision: "approve" });
      toast.success("Evidence approved");
      onChanged?.();
    } catch (err) {
      toast.error(`Approve failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Evidence review</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No evidence items yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Reviewer</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id} data-testid={`p5-evidence-row-${it.id}`}>
                  <TableCell className="font-mono text-xs">{it.evidence_type}</TableCell>
                  <TableCell>{it.required ? "Yes" : "Optional"}</TableCell>
                  <TableCell>
                    <P5StatusBadge status={it.status} />
                  </TableCell>
                  <TableCell>{it.evidence_version}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {it.expiry_date ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {it.reviewed_by ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[16rem]">
                    {it.rejection_reason_code && (
                      <div>
                        Reason: <span className="font-mono">{it.rejection_reason_code}</span>
                      </div>
                    )}
                    {it.customer_safe_note && <div>{it.customer_safe_note}</div>}
                    {it.reviewer_note && permissions.canViewFullDetails && (
                      <div className="opacity-70">{it.reviewer_note}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    {permissions.canReviewEvidence && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => approve(it.id)}>
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRequestingId(it.id)}
                        >
                          Request correction
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setRejectingId(it.id)}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ReasonedActionDialog
        open={Boolean(rejectingId)}
        onOpenChange={(v) => !v && setRejectingId(null)}
        title="Reject evidence"
        warning="Rejection is permanently recorded in the audit timeline."
        confirmLabel="Reject evidence"
        confirmVariant="destructive"
        reasonCodes={[
          "illegible_evidence",
          "wrong_document",
          "expired_evidence",
          "does_not_match_entity",
          "does_not_match_director_ubo",
          "does_not_match_transaction_project",
          "missing_signature",
          "data_mismatch",
        ]}
        onSubmit={async (v) => {
          await p5Rpc.reviewEvidence({
            evidence_item_id: rejectingId!,
            decision: "reject",
            reason_code: v.reason_code,
            note: v.note,
          });
          onChanged?.();
        }}
      />

      <ReasonedActionDialog
        open={Boolean(requestingId)}
        onOpenChange={(v) => !v && setRequestingId(null)}
        title="Request correction"
        confirmLabel="Send request"
        reasonCodes={[
          "incomplete_evidence",
          "illegible_evidence",
          "missing_signature",
          "missing_authority_to_act",
          "missing_consent",
          "data_mismatch",
        ]}
        onSubmit={async (v) => {
          await p5Rpc.reviewEvidence({
            evidence_item_id: requestingId!,
            decision: "request_correction",
            reason_code: v.reason_code,
            note: v.note,
          });
          onChanged?.();
        }}
      />
    </Card>
  );
}
