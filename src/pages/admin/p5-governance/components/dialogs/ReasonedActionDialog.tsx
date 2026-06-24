/**
 * ReasonedActionDialog — shared shell for P-5 reasoned admin actions.
 *
 * Enforces reason_code + note client-side (server re-validates via Stage 3).
 * Used by Hold / Release / Waive / Override / Escalate / Reject /
 * RequestMoreInfo dialogs.
 */
import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { P5_REASON_CODES, type P5ReasonCode } from "@/lib/p5-governance/constants";
import { toast } from "sonner";

export interface ReasonedFields {
  reason_code: P5ReasonCode;
  note: string;
  extra?: Record<string, string>;
}

export interface ExtraField {
  name: string;
  label: string;
  required?: boolean;
  type?: "text" | "date" | "datetime-local";
  placeholder?: string;
}

export interface ReasonedActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Optional warning banner (e.g. "Override is audited and exceptional"). */
  warning?: string;
  /** Subset of reason codes appropriate to this action. */
  reasonCodes?: readonly P5ReasonCode[];
  extraFields?: ExtraField[];
  confirmLabel?: string;
  confirmVariant?: "default" | "destructive";
  onSubmit: (values: ReasonedFields) => Promise<void>;
}

export function ReasonedActionDialog({
  open,
  onOpenChange,
  title,
  description,
  warning,
  reasonCodes = P5_REASON_CODES,
  extraFields = [],
  confirmLabel = "Confirm",
  confirmVariant = "default",
  onSubmit,
}: ReasonedActionDialogProps) {
  const [reasonCode, setReasonCode] = useState<P5ReasonCode | "">("");
  const [note, setNote] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setReasonCode("");
    setNote("");
    setExtra({});
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    if (!reasonCode) {
      toast.error("Reason code is required");
      return;
    }
    if (!note.trim()) {
      toast.error("Note is required");
      return;
    }
    for (const f of extraFields) {
      if (f.required && !extra[f.name]?.trim()) {
        toast.error(`${f.label} is required`);
        return;
      }
    }
    setSubmitting(true);
    try {
      await onSubmit({ reason_code: reasonCode, note: note.trim(), extra });
      toast.success(`${title} recorded`);
      reset();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Action failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {warning && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            data-testid="p5-action-warning"
          >
            {warning}
          </div>
        )}

        <div className="space-y-4">
          {extraFields.map((f) => (
            <div key={f.name} className="space-y-1.5">
              <Label htmlFor={`p5-extra-${f.name}`}>
                {f.label}
                {f.required ? " *" : ""}
              </Label>
              <Input
                id={`p5-extra-${f.name}`}
                type={f.type ?? "text"}
                placeholder={f.placeholder}
                value={extra[f.name] ?? ""}
                onChange={(e) =>
                  setExtra((prev) => ({ ...prev, [f.name]: e.target.value }))
                }
              />
            </div>
          ))}

          <div className="space-y-1.5">
            <Label htmlFor="p5-reason-code">Reason code *</Label>
            <Select
              value={reasonCode}
              onValueChange={(v) => setReasonCode(v as P5ReasonCode)}
            >
              <SelectTrigger id="p5-reason-code" aria-label="Reason code">
                <SelectValue placeholder="Select a reason code" />
              </SelectTrigger>
              <SelectContent>
                {reasonCodes.map((rc) => (
                  <SelectItem key={rc} value={rc}>
                    {rc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p5-note">Note *</Label>
            <Textarea
              id="p5-note"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Operational note (recorded in audit timeline)"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            onClick={handleSubmit}
            disabled={submitting || !reasonCode || !note.trim()}
            data-testid="p5-action-confirm"
          >
            {submitting ? "Submitting…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
