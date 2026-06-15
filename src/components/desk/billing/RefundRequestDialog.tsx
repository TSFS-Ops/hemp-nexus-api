/**
 * DEC-007 - Org-side Refund Request dialog.
 *
 * Allows an org member to record a refund request against one of their
 * own completed token_purchases. Calls the existing `refund-request`
 * edge function, which performs all eligibility classification and
 * audit emission server-side. No live provider refund is triggered
 * from the client.
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, AlertCircle } from "lucide-react";
import {
  REFUND_REASON_CODES,
  DEC_007_REFUND_POLICY,
  type RefundReasonCode,
} from "@/lib/policy/dec-007-refund-policy";
import { parseEdgeError } from "@/lib/edge-error";

const REASON_LABELS: Record<RefundReasonCode, string> = {
  unused_within_window: "Unused credits - within refund window",
  unused_outside_window: "Unused credits - outside refund window",
  accidental_purchase: "Accidental purchase",
  duplicate_purchase: "Duplicate purchase",
  service_dissatisfaction: "Service dissatisfaction",
  other: "Other",
};

const MIN_DETAIL = DEC_007_REFUND_POLICY.minAdminReasonLength;

interface RefundRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tokenPurchaseId: string;
  purchaseLabel: string;
  onSuccess?: () => void;
}

export function RefundRequestDialog({
  open,
  onOpenChange,
  tokenPurchaseId,
  purchaseLabel,
  onSuccess,
}: RefundRequestDialogProps) {
  const [reasonCode, setReasonCode] = useState<RefundReasonCode | "">("");
  const [reasonDetail, setReasonDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const detailTooShort = reasonDetail.trim().length < MIN_DETAIL;
  const canSubmit = !!reasonCode && !detailTooShort && !submitting;

  const reset = () => {
    setReasonCode("");
    setReasonDetail("");
    setSubmitting(false);
    setSubmitError(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !reasonCode) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data, error } = await supabase.functions.invoke("refund-request", {
        body: {
          token_purchase_id: tokenPurchaseId,
          reason_code: reasonCode,
          reason_detail: reasonDetail.trim(),
        },
      });
      if (error) {
        const parsed = await parseEdgeError(error);
        setSubmitError(parsed.message);
        toast.error(parsed.message);
        return;
      }
      const code = (data as { code?: string; success?: boolean } | null)?.code;
      const success = (data as { success?: boolean } | null)?.success;
      if (success === false) {
        const msg =
          code === "REFUND_ALREADY_PENDING"
            ? "A refund request is already pending for this purchase."
            : code === "PURCHASE_NOT_FOUND"
              ? "Purchase not found."
              : code === "REASON_REQUIRED"
                ? "Please provide a reason of at least 20 characters."
                : code === "BLOCKED_CREDITS_USED"
                  ? "Credits from this purchase have already been used, so a refund cannot be requested."
                  : code === "BLOCKED_EXPIRED"
                    ? "This purchase is outside the refund window and cannot be refunded."
                    : "We couldn't record your refund request. Please try again.";
        setSubmitError(msg);
        toast.error(msg);
        return;
      }
      toast.success("Refund request submitted for review.");
      reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (err: unknown) {
      console.error("[refund-request] submit error", err);
      const parsed = await parseEdgeError(err);
      setSubmitError(parsed.message);
      toast.error(parsed.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request refund</DialogTitle>
          <DialogDescription>
            This records a refund request for review. It does not trigger a
            live provider refund automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Purchase: <span className="font-medium text-foreground">{purchaseLabel}</span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="refund-reason-code">Reason</Label>
            <Select
              value={reasonCode}
              onValueChange={(v) => setReasonCode(v as RefundReasonCode)}
            >
              <SelectTrigger id="refund-reason-code" data-testid="refund-reason-code">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {REFUND_REASON_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {REASON_LABELS[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="refund-reason-detail">
              Details <span className="text-muted-foreground">(min {MIN_DETAIL} characters)</span>
            </Label>
            <Textarea
              id="refund-reason-detail"
              data-testid="refund-reason-detail"
              value={reasonDetail}
              onChange={(e) => setReasonDetail(e.target.value)}
              placeholder="Briefly explain why you're requesting a refund."
              rows={4}
              maxLength={2000}
            />
            <div className="text-xs text-muted-foreground">
              {reasonDetail.trim().length}/{MIN_DETAIL} minimum
            </div>
          </div>
        </div>
        {submitError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Refund request not submitted</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="refund-submit"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Submitting…
              </>
            ) : (
              "Submit refund request"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
