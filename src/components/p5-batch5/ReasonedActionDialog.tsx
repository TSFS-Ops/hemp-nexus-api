/**
 * P-5 Batch 5 — Phase 5
 * Reasoned-action dialog used by all finality / dispute / correction /
 * supersession / reclassification actions.
 *
 * The dialog never mutates rows directly. It validates input (reason
 * required, banned wording absent, confirm box checked, role-permitted)
 * then delegates to a caller-supplied `onSubmit` which is expected to
 * call the Phase 1-3 guarded RPC.
 */
import { useState, useId, useMemo } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { findP5B5BannedPhrases } from "@/lib/p5-batch5/wording";
import { useAsyncAction } from "@/hooks/use-async-action";

export type P5B5DialogAction =
  | "create_finality"
  | "add_correction"
  | "mark_dispute"
  | "resolve_dispute"
  | "supersede_finality"
  | "administrative_reclassification"
  | "request_dispute_correction";

const TITLES: Record<P5B5DialogAction, string> = {
  create_finality: "Create Finality Record",
  add_correction: "Add Correction Record",
  mark_dispute: "Mark Under Dispute",
  resolve_dispute: "Resolve Dispute",
  supersede_finality: "Supersede Finality",
  administrative_reclassification: "Administrative Reclassification",
  request_dispute_correction: "Request Dispute or Correction",
};

const CONFIRMS: Record<P5B5DialogAction, string> = {
  create_finality:
    "I confirm the required evidence, approvals and controls were completed or waived.",
  add_correction:
    "I confirm the original finality record remains preserved for audit.",
  mark_dispute:
    "I confirm reliance on this record should be paused while it is reviewed.",
  resolve_dispute:
    "I confirm the dispute has been reviewed and a resolution is recorded.",
  supersede_finality:
    "I confirm a later approved finality record replaces this one.",
  administrative_reclassification:
    "I confirm this is an administrative reclassification only.",
  request_dispute_correction:
    "I confirm the details I have provided are accurate.",
};

export interface P5B5ReasonedActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: P5B5DialogAction;
  /** When false, the action button is hidden and submit is blocked. */
  permitted: boolean;
  /** Caller-supplied RPC bridge. Must call the existing guarded RPC. */
  onSubmit: (input: { reason: string; category?: string }) => Promise<void>;
  /** Optional category picker (used by disputes / reclassification). */
  categoryOptions?: ReadonlyArray<{ value: string; label: string }>;
  successMessage?: string;
}

export function P5B5ReasonedActionDialog({
  open,
  onOpenChange,
  action,
  permitted,
  onSubmit,
  categoryOptions,
  successMessage = "Action recorded.",
}: P5B5ReasonedActionDialogProps) {
  const reasonId = useId();
  const confirmId = useId();
  const categoryId = useId();
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState<string>(categoryOptions?.[0]?.value ?? "");
  const [confirmed, setConfirmed] = useState(false);

  const banned = useMemo(() => findP5B5BannedPhrases(reason), [reason]);

  const { run, loading } = useAsyncAction(
    async () => {
      if (!permitted) throw new Error("You are not permitted to perform this action.");
      if (reason.trim().length < 8) throw new Error("Please provide a reason (min. 8 characters).");
      if (banned.length > 0) {
        throw new Error("Reason contains banned wording. Please rephrase.");
      }
      if (!confirmed) throw new Error("Please confirm the action.");
      await onSubmit({ reason: reason.trim(), category: categoryOptions ? category : undefined });
      setReason("");
      setConfirmed(false);
      onOpenChange(false);
    },
    { successMessage, errorMessage: "Action could not be recorded." },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TITLES[action]}</DialogTitle>
          <DialogDescription>
            All finality, correction and dispute actions are recorded with an audit event.
            They go through the platform&apos;s guarded action pathway and cannot be edited
            after submission.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!permitted && (
            <Alert>
              <AlertDescription>
                You do not have permission to perform this action.
              </AlertDescription>
            </Alert>
          )}

          {categoryOptions && (
            <div className="space-y-1.5">
              <Label htmlFor={categoryId}>Category</Label>
              <select
                id={categoryId}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={!permitted || loading}
              >
                {categoryOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={reasonId}>Reason</Label>
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain the basis for this action. Required."
              rows={4}
              disabled={!permitted || loading}
            />
            {banned.length > 0 && (
              <Alert>
                <AlertDescription>
                  Banned wording detected: {banned.join(", ")}. Please rephrase.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id={confirmId}
              checked={confirmed}
              onCheckedChange={(c) => setConfirmed(c === true)}
              disabled={!permitted || loading}
            />
            <Label htmlFor={confirmId} className="text-sm leading-snug">
              {CONFIRMS[action]}
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={() => run()}
            disabled={!permitted || loading || !confirmed || reason.trim().length < 8 || banned.length > 0}
          >
            {loading ? "Submitting…" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default P5B5ReasonedActionDialog;
