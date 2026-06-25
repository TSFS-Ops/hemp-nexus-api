/**
 * P-5 Batch 4 Stage 4 — reasoned action dialog.
 *
 * Generic confirm shell that requires a typed reason of ≥4 chars
 * (matching the Stage 3 SQL gate) before invoking a mutation. All
 * mutations called from `onConfirm` MUST go through the Stage 3 typed
 * wrappers in `@/lib/p5-batch4/rpc`.
 */
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface P5B4ReasonedActionDialogProps {
  trigger: ReactNode;
  title: string;
  description?: string;
  warning?: string;
  confirmLabel?: string;
  destructive?: boolean;
  minReasonLength?: number;
  onConfirm: (reason: string) => Promise<void> | void;
}

export function P5B4ReasonedActionDialog({
  trigger,
  title,
  description,
  warning,
  confirmLabel = "Confirm",
  destructive = false,
  minReasonLength = 4,
  onConfirm,
}: P5B4ReasonedActionDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setReason("");
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span
        onClick={() => setOpen(true)}
        data-testid="p5b4-reasoned-trigger"
        className="contents"
      >
        {trigger}
      </span>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {warning ? (
          <div
            role="alert"
            data-testid="p5b4-action-warning"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {warning}
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="p5b4-reason">Reason (≥{minReasonLength} chars)</Label>
          <Textarea
            id="p5b4-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Audited reason for this action"
            data-testid="p5b4-reason-textarea"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            disabled={busy || reason.trim().length < minReasonLength}
            variant={destructive ? "destructive" : "default"}
            onClick={handle}
            data-testid="p5b4-reasoned-confirm"
          >
            {busy ? "Submitting…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
