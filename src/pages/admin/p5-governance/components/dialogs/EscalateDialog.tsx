/**
 * EscalateDialog — calls p5_escalate.
 */
import { ReasonedActionDialog } from "./ReasonedActionDialog";
import { p5Rpc } from "@/lib/p5-governance/rpc";

export function EscalateDialog({
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
      title="Escalate case"
      reasonCodes={[
        "high_risk_escalation",
        "manual_review_required",
        "overdue_sla",
        "sanctions_pep_adverse_result_review",
        "disputed_decision",
      ]}
      extraFields={[
        { name: "owner_user_id", label: "Escalation owner (user id)" },
        { name: "due_at", label: "Due at", type: "datetime-local" },
      ]}
      confirmLabel="Escalate"
      confirmVariant="destructive"
      onSubmit={async (v) => {
        await p5Rpc.escalate({
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
