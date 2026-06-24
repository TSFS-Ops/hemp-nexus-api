/**
 * OverrideDialog — senior/admin only. Calls p5_override.
 */
import { ReasonedActionDialog } from "./ReasonedActionDialog";
import { p5Rpc } from "@/lib/p5-governance/rpc";

export function OverrideDialog({
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
      title="Apply override"
      description="Senior/admin only. Override is audited and exceptional."
      warning="Override forces progression past a blocker or hold. Every override is permanently recorded in the audit timeline and reviewable by auditor/read-only."
      reasonCodes={["override_approved"]}
      extraFields={[
        { name: "scope", label: "Scope", required: true, placeholder: "e.g. provider-result-pending" },
        { name: "expires_at", label: "Expires at", type: "datetime-local" },
        { name: "risk_acceptance_note", label: "Risk acceptance note" },
      ]}
      confirmLabel="Apply override"
      confirmVariant="destructive"
      onSubmit={async (v) => {
        await p5Rpc.override({
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
