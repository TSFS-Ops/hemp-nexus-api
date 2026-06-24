/**
 * RequestMoreInfoDialog — calls p5_request_more_info.
 */
import { ReasonedActionDialog } from "./ReasonedActionDialog";
import { p5Rpc } from "@/lib/p5-governance/rpc";

export function RequestMoreInfoDialog({
  open,
  onOpenChange,
  caseId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  caseId: string;
  onDone?: () => void;
}) {
  return (
    <ReasonedActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Request more information"
      reasonCodes={[
        "missing_evidence",
        "incomplete_evidence",
        "illegible_evidence",
        "wrong_document",
        "expired_evidence",
        "missing_signature",
        "missing_authority_to_act",
        "missing_mandate",
        "missing_consent",
        "data_mismatch",
      ]}
      extraFields={[
        { name: "owner_user_id", label: "Responsible owner (user id)" },
        { name: "due_at", label: "Due at", type: "datetime-local" },
      ]}
      confirmLabel="Send request"
      onSubmit={async (v) => {
        await p5Rpc.requestMoreInfo({
          case_id: caseId,
          reason_code: v.reason_code,
          note: v.note,
          owner_user_id: v.extra?.owner_user_id || undefined,
          due_at: v.extra?.due_at || undefined,
        });
        onDone?.();
      }}
    />
  );
}
