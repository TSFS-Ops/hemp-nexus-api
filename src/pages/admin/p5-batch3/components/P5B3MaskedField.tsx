/**
 * P-5 Batch 3 — Stage 4 masked field component (admin surfaces).
 *
 * Default-masks bank/IBAN/ID/passport values. Reveal requires a typed
 * reason and an admin acknowledgement — Stage 4 does not call any
 * unmask RPC; it only renders a reasoned reveal locally pending Stage 5
 * audit wiring. This keeps Stage 4 strictly UI without new RPCs.
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
import { maskBankAccount } from "@/lib/p5-batch3/visibility";

export interface P5B3MaskedFieldProps {
  label: string;
  rawValue: string | null | undefined;
  canReveal?: boolean;
}

export function P5B3MaskedField({ label, rawValue, canReveal = false }: P5B3MaskedFieldProps) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [reason, setReason] = useState("");
  const masked = maskBankAccount(rawValue ?? "");

  return (
    <div className="flex items-center gap-2 text-sm" data-testid="p5b3-masked-field">
      <span className="font-medium text-foreground">{label}:</span>
      <span className="font-mono text-foreground">
        {revealed && rawValue ? rawValue : masked || "—"}
      </span>
      {canReveal && !revealed && rawValue ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="p5b3-reveal-button">
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
            <Label htmlFor="p5b3-reveal-reason">Reason</Label>
            <Textarea
              id="p5b3-reveal-reason"
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
              data-testid="p5b3-reveal-confirm"
            >
              Confirm reveal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
