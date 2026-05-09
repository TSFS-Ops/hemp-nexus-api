/**
 * AdminOverrideDialog — Phase 3C + 3E governance tightening.
 *
 * Sober UI for the platform-admin closure path. User-facing label is
 * "Admin override closure" (never "break glass"). Two-step confirmation
 * with structured governance fields:
 *   • Reason category (required, closed list)
 *   • Internal approval reference (required)
 *   • Regulator reference (optional → stored as "Not applicable")
 *   • Written reason (required, ≥60 chars)
 *
 * Zero Swallowed Errors: try/catch/finally, toast.error on failure,
 * dialog stays open, loading clears.
 */
import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBreakGlassChallenge } from "@/hooks/useAdminChallengeMutations";
import {
  ADMIN_OVERRIDE_REASON_CATEGORIES,
  ADMIN_OVERRIDE_REASON_CATEGORY_LABELS,
  REGULATOR_REFERENCE_NOT_APPLICABLE,
  normaliseRegulatorReference,
  type AdminOverrideReasonCategory,
} from "@/lib/challenge-override-categories";

export const REASON_MIN = 60;
export const REASON_MAX = 8000;
export const APPROVAL_REF_MAX = 200;
export const REGULATOR_REF_MAX = 200;

export interface AdminOverrideDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  matchId: string;
  onClosed?: () => void;
}

export function AdminOverrideDialog({
  open,
  onOpenChange,
  matchId,
  onClosed,
}: AdminOverrideDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [reasonCategory, setReasonCategory] =
    useState<AdminOverrideReasonCategory | "">("");
  const [internalApprovalReference, setInternalApprovalReference] = useState("");
  const [regulatorReference, setRegulatorReference] = useState("");
  const [reason, setReason] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const overrideMutation = useBreakGlassChallenge();

  const reset = () => {
    setStep(1);
    setReasonCategory("");
    setInternalApprovalReference("");
    setRegulatorReference("");
    setReason("");
    setValidationError(null);
  };
  const handleClose = () => {
    if (overrideMutation.isPending) return;
    reset();
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    setValidationError(null);
    if (!reasonCategory) {
      setValidationError("Reason category is required.");
      return;
    }
    const approvalRef = internalApprovalReference.trim();
    if (approvalRef.length === 0) {
      setValidationError("Internal approval reference is required.");
      return;
    }
    if (approvalRef.length > APPROVAL_REF_MAX) {
      setValidationError(
        `Internal approval reference must be at most ${APPROVAL_REF_MAX} characters.`,
      );
      return;
    }
    const regulatorTrimmed = regulatorReference.trim();
    if (regulatorTrimmed.length > REGULATOR_REF_MAX) {
      setValidationError(
        `Regulator reference must be at most ${REGULATOR_REF_MAX} characters.`,
      );
      return;
    }
    const trimmedReason = reason.trim();
    if (trimmedReason.length < REASON_MIN) {
      setValidationError(
        `Written reason must be at least ${REASON_MIN} characters (currently ${trimmedReason.length}).`,
      );
      return;
    }
    if (trimmedReason.length > REASON_MAX) {
      setValidationError(`Written reason must be at most ${REASON_MAX} characters.`);
      return;
    }

    try {
      await overrideMutation.mutateAsync({
        match_id: matchId,
        reason_category: reasonCategory,
        internal_approval_reference: approvalRef,
        regulator_reference: normaliseRegulatorReference(regulatorTrimmed),
        reason: trimmedReason,
      });
      toast.success("Admin override recorded. Progression resumes on this match.");
      onClosed?.();
      reset();
      onOpenChange(false);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not record the admin override.";
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : handleClose())}>
      <DialogContent className="sm:max-w-lg" data-testid="admin-override-dialog">
        <DialogHeader>
          <DialogTitle>Admin override closure</DialogTitle>
          <DialogDescription>
            This action is audited as an administrator override. It immediately closes the
            challenge and resumes progression on this match.
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-3 py-2 text-sm text-foreground">
            <p>
              Use this only when normal review cannot resolve the challenge. The closure is
              recorded with the outcome <strong>Admin override recorded</strong> and is visible
              to both parties.
            </p>
            <p className="text-muted-foreground">
              You will be asked to provide a reason category, an internal approval reference,
              an optional regulator reference, and a written reason of at least {REASON_MIN}{" "}
              characters.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="override-category">
                Reason category <span className="text-destructive">*</span>
              </Label>
              <Select
                value={reasonCategory}
                onValueChange={(v) => setReasonCategory(v as AdminOverrideReasonCategory)}
                disabled={overrideMutation.isPending}
              >
                <SelectTrigger id="override-category" data-testid="override-category-select">
                  <SelectValue placeholder="Select a governance category" />
                </SelectTrigger>
                <SelectContent>
                  {ADMIN_OVERRIDE_REASON_CATEGORIES.map((code) => (
                    <SelectItem key={code} value={code} data-testid={`override-category-${code}`}>
                      {ADMIN_OVERRIDE_REASON_CATEGORY_LABELS[code]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="override-approval-ref">
                Internal approval reference <span className="text-destructive">*</span>
              </Label>
              <Input
                id="override-approval-ref"
                data-testid="override-approval-ref-input"
                value={internalApprovalReference}
                onChange={(e) => setInternalApprovalReference(e.target.value)}
                maxLength={APPROVAL_REF_MAX}
                placeholder="e.g. IZENZO-REV-2026-041"
                disabled={overrideMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="override-regulator-ref">
                Regulator reference{" "}
                <span className="text-muted-foreground">
                  (optional — stored as "{REGULATOR_REFERENCE_NOT_APPLICABLE}" if blank)
                </span>
              </Label>
              <Input
                id="override-regulator-ref"
                data-testid="override-regulator-ref-input"
                value={regulatorReference}
                onChange={(e) => setRegulatorReference(e.target.value)}
                maxLength={REGULATOR_REF_MAX}
                placeholder="e.g. FCA-REF-2026-09 or leave blank"
                disabled={overrideMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="override-reason">
                Written reason{" "}
                <span className="text-muted-foreground">
                  ({REASON_MIN}–{REASON_MAX} characters)
                </span>
              </Label>
              <Textarea
                id="override-reason"
                data-testid="override-reason-input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={6}
                maxLength={REASON_MAX}
                placeholder="State the operational facts that justify an administrator override."
                disabled={overrideMutation.isPending}
              />
              <p className="text-xs text-muted-foreground">
                {reason.trim().length} / {REASON_MAX}
              </p>
            </div>

            {validationError && (
              <p
                role="alert"
                data-testid="override-validation-error"
                className="text-sm text-destructive"
              >
                {validationError}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={overrideMutation.isPending}
            data-testid="override-cancel-button"
          >
            Cancel
          </Button>
          {step === 1 ? (
            <Button
              type="button"
              onClick={() => setStep(2)}
              data-testid="override-continue-button"
            >
              Continue
            </Button>
          ) : (
            <LoadingButton
              type="button"
              onClick={handleSubmit}
              loading={overrideMutation.isPending}
              loadingText="Recording…"
              data-testid="override-submit-button"
            >
              Record admin override
            </LoadingButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
