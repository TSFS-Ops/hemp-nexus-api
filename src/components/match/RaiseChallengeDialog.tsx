/**
 * RaiseChallengeDialog — Phase 3B
 *
 * Minimal modal that submits to the existing `match-challenges/raise`
 * endpoint. No new server endpoint, no new schema.
 *
 * Validation:
 *   • subject_code: required, must be one of the server enum
 *   • summary: 60–2000 characters (server allows 20; UI enforces 60 minimum
 *     to encourage meaningful submissions, never exceeds DB max of 2000)
 *
 * Modal Dismissal Standard: explicit Close (×) button + Cancel button.
 * Zero Swallowed Errors: try/catch/finally with toast surface.
 */
import { useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
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
import { fetchEdgeFunction } from "@/lib/edge-invoke";

export const SUMMARY_MIN = 60;
export const SUMMARY_MAX = 2000;

export const SUBJECT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "terms_disagreement", label: "Terms disagreement" },
  { value: "evidence_quality_concern", label: "Evidence quality concern" },
  { value: "identity_concern", label: "Identity concern" },
  { value: "compliance_concern", label: "Compliance concern" },
  { value: "delivery_or_settlement_concern", label: "Delivery or settlement concern" },
  { value: "other", label: "Other" },
] as const;

export interface RaiseChallengeDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  matchId: string;
  /** Determines the `raised_by_role` and `raised_by_org_id` payload. */
  viewerSide: "buyer" | "seller" | "platform_admin";
  viewerOrgId: string | null;
  onRaised?: () => void;
}

export function RaiseChallengeDialog({
  open,
  onOpenChange,
  matchId,
  viewerSide,
  viewerOrgId,
  onRaised,
}: RaiseChallengeDialogProps) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState<string>("");
  const [summary, setSummary] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const reset = () => {
    setSubject("");
    setSummary("");
    setValidationError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    setValidationError(null);
    if (!subject) {
      setValidationError("Please select a subject.");
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

    const raisedByRole =
      viewerSide === "buyer"
        ? "buyer_org_admin"
        : viewerSide === "seller"
        ? "seller_org_admin"
        : "platform_admin";
    const body = {
      match_id: matchId,
      raised_by_role: raisedByRole,
      raised_by_org_id: viewerSide === "platform_admin" ? null : viewerOrgId,
      subject_code: subject,
      summary: trimmed,
    };

    setSubmitting(true);
    try {
      await fetchEdgeFunction("match-challenges/raise", {
        method: "POST",
        body,
        label: "raise challenge",
      });
      toast.success("Challenge raised. Progression is now paused on this match.");
      queryClient.invalidateQueries({ queryKey: ["match-challenges", matchId] });
      onRaised?.();
      reset();
      onOpenChange(false);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not raise the challenge. Please try again.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : handleClose())}>
      <DialogContent className="sm:max-w-lg" data-testid="raise-challenge-dialog">
        <DialogHeader>
          <DialogTitle>Raise a challenge on this match</DialogTitle>
          <DialogDescription>
            Pause progression on this match while the parties resolve a concern. The other side
            and platform administrators will be able to see this challenge.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="challenge-subject">Subject</Label>
            <Select value={subject} onValueChange={setSubject} disabled={submitting}>
              <SelectTrigger id="challenge-subject" data-testid="challenge-subject-select">
                <SelectValue placeholder="Select a subject" />
              </SelectTrigger>
              <SelectContent>
                {SUBJECT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="challenge-summary">
              Summary <span className="text-muted-foreground">({SUMMARY_MIN}–{SUMMARY_MAX} characters)</span>
            </Label>
            <Textarea
              id="challenge-summary"
              data-testid="challenge-summary-input"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={6}
              maxLength={SUMMARY_MAX}
              placeholder="Describe the concern in clear, factual terms. Include what is incorrect, what you expected, and what you would like to happen next."
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground" data-testid="challenge-summary-counter">
              {summary.trim().length} / {SUMMARY_MAX}
            </p>
          </div>

          {validationError && (
            <p
              role="alert"
              data-testid="challenge-validation-error"
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
            disabled={submitting}
            data-testid="challenge-cancel-button"
          >
            Cancel
          </Button>
          <LoadingButton
            type="button"
            onClick={handleSubmit}
            loading={submitting}
            loadingText="Raising…"
            data-testid="challenge-submit-button"
          >
            Raise challenge
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
