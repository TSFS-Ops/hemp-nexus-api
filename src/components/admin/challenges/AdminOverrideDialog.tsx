/**
 * AdminOverrideDialog — Phase 3C
 *
 * Sober UI for the platform-admin closure path internally known as
 * "break-glass". User-facing label is "Admin override closure".
 *
 * Two-step confirmation:
 *   step 1: explanation that the override is audited and immediately
 *           closes the challenge as `admin_override_recorded`.
 *   step 2: collect a >= 60-character reason and submit.
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
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { useBreakGlassChallenge } from "@/hooks/useAdminChallengeMutations";

export const REASON_MIN = 60;
export const REASON_MAX = 8000;

export interface AdminOverrideDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  matchId: string;
  onClosed?: () => void;
}

export function AdminOverrideDialog({ open, onOpenChange, matchId, onClosed }: AdminOverrideDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [reason, setReason] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const breakGlass = useBreakGlassChallenge();

  const reset = () => {
    setStep(1);
    setReason("");
    setValidationError(null);
  };
  const handleClose = () => {
    if (breakGlass.isPending) return;
    reset();
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    setValidationError(null);
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN) {
      setValidationError(`Reason must be at least ${REASON_MIN} characters (currently ${trimmed.length}).`);
      return;
    }
    if (trimmed.length > REASON_MAX) {
      setValidationError(`Reason must be at most ${REASON_MAX} characters.`);
      return;
    }
    try {
      await breakGlass.mutateAsync({ match_id: matchId, reason: trimmed });
      toast.success("Admin override recorded. Progression resumes on this match.");
      onClosed?.();
      reset();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not record the admin override.";
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
              You will be asked to provide a written reason of at least {REASON_MIN} characters.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="override-reason">
                Reason <span className="text-muted-foreground">({REASON_MIN}–{REASON_MAX} characters)</span>
              </Label>
              <Textarea
                id="override-reason"
                data-testid="override-reason-input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={6}
                maxLength={REASON_MAX}
                placeholder="State the operational facts that justify an administrator override."
                disabled={breakGlass.isPending}
              />
              <p className="text-xs text-muted-foreground">{reason.trim().length} / {REASON_MAX}</p>
            </div>
            {validationError && (
              <p role="alert" data-testid="override-validation-error" className="text-sm text-destructive">
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
            disabled={breakGlass.isPending}
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
              loading={breakGlass.isPending}
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
