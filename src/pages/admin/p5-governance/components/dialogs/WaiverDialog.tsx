/**
 * WaiverDialog — senior/admin only. Calls p5_waive.
 */
import { ReasonedActionDialog } from "./ReasonedActionDialog";
import { p5Rpc } from "@/lib/p5-governance/rpc";

export function WaiverDialog({
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
      title="Grant waiver"
      description="Senior/admin only. Recorded in the immutable audit timeline."
      warning="Waiver bypasses a normal readiness requirement. It is exceptional, audited and reviewable."
      reasonCodes={["waiver_granted"]}
      extraFields={[
        { name: "scope", label: "Scope", required: true, placeholder: "e.g. director-id-evidence" },
        { name: "expires_at", label: "Expires at", type: "datetime-local" },
        { name: "risk_acceptance_note", label: "Risk acceptance note" },
      ]}
      confirmLabel="Grant waiver"
      confirmVariant="destructive"
      onSubmit={async (v) => {
        await p5Rpc.waive({
          case_id: caseId,
          scope: v.extra!.scope,
          reason_code: v.reason_code,
          note: v.note,
          risk_acceptance_note: v.extra?.risk_acceptance_note || undefined,
          expires_at: v.extra?.expires_at || undefined,
        });
        onDone?.();
      }}
    />
  );
}
