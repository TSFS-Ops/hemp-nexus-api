/**
 * RecordOutcomeDialog — Phase 3C
 *
 * Outcome recording for an active challenge. Two modes:
 *   - mode="outcome_recorded": requires outcome_code + summary >=40
 *   - mode="closed_no_action": requires summary >=40 (no outcome_code)
 *
 * Outcome labels are imported from the locked central catalogue
 * (`src/lib/challenge-outcomes.ts`). Do NOT retype labels here.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import {
  CHALLENGE_OUTCOME_CODES,
  CHALLENGE_OUTCOME_LABELS,
  type ChallengeOutcomeCode,
} from "@/lib/challenge-outcomes";
import { useTransitionChallenge } from "@/hooks/useAdminChallengeMutations";

export const SUMMARY_MIN = 40;
export const SUMMARY_MAX = 8000;

// Outcomes selectable by an admin recording an outcome (excludes
// "withdrawn_by_raiser" — that is a party action, not an admin outcome —
// and "admin_override_recorded" — that is set by the override route).
const SELECTABLE_OUTCOMES: ChallengeOutcomeCode[] = CHALLENGE_OUTCOME_CODES.filter(
  (c) => c !== "withdrawn_by_raiser" && c !== "admin_override_recorded",
);

export interface RecordOutcomeDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  mode: "outcome_recorded" | "closed_no_action";
  challengeId: string;
  matchId: string;
  onRecorded?: () => void;
}

export function RecordOutcomeDialog({
  open,
  onOpenChange,
  mode,
  challengeId,
  matchId,
  onRecorded,
}: RecordOutcomeDialogProps) {
  const isOutcome = mode === "outcome_recorded";
  const [outcomeCode, setOutcomeCode] = useState<ChallengeOutcomeCode | "">("");
  const [summary, setSummary] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const transition = useTransitionChallenge();

  const reset = () => {
    setOutcomeCode("");
    setSummary("");
    setValidationError(null);
  };
  const handleClose = () => {
    if (transition.isPending) return;
    reset();
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    setValidationError(null);
    if (isOutcome && !outcomeCode) {
      setValidationError("Please select an outcome.");
      return;
    }
    const trimmed = summary.trim();
    if (trimmed.length < SUMMARY_MIN) {
      setValidationError(
        `Summary must be at least ${SUMMARY_MIN} characters (currently ${trimmed.length}).`,
      );
      return;
    }
    if (trimmed.length > SUMMARY_MAX) {
      setValidationError(`Summary must be at most ${SUMMARY_MAX} characters.`);
      return;
    }

    try {
      await transition.mutateAsync({
        challenge_id: challengeId,
        match_id: matchId,
        to_status: mode,
        outcome_code: isOutcome ? (outcomeCode as ChallengeOutcomeCode) : null,
        outcome_summary: trimmed,
      });
      toast.success(
        isOutcome ? "Outcome recorded. Progression resumes on this match." : "Challenge closed with no action.",
      );
      onRecorded?.();
      reset();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not record the outcome.";
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : handleClose())}>
      <DialogContent className="sm:max-w-lg" data-testid="record-outcome-dialog">
        <DialogHeader>
          <DialogTitle>
            {isOutcome ? "Record outcome" : "Close — no action"}
          </DialogTitle>
          <DialogDescription>
            {isOutcome
              ? "Recording an outcome closes the challenge and resumes progression on this match."
              : "Closing with no action ends the challenge without changing the match terms."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isOutcome && (
            <div className="space-y-2">
              <Label htmlFor="outcome-code">Outcome</Label>
              <Select
                value={outcomeCode}
                onValueChange={(v) => setOutcomeCode(v as ChallengeOutcomeCode)}
                disabled={transition.isPending}
              >
                <SelectTrigger id="outcome-code" data-testid="outcome-code-select">
                  <SelectValue placeholder="Select an outcome" />
                </SelectTrigger>
                <SelectContent>
                  {SELECTABLE_OUTCOMES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CHALLENGE_OUTCOME_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="outcome-summary">
              Summary{" "}
              <span className="text-muted-foreground">
                ({SUMMARY_MIN}–{SUMMARY_MAX} characters)
              </span>
            </Label>
            <Textarea
              id="outcome-summary"
              data-testid="outcome-summary-input"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={6}
              maxLength={SUMMARY_MAX}
              placeholder="Explain in clear, factual terms what was reviewed and why this outcome applies."
              disabled={transition.isPending}
            />
            <p className="text-xs text-muted-foreground">{summary.trim().length} / {SUMMARY_MAX}</p>
          </div>

          {validationError && (
            <p
              role="alert"
              data-testid="outcome-validation-error"
              className="text-sm text-destructive"
            >
              {validationError}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={transition.isPending}
            data-testid="outcome-cancel-button"
          >
            Cancel
          </Button>
          <LoadingButton
            type="button"
            onClick={handleSubmit}
            loading={transition.isPending}
            loadingText="Saving…"
            data-testid="outcome-submit-button"
          >
            {isOutcome ? "Record outcome" : "Close — no action"}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
