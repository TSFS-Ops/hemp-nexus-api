/**
 * RejectDialog — calls p5_reject.
 */
import { ReasonedActionDialog } from "./ReasonedActionDialog";
import { p5Rpc } from "@/lib/p5-governance/rpc";

export function RejectDialog({
  open,
  onOpenChange,
  caseId,
  evidenceItemId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  caseId: string;
  evidenceItemId?: string;
  onDone?: () => void;
}) {
  return (
    <ReasonedActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Reject"
      warning="Rejection is recorded in the immutable audit timeline."
      reasonCodes={[
        "rejected_by_reviewer",
        "missing_evidence",
        "incomplete_evidence",
        "illegible_evidence",
        "wrong_document",
        "expired_evidence",
        "does_not_match_entity",
        "does_not_match_director_ubo",
        "does_not_match_transaction_project",
        "identity_verification_issue",
        "company_verification_issue",
        "bank_detail_verification_issue",
        "data_mismatch",
      ]}
      confirmLabel="Reject"
      confirmVariant="destructive"
      onSubmit={async (v) => {
        await p5Rpc.reject({
          case_id: caseId,
          reason_code: v.reason_code,
          note: v.note,
          evidence_item_id: evidenceItemId,
        });
        onDone?.();
      }}
    />
  );
}
