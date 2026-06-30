/**
 * HoldDialog — apply a P-5 hold via p5_apply_hold.
 *
 * Supports governance / compliance / legal / payment / admin hold types.
 * Self-contained because the hold-type selector is action-specific.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { p5Rpc } from "@/lib/p5-governance/rpc";
import { P5_REASON_CODES, type P5ReasonCode } from "@/lib/p5-governance/constants";
import { toast } from "sonner";

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

const HOLD_REASON_CODES: P5ReasonCode[] = [
  "compliance_hold_applied",
  "governance_hold_applied",
  "manual_review_required",
  "risk_flag",
  "high_risk_escalation",
  "audit_trail_issue",
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
  const [reasonCode, setReasonCode] = useState<P5ReasonCode | "">("");
  const [note, setNote] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setHoldType("governance_hold");
    setReasonCode("");
    setNote("");
    setReviewDate("");
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const submit = async () => {
    if (!reasonCode) return toast.error("Reason code is required");
    if (!note.trim()) return toast.error("Note is required");
    setSubmitting(true);
    try {
      await p5Rpc.applyHold({
        case_id: caseId,
        hold_type: holdType,
        reason_code: reasonCode,
        note: note.trim(),
        review_date: reviewDate || undefined,
      });
      toast.success("Hold applied");
      reset();
      onOpenChange(false);
      onDone?.();
    } catch (err) {
      toast.error(`Action failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply hold</DialogTitle>
          <DialogDescription>
            Releasing a hold from blocked/escalated states requires admin role.
            All hold actions are recorded in the tamper-evident audit timeline.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="p5-hold-type">Hold type *</Label>
            <Select value={holdType} onValueChange={(v) => setHoldType(v as P5HoldType)}>
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

          <div className="space-y-1.5">
            <Label htmlFor="p5-hold-reason">Reason code *</Label>
            <Select value={reasonCode} onValueChange={(v) => setReasonCode(v as P5ReasonCode)}>
              <SelectTrigger id="p5-hold-reason" aria-label="Reason code">
                <SelectValue placeholder="Select a reason code" />
              </SelectTrigger>
              <SelectContent>
                {HOLD_REASON_CODES.map((rc) => (
                  <SelectItem key={rc} value={rc}>
                    {rc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p5-hold-note">Note *</Label>
            <Textarea
              id="p5-hold-note"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Operational note (recorded in audit timeline)"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p5-hold-review">Review date</Label>
            <Input
              id="p5-hold-review"
              type="date"
              value={reviewDate}
              onChange={(e) => setReviewDate(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !reasonCode || !note.trim()}
            data-testid="p5-hold-confirm"
          >
            {submitting ? "Applying…" : "Apply hold"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Ensure P5_REASON_CODES list reference is retained for future extension UIs.
export const _hold_reason_codes_total = P5_REASON_CODES.length;
