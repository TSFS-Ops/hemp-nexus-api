/**
 * P-5 Batch 3 — Stage 4 reasoned action dialog.
 *
 * Generic confirmation dialog that requires a typed reason before
 * invoking a destructive/material action (revoke, reject, close).
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

export interface P5B3ReasonedActionDialogProps {
  trigger: ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  minReasonLength?: number;
  onConfirm: (reason: string) => Promise<void> | void;
}

export function P5B3ReasonedActionDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  minReasonLength = 4,
  onConfirm,
}: P5B3ReasonedActionDialogProps) {
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
      <span onClick={() => setOpen(true)} data-testid="p5b3-reasoned-trigger" className="contents">
        {trigger}
      </span>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="p5b3-reason">Reason</Label>
          <Textarea
            id="p5b3-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Audited reason for this action"
            data-testid="p5b3-reason-textarea"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            disabled={busy || reason.trim().length < minReasonLength}
            onClick={handle}
            data-testid="p5b3-reasoned-confirm"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
