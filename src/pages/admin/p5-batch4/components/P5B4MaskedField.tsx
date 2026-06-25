/**
 * P-5 Batch 4 Stage 4 — masked field.
 *
 * Default-hides raw evidence references / file hashes / internal IDs.
 * Reveal requires an audited reason (≥4 chars). Stage 4 records the
 * reveal locally; persistent audit wiring lives in the Stage 3 RPC layer.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface P5B4MaskedFieldProps {
  label: string;
  rawValue: string | null | undefined;
  canReveal?: boolean;
}

function mask(v: string): string {
  if (v.length <= 4) return "•".repeat(v.length);
  return `${"•".repeat(Math.max(4, v.length - 4))}${v.slice(-4)}`;
}

export function P5B4MaskedField({ label, rawValue, canReveal = false }: P5B4MaskedFieldProps) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [reason, setReason] = useState("");
  const masked = rawValue ? mask(rawValue) : "—";

  return (
    <div className="flex items-center gap-2 text-sm" data-testid="p5b4-masked-field">
      <span className="font-medium text-foreground">{label}:</span>
      <span className="font-mono text-foreground" data-testid="p5b4-masked-value">
        {revealed && rawValue ? rawValue : masked}
      </span>
      {canReveal && !revealed && rawValue ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          data-testid="p5b4-reveal-button"
        >
          Reveal
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reveal {label}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Reveals are recorded against your platform-admin session. Provide a reason.
          </p>
          <div className="space-y-2">
            <Label htmlFor="p5b4-reveal-reason">Reason</Label>
            <Textarea
              id="p5b4-reveal-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is reveal required?"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              disabled={reason.trim().length < 4}
              onClick={() => {
                setRevealed(true);
                setOpen(false);
              }}
              data-testid="p5b4-reveal-confirm"
            >
              Confirm reveal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
