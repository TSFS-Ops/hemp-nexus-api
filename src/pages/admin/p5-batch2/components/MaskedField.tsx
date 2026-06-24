/**
 * P-5 Batch 2 — Stage 4 masked field.
 *
 * Default: shows masked value via Stage 2 `maskP5B2Field`. Privileged viewers
 * may request unmask, which captures a reason and writes the access through
 * `p5b2_log_sensitive_access` before revealing the raw value.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { maskP5B2Field, type P5B2SensitiveField } from "@/lib/p5-batch2/masking";
import { p5b2LogSensitiveAccess } from "@/lib/p5-batch2/rpc";
import { useP5Batch2Permissions } from "@/hooks/useP5Batch2Permissions";

export interface MaskedFieldProps {
  label: string;
  rawValue: string | null | undefined;
  field: P5B2SensitiveField;
  evidenceItemId?: string | null;
  recordId?: string | null;
}

export function MaskedField({ label, rawValue, field, evidenceItemId, recordId }: MaskedFieldProps) {
  const perms = useP5Batch2Permissions();
  const [unmasked, setUnmasked] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const masked = maskP5B2Field(field, rawValue ?? "", {
    viewer: "admin",
    is_admin: false,
    is_compliance_owner: false,
  });
  const raw = maskP5B2Field(field, rawValue ?? "", {
    viewer: "admin",
    is_admin: true,
    is_compliance_owner: true,
  });

  const handleUnmask = async () => {
    if (reason.trim().length < 4) {
      toast.error("Reason required (min 4 characters)");
      return;
    }
    setBusy(true);
    try {
      const res = await p5b2LogSensitiveAccess({
        evidence_item_id: evidenceItemId ?? null,
        record_id: recordId ?? null,
        field,
        reason_text: reason.trim(),
        action: "unmask",
      });
      if (!res.ok) {
        toast.error(res.error ?? "Unmask denied");
        return;
      }
      setUnmasked(true);
      setOpen(false);
      setReason("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 text-sm" data-testid={`masked-field-${field}`}>
      <span className="font-medium text-foreground">{label}:</span>
      <span className="font-mono text-foreground" data-testid="masked-value">
        {unmasked ? raw : masked || "—"}
      </span>
      {perms.canUnmaskSensitive && !unmasked && rawValue ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          data-testid="unmask-button"
        >
          Unmask
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unmask {label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="unmask-reason">Reason (audited)</Label>
            <Textarea
              id="unmask-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is unmasking required?"
              data-testid="unmask-reason"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={handleUnmask} disabled={busy} data-testid="unmask-confirm">
              Confirm unmask
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
