/**
 * MatchDisputeBeingNamedPanel
 *
 * CP-012 user-facing surface rendered on `/desk/match/:matchId` whenever
 * the Pending Engagement is in `disputed_being_named`.
 *
 * Daniel-spec acceptance text (do NOT rephrase — these strings are pinned
 * by `src/tests/cp-012-deal-desk-dispute-panel.test.tsx`):
 *
 *   • Initiator copy
 *   • Counterparty copy
 *   • Platform-admin copy + Release / Close controls
 *
 * Release / Close hit the same signed endpoints the admin panel uses:
 *   POST /poi-engagements/:id/dispute-release
 *   POST /poi-engagements/:id/dispute-close
 * which emit `dispute.counterparty_named_dispute_released` /
 * `dispute.counterparty_named_dispute_closed` audits respectively.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

async function extractEdgeError(err: any, fallback: string): Promise<string> {
  try {
    const ctx = err?.context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
      if (body?.message) return String(body.message);
    }
  } catch {
    /* swallow */
  }
  return err?.message ? String(err.message) : fallback;
}

export const CP012_INITIATOR_MESSAGE =
  "The named counterparty has disputed being linked to this trade. The match is now on dispute hold. No POI, WaD, execution step, credit burn, or further progression can occur until Izenzo admin reviews the dispute.";

export const CP012_COUNTERPARTY_MESSAGE =
  "Your dispute has been recorded. The trade has been placed on hold and will not progress unless reviewed and released by Izenzo admin.";

export const CP012_ADMIN_MESSAGE =
  "Counterparty disputes being named in this trade. Review counterparty identity, authority, outreach history, and initiator records before releasing or closing the dispute.";

export type DisputeViewerRole = "initiator" | "counterparty" | "other";

interface Props {
  engagementId: string;
  engagementStatus: string | null;
  operationalState?: string | null;
  counterpartyResponse?: string | null;
  viewerRole: DisputeViewerRole;
  isPlatformAdmin: boolean;
  onResolved?: () => void;
}

export function MatchDisputeBeingNamedPanel({
  engagementId,
  engagementStatus,
  operationalState,
  counterpartyResponse,
  viewerRole,
  isPlatformAdmin,
  onResolved,
}: Props) {
  const [dialog, setDialog] = useState<null | "dispute-release" | "dispute-close">(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Only render when the engagement is actually in the disputed-being-named
  // state. This guards against accidental mounting from a stale prop.
  if (engagementStatus !== "disputed_being_named") return null;

  const submit = async () => {
    if (!dialog) return;
    const trimmed = reason.trim();
    if (trimmed.length < 10) {
      toast.error("Resolution reason must be at least 10 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke(
        `poi-engagements/${engagementId}/${dialog}`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: { resolution_reason: trimmed },
        },
      );
      if (error) throw error;
      toast.success(
        dialog === "dispute-release" ? "Dispute released." : "Dispute closed.",
      );
      setDialog(null);
      setReason("");
      onResolved?.();
    } catch (err) {
      console.error("CP-012 dispute resolution error:", err);
      const msg = await extractEdgeError(err, "Failed to resolve dispute");
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card
      className="border-red-500/40 bg-red-500/5"
      data-testid="cp012-dispute-panel"
      aria-labelledby="cp012-dispute-heading"
    >
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle
            id="cp012-dispute-heading"
            className="flex items-center gap-2 text-lg"
          >
            <ShieldAlert className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
            Dispute hold active
          </CardTitle>
          <div className="flex flex-wrap items-end justify-end gap-1.5">
            <Badge
              variant="outline"
              className="border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400 text-xs"
              data-testid="cp012-status-badge"
            >
              Status: disputed_being_named
            </Badge>
            <Badge
              variant="outline"
              className="border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400 text-xs"
              data-testid="cp012-counterparty-response-badge"
            >
              Counterparty response: {counterpartyResponse || "disputes_being_named"}
            </Badge>
            <Badge
              variant="outline"
              className="border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400 text-[10px]"
              data-testid="cp012-dispute-active-badge"
            >
              DISPUTE_ACTIVE guard
            </Badge>
            {operationalState ? (
              <Badge
                variant="outline"
                className="border-muted-foreground/30 bg-muted text-muted-foreground text-[10px]"
              >
                Operational: {operationalState}
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {viewerRole === "initiator" && (
          <p
            className="text-sm text-foreground/90 leading-relaxed"
            data-testid="cp012-initiator-message"
          >
            {CP012_INITIATOR_MESSAGE}
          </p>
        )}

        {viewerRole === "counterparty" && (
          <p
            className="text-sm text-foreground/90 leading-relaxed"
            data-testid="cp012-counterparty-message"
          >
            {CP012_COUNTERPARTY_MESSAGE}
          </p>
        )}

        {isPlatformAdmin && (
          <div
            className="rounded-md border border-red-500/40 bg-red-500/10 p-4 space-y-3"
            data-testid="cp012-admin-block"
          >
            <p className="text-sm font-semibold text-red-900 dark:text-red-200">
              Platform admin review required
            </p>
            <p
              className="text-sm text-foreground/90 leading-relaxed"
              data-testid="cp012-admin-message"
            >
              {CP012_ADMIN_MESSAGE}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="default"
                onClick={() => setDialog("dispute-release")}
                data-testid="cp012-release-button"
              >
                <ShieldCheck className="h-4 w-4 mr-1.5" />
                Release dispute
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDialog("dispute-close")}
                data-testid="cp012-close-button"
              >
                <XCircle className="h-4 w-4 mr-1.5" />
                Close dispute
              </Button>
            </div>
          </div>
        )}

        <p
          className="text-xs text-muted-foreground leading-relaxed"
          data-testid="cp012-progression-block-note"
        >
          POI generation, WaD sealing, execution steps, credit burns, and
          further outreach on this match are blocked by DISPUTE_ACTIVE until
          an Izenzo platform admin releases or closes this dispute.
        </p>
      </CardContent>

      <Dialog open={dialog !== null} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "dispute-release" ? "Release dispute hold" : "Close dispute"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "dispute-release"
                ? "Restore the engagement to its previous state and allow the trade to progress. Recorded for audit."
                : "Close the dispute and decline the engagement. Recorded for audit."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cp012-resolution-reason">Resolution reason</Label>
            <Textarea
              id="cp012-resolution-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Minimum 10 characters. Recorded in the audit trail."
              rows={4}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={submitting}>Cancel</Button>
            </DialogClose>
            <Button
              onClick={submit}
              disabled={submitting || reason.trim().length < 10}
              data-testid="cp012-resolution-submit"
            >
              {dialog === "dispute-release" ? "Release" : "Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
