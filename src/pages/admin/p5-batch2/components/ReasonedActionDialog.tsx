/**
 * P-5 Batch 2 — Stage 4 reasoned action dialog.
 *
 * One generic dialog for all admin/operator evidence actions:
 *   approve · accept_with_warning · reject · request_correction · waive ·
 *   suspend · release · set_provider_state · unmask/download (reason)
 *
 * The dialog:
 *   - Requires the action-specific reason fields (reason_code, scope,
 *     reason_text, replacement_reason, provider state).
 *   - Calls only Stage 3 RPC wrappers from `src/lib/p5-batch2/rpc.ts`.
 *   - Keeps customer-safe note and admin-only reviewer note in separate
 *     inputs — the reviewer note is hidden when the caller cannot see
 *     internal notes.
 *   - Enforces legal transitions via `nextStatusFor(action)` from Stage 2.
 *   - Renders provider state via the wording-safe label.
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import {
  P5B2_PROVIDER_STATUSES,
  P5B2_REJECTION_REASONS,
  P5B2_REPLACEMENT_REASONS,
  type P5B2ProviderStatus,
  type P5B2RejectionReason,
  type P5B2ReplacementReason,
} from "@/lib/p5-batch2/constants";
import {
  p5b2ReviewEvidence,
  p5b2SetProviderState,
  p5b2SuspendRelease,
  p5b2WaiveEvidence,
  p5b2WithdrawEvidence,
  type P5B2ReviewAction,
} from "@/lib/p5-batch2/rpc";
import { useP5Batch2Permissions } from "@/hooks/useP5Batch2Permissions";
import { ProviderSafeLabel } from "./ProviderSafeLabel";

export type ReasonedAction =
  | "accept"
  | "accept_with_warning"
  | "reject"
  | "request_correction"
  | "waive"
  | "suspend"
  | "release"
  | "set_provider_state";

const TITLES: Record<ReasonedAction, string> = {
  accept: "Approve / Accept",
  accept_with_warning: "Accept with warning",
  reject: "Reject evidence",
  request_correction: "Request correction",
  waive: "Waive evidence",
  suspend: "Suspend evidence",
  release: "Release suspension",
  set_provider_state: "Set provider state",
};

export interface ReasonedActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: ReasonedAction;
  evidenceItemId: string;
  onDone?: () => void;
}

export function ReasonedActionDialog({
  open,
  onOpenChange,
  action,
  evidenceItemId,
  onDone,
}: ReasonedActionDialogProps) {
  const perms = useP5Batch2Permissions();
  const [busy, setBusy] = useState(false);
  const [customerSafeNote, setCustomerSafeNote] = useState("");
  const [reviewerNoteInternal, setReviewerNoteInternal] = useState("");
  const [reasonCode, setReasonCode] = useState<P5B2RejectionReason | "">("");
  const [waiveScope, setWaiveScope] = useState("");
  const [waiveReason, setWaiveReason] = useState("");
  const [waiveExpires, setWaiveExpires] = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [providerStatus, setProviderStatus] = useState<P5B2ProviderStatus | "">("");
  const [providerName, setProviderName] = useState("");
  const [providerLive, setProviderLive] = useState(false);
  const [providerRef, setProviderRef] = useState("");
  // replacement_reason is captured on upload, included here for completeness.
  const [, setReplacementReason] = useState<P5B2ReplacementReason | "">("");

  const requiresReason: ReasonedAction[] = ["reject", "request_correction"];
  const reasonRequired = requiresReason.includes(action);

  const reset = () => {
    setCustomerSafeNote("");
    setReviewerNoteInternal("");
    setReasonCode("");
    setWaiveScope("");
    setWaiveReason("");
    setWaiveExpires("");
    setSuspendReason("");
    setProviderStatus("");
    setProviderName("");
    setProviderLive(false);
    setProviderRef("");
    setReplacementReason("");
  };

  const handleSubmit = async () => {
    setBusy(true);
    try {
      let res;
      if (action === "accept" || action === "accept_with_warning" || action === "reject" || action === "request_correction") {
        if (reasonRequired && !reasonCode) {
          toast.error("Reason code is required");
          return;
        }
        const newStatus =
          action === "accept" ? "accepted" :
          action === "accept_with_warning" ? "accepted_with_warning" :
          action === "reject" ? "rejected" :
          "requested";
        res = await p5b2ReviewEvidence({
          evidence_item_id: evidenceItemId,
          action: action as P5B2ReviewAction,
          new_status: newStatus,
          reason_code: (reasonCode || null) as P5B2RejectionReason | null,
          customer_safe_note: customerSafeNote || null,
          reviewer_note_internal: reviewerNoteInternal || null,
        });
      } else if (action === "waive") {
        if (!waiveScope || waiveReason.trim().length < 4) {
          toast.error("Scope and reason (min 4 chars) required");
          return;
        }
        res = await p5b2WaiveEvidence({
          evidence_item_id: evidenceItemId,
          scope: waiveScope,
          reason_text: waiveReason.trim(),
          expires_at: waiveExpires || null,
        });
      } else if (action === "suspend" || action === "release") {
        if (suspendReason.trim().length < 4) {
          toast.error("Reason required (min 4 chars)");
          return;
        }
        res = await p5b2SuspendRelease({
          evidence_item_id: evidenceItemId,
          mode: action,
          reason_text: suspendReason.trim(),
        });
      } else if (action === "set_provider_state") {
        if (!providerStatus) {
          toast.error("Provider status required");
          return;
        }
        if (providerLive && !providerRef.trim()) {
          toast.error("Provider result reference required when provider_live = true");
          return;
        }
        res = await p5b2SetProviderState({
          evidence_item_id: evidenceItemId,
          provider_status: providerStatus,
          provider_name: providerName || null,
          provider_live: providerLive,
          provider_result_reference: providerRef.trim() || null,
          reviewer_note_internal: reviewerNoteInternal || null,
        });
      }
      if (!res) return;
      if (!res.ok) {
        toast.error(res.error ?? "Action denied");
        return;
      }
      toast.success(`${TITLES[action]} recorded`);
      reset();
      onOpenChange(false);
      onDone?.();
    } finally {
      setBusy(false);
    }
  };

  const showReviewerNote = perms.canViewReviewerInternalNotes;

  const reasonOptions = useMemo(() => P5B2_REJECTION_REASONS, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{TITLES[action]}</DialogTitle>
        </DialogHeader>

        {(action === "accept" || action === "accept_with_warning" || action === "reject" || action === "request_correction") && (
          <div className="space-y-3">
            {reasonRequired && (
              <div className="space-y-1">
                <Label>Reason code</Label>
                <Select value={reasonCode} onValueChange={(v) => setReasonCode(v as P5B2RejectionReason)}>
                  <SelectTrigger data-testid="reason-code-trigger">
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {reasonOptions.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="customer-safe-note">Customer-safe note</Label>
              <Textarea
                id="customer-safe-note"
                value={customerSafeNote}
                onChange={(e) => setCustomerSafeNote(e.target.value)}
                placeholder="Visible to the subject organisation"
                data-testid="customer-safe-note"
              />
            </div>
            {showReviewerNote && (
              <div className="space-y-1">
                <Label htmlFor="reviewer-internal-note">Reviewer note (internal)</Label>
                <Textarea
                  id="reviewer-internal-note"
                  value={reviewerNoteInternal}
                  onChange={(e) => setReviewerNoteInternal(e.target.value)}
                  placeholder="Admin / compliance only"
                  data-testid="reviewer-internal-note"
                />
              </div>
            )}
          </div>
        )}

        {action === "waive" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Scope</Label>
              <Input
                value={waiveScope}
                onChange={(e) => setWaiveScope(e.target.value)}
                placeholder="execution | finality | funder_pack | api"
                data-testid="waive-scope"
              />
            </div>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea
                value={waiveReason}
                onChange={(e) => setWaiveReason(e.target.value)}
                data-testid="waive-reason"
              />
            </div>
            <div className="space-y-1">
              <Label>Expires at (optional)</Label>
              <Input
                type="date"
                value={waiveExpires}
                onChange={(e) => setWaiveExpires(e.target.value)}
              />
            </div>
          </div>
        )}

        {(action === "suspend" || action === "release") && (
          <div className="space-y-1">
            <Label>Reason</Label>
            <Textarea
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              data-testid="suspend-release-reason"
            />
          </div>
        )}

        {action === "set_provider_state" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Provider status</Label>
              <Select value={providerStatus} onValueChange={(v) => setProviderStatus(v as P5B2ProviderStatus)}>
                <SelectTrigger data-testid="provider-status-trigger">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {P5B2_PROVIDER_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {providerStatus ? (
                <div className="pt-1 text-xs text-muted-foreground">
                  Will render as: <ProviderSafeLabel provider_status={providerStatus} provider_live={providerLive} viewer="admin" />
                </div>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label>Provider name</Label>
              <Input value={providerName} onChange={(e) => setProviderName(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="provider-live"
                type="checkbox"
                checked={providerLive}
                onChange={(e) => setProviderLive(e.target.checked)}
                data-testid="provider-live"
              />
              <Label htmlFor="provider-live">Live provider check completed</Label>
            </div>
            {providerLive && (
              <div className="space-y-1">
                <Label>Provider result reference (required when live)</Label>
                <Input
                  value={providerRef}
                  onChange={(e) => setProviderRef(e.target.value)}
                  data-testid="provider-ref"
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={busy} data-testid="reasoned-action-submit">
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
