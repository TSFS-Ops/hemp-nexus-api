/**
 * D3 - Admin "Record dispute" dialog (Option C / D2a wiring).
 *
 * Wraps POST /poi-engagements/:id/dispute. Two truthful sources are
 * supported by the server (see Batch D - D1.6 / D2a):
 *
 *   • dispute_source = "admin_report"        - token_hash MAY be omitted
 *   • dispute_source = "counterparty_token"  - token_hash REQUIRED
 *
 * The dialog mirrors that contract on the client. Validation is purely
 * frontend UX guard; the edge function is the source of truth.
 *
 * No public/counterparty self-dispute UI lives here - that is intentionally
 * out of D3 scope.
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";

export const disputeEngagementSchema = z
  .object({
    reason: z.string().trim().min(10).max(1000),
    dispute_source: z.enum(["counterparty_token", "admin_report"]),
    token_hash: z.string().trim().min(1).max(256).optional().or(z.literal("")),
  })
  .superRefine((val, ctx) => {
    if (val.dispute_source === "counterparty_token") {
      if (!val.token_hash || val.token_hash.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["token_hash"],
          message:
            "token_hash is required when dispute_source='counterparty_token'",
        });
      }
    }
  });

export type DisputeEngagementInput = z.infer<typeof disputeEngagementSchema>;

export interface DisputeEngagementTarget {
  id: string;
  match_id: string;
  counterparty_email?: string | null;
  counterparty_org_name?: string | null;
}

interface Props {
  open: boolean;
  engagement: DisputeEngagementTarget | null;
  onClose: () => void;
  onResolved: () => void;
}

export function DisputeEngagementDialog({
  open,
  engagement,
  onClose,
  onResolved,
}: Props) {
  const [source, setSource] =
    useState<"admin_report" | "counterparty_token">("admin_report");
  const [tokenHash, setTokenHash] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setSource("admin_report");
    setTokenHash("");
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
    const parsed = disputeEngagementSchema.safeParse({
      reason,
      dispute_source: source,
      token_hash: source === "counterparty_token" ? tokenHash : undefined,
    });
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      const first =
        fieldErrors.reason?.[0] ??
        fieldErrors.token_hash?.[0] ??
        "Dispute payload failed validation.";
      toast.error(first);
      return;
    }
    setSubmitting(true);
    try {
      const idemKey = `dispute-${engagement.id}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const body: Record<string, unknown> = {
        reason: parsed.data.reason,
        dispute_source: parsed.data.dispute_source,
      };
      if (
        parsed.data.dispute_source === "counterparty_token" &&
        parsed.data.token_hash
      ) {
        body.token_hash = parsed.data.token_hash.trim();
      }
      const { error } = await supabase.functions.invoke(
        `poi-engagements/${engagement.id}/dispute`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idemKey },
          body,
        },
      );
      if (error) {
        let message: string =
          (error as { message?: string }).message ?? "Failed to record dispute.";
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
      toast.success("Dispute recorded - engagement is now blocked.");
      reset();
      onResolved();
      onClose();
    } catch (err) {
      console.error("dispute record failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to record dispute.",
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
          <DialogTitle>Record counterparty dispute</DialogTitle>
          <DialogDescription>
            Engagement{" "}
            <span className="font-mono">{engagement.id.substring(0, 8)}…</span>
            {engagement.counterparty_org_name
              ? <> - counterparty <strong>{engagement.counterparty_org_name}</strong></>
              : null}
            . Use this when the named counterparty has told us they are not
            involved. Outreach is blocked once recorded.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              How was the dispute reported?
            </Label>
            <RadioGroup
              value={source}
              onValueChange={(v) =>
                setSource(v as "admin_report" | "counterparty_token")
              }
              className="mt-2 space-y-2"
            >
              <label className="flex items-start gap-2 cursor-pointer">
                <RadioGroupItem value="admin_report" id="dispute-admin" />
                <div>
                  <div className="text-sm font-medium">Admin report (off-platform)</div>
                  <div className="text-xs text-muted-foreground">
                    Counterparty told us by phone, email or in person. No token hash required.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <RadioGroupItem value="counterparty_token" id="dispute-token" />
                <div>
                  <div className="text-sm font-medium">Counterparty self-served via tokenised link</div>
                  <div className="text-xs text-muted-foreground">
                    The recipient clicked the dispute link themselves. Token hash is required.
                  </div>
                </div>
              </label>
            </RadioGroup>
          </div>

          {source === "counterparty_token" && (
            <div>
              <Label htmlFor="dispute-token-hash" className="text-xs uppercase tracking-wide text-muted-foreground">
                Token hash
              </Label>
              <Input
                id="dispute-token-hash"
                value={tokenHash}
                onChange={(e) => setTokenHash(e.target.value)}
                placeholder="SHA-256 hash from the dispute link"
                className="mt-1 font-mono text-xs"
              />
            </div>
          )}

          <div>
            <Label htmlFor="dispute-reason" className="text-xs uppercase tracking-wide text-muted-foreground">
              Reason (10–1000 chars, audited)
            </Label>
            <Textarea
              id="dispute-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="Summarise what the counterparty said and how you verified them. Saved verbatim into the audit log."
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
            Record dispute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
