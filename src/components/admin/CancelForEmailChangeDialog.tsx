/**
 * D3 — Admin "Cancel for email change" dialog (D2a wiring).
 *
 * Wraps POST /poi-engagements/:id/cancel-for-email-change. Used when the
 * recorded counterparty email turns out to be wrong AND outreach has
 * already started, so the PATCH email-change path is refused with
 * `EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE`. The only safe path is to
 * cancel the live engagement and create a replacement.
 *
 * D2a deliberately implements the cancel half only. Replacement creation
 * is left to the existing engagement-creation flow on success — the
 * toast message points the operator at it explicitly.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

export const cancelForEmailChangeSchema = z.object({
  new_email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, { message: "Enter the corrected counterparty email." })
    .max(254, { message: "Email must be 254 characters or fewer." })
    .email({ message: "Enter a valid email address." })
    .refine(
      (v) => !v.endsWith(".invalid") && v !== "invalid",
      { message: "Reserved .invalid TLD is not deliverable." },
    ),
  reason: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type CancelForEmailChangeInput = z.infer<typeof cancelForEmailChangeSchema>;

export interface CancelEngagementTarget {
  id: string;
  match_id: string;
  counterparty_email?: string | null;
  counterparty_org_name?: string | null;
}

interface Props {
  open: boolean;
  engagement: CancelEngagementTarget | null;
  onClose: () => void;
  onResolved: () => void;
}

export function CancelForEmailChangeDialog({
  open,
  engagement,
  onClose,
  onResolved,
}: Props) {
  const [newEmail, setNewEmail] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setNewEmail("");
    setReason("");
    setSubmitting(false);
  };

  const close = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const submit = async () => {
    if (!engagement) return;
    const parsed = cancelForEmailChangeSchema.safeParse({
      new_email: newEmail,
      reason: reason || undefined,
    });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      const first =
        fieldErrors.new_email?.[0] ??
        fieldErrors.reason?.[0] ??
        "Invalid input.";
      toast.error(first);
      return;
    }
    setSubmitting(true);
    try {
      const idemKey = `cancel-email-${engagement.id}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const body: Record<string, unknown> = {
        new_email: parsed.data.new_email,
      };
      if (parsed.data.reason) body.reason = parsed.data.reason;
      const { error } = await supabase.functions.invoke(
        `poi-engagements/${engagement.id}/cancel-for-email-change`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idemKey },
          body,
        },
      );
      if (error) {
        let message: string =
          (error as { message?: string }).message ?? "Failed to cancel engagement.";
        try {
          const ctxBody = (error as { context?: { body?: unknown } }).context?.body;
          const parsedBody =
            typeof ctxBody === "string" ? JSON.parse(ctxBody) : ctxBody;
          if (parsedBody && typeof parsedBody === "object") {
            const code = (parsedBody as { code?: string; error?: string }).code
              ?? (parsedBody as { code?: string; error?: string }).error;
            const msg = (parsedBody as { message?: string }).message;
            if (code) message = msg ? `${code}: ${msg}` : code;
          }
        } catch { /* ignore */ }
        throw new Error(message);
      }
      toast.success(
        "Old engagement cancelled. Create a replacement engagement with the corrected email.",
      );
      reset();
      onResolved();
      onClose();
    } catch (err) {
      console.error("cancel-for-email-change failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to cancel engagement.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!engagement) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Cancel engagement for email change</DialogTitle>
          <DialogDescription>
            Engagement{" "}
            <span className="font-mono">{engagement.id.substring(0, 8)}…</span>
            {engagement.counterparty_email
              ? <> — current email <span className="font-mono">{engagement.counterparty_email}</span></>
              : null}
            .
          </DialogDescription>
        </DialogHeader>

        <div
          className="rounded-md border border-amber-200 bg-amber-50 text-amber-950 px-3 py-2 text-xs leading-relaxed"
          data-testid="cp015-email-change-required-wording"
          role="alert"
        >
          Counterparty email cannot be edited silently after a Pending
          Engagement has been created. The existing engagement will be
          cancelled and a new engagement must be created with the
          corrected email. The original record will remain in the audit
          trail.
        </div>


        <div className="space-y-4">
          <div>
            <Label htmlFor="cancel-new-email" className="text-xs uppercase tracking-wide text-muted-foreground">
              Corrected counterparty email
            </Label>
            <Input
              id="cancel-new-email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="ops@counterparty.example.com"
              className="mt-1"
              autoComplete="off"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Recorded for audit. Use it when you create the replacement engagement.
            </p>
          </div>

          <div>
            <Label htmlFor="cancel-reason" className="text-xs uppercase tracking-wide text-muted-foreground">
              Reason (optional, ≤1000 chars)
            </Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="How was the email correction confirmed (call, reply, ticket)?"
              className="mt-1"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {reason.trim().length} / 1000
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Cancel engagement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
