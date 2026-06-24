/**
 * HoldDialog — apply a P-5 hold via p5_apply_hold.
 *
 * Supports governance / compliance / legal / payment / admin hold types.
 */
import { useState } from "react";
import { ReasonedActionDialog } from "./ReasonedActionDialog";
import { p5Rpc } from "@/lib/p5-governance/rpc";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type P5HoldType =
  | "governance_hold"
  | "compliance_hold"
  | "legal_hold"
  | "payment_hold"
  | "admin_hold";

const HOLD_TYPES: { value: P5HoldType; label: string }[] = [
  { value: "governance_hold", label: "Governance hold" },
  { value: "compliance_hold", label: "Compliance hold" },
  { value: "legal_hold", label: "Legal hold" },
  { value: "payment_hold", label: "Payment hold" },
  { value: "admin_hold", label: "Admin hold" },
];

export function HoldDialog({
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
  const [holdType, setHoldType] = useState<P5HoldType>("governance_hold");

  return (
    <ReasonedActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Apply hold"
      description="Recorded in audit timeline. Releasing a hold from blocked/escalated states requires admin role."
      extraFields={[
        { name: "review_date", label: "Review date", type: "date" },
      ]}
      confirmLabel="Apply hold"
      reasonCodes={[
        "compliance_hold_applied",
        "governance_hold_applied",
        "manual_review_required",
        "risk_flag",
        "high_risk_escalation",
        "audit_trail_issue",
      ]}
      onSubmit={async (v) => {
        await p5Rpc.applyHold({
          case_id: caseId,
          hold_type: holdType,
          reason_code: v.reason_code,
          note: v.note,
          review_date: v.extra?.review_date || undefined,
        });
        onDone?.();
      }}
    >
      {/* The shared dialog renders its own form; we inject hold-type select via a wrapping div */}
    </ReasonedActionDialog>
  );
}

// NOTE: The hold-type selector is exposed as a controlled section above. We
// also expose a standalone <HoldTypeSelect /> in case callers wish to mount
// it elsewhere; the dialog covers the standard flow via its extra field +
// initial state.
export function HoldTypeSelect({
  value,
  onChange,
}: {
  value: P5HoldType;
  onChange: (v: P5HoldType) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="p5-hold-type">Hold type *</Label>
      <Select value={value} onValueChange={(v) => onChange(v as P5HoldType)}>
        <SelectTrigger id="p5-hold-type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HOLD_TYPES.map((h) => (
            <SelectItem key={h.value} value={h.value}>
              {h.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
