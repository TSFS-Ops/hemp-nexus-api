/**
 * P-5 Batch 7 — Phase 5
 * Stale-data acknowledgement banner. Acknowledgement is audited.
 */
import { useState } from "react";
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
import { useAsyncAction } from "@/hooks/use-async-action";
import { p5b7AcknowledgeStaleData } from "@/lib/p5-batch7/actions";
import type { P5Batch7Dashboard } from "@/lib/p5-batch7/registry";

export function P5B7StaleAckBanner({
  dashboard,
  asOf,
  isStale,
}: {
  dashboard: P5Batch7Dashboard;
  asOf: string | null;
  isStale: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [reason, setReason] = useState("");
  const submit = useAsyncAction(async () => {
    await p5b7AcknowledgeStaleData({ dashboard, asOf, reason });
    setAck(true);
    setOpen(false);
  }, { successMessage: "Acknowledgement recorded" });

  if (!isStale && asOf) return null;

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md border bg-amber-50 text-amber-900 px-3 py-2 text-xs"
      data-p5b7-stale-banner
    >
      <span>
        {asOf
          ? "Data temporarily unavailable — showing the most recent available snapshot."
          : "Awaiting provider response — no fresh data available for this surface."}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => setOpen(true)}
        disabled={ack}
      >
        {ack ? "Acknowledged" : "Acknowledge"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acknowledge stale data</DialogTitle>
            <DialogDescription>
              Acknowledgement is recorded in the audit log against your account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="p5b7-stale-reason">Reason (min 5 characters)</Label>
            <Textarea
              id="p5b7-stale-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit.run} disabled={submit.loading || reason.trim().length < 5}>
              {submit.loading ? "Submitting…" : "Acknowledge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
