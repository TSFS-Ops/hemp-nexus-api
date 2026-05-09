/**
 * AdminChallengeReviewDrawer — Phase 3C
 *
 * Right-side Sheet showing read-only challenge context plus admin actions
 * gated by the current status. Server is the authoritative gate; the
 * `isPlatformAdmin` check here is belt-and-braces.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/loading-button";
import { Badge } from "@/components/ui/badge";
import {
  CHALLENGE_OUTCOME_LABELS,
  type ChallengeOutcomeCode,
} from "@/lib/challenge-outcomes";
import { useAuth } from "@/contexts/AuthContext";
import { useTransitionChallenge } from "@/hooks/useAdminChallengeMutations";
import { useChallengeOverrideAudit } from "@/hooks/useChallengeOverrideAudit";
import {
  ADMIN_OVERRIDE_REASON_CATEGORY_LABELS,
  REGULATOR_REFERENCE_NOT_APPLICABLE,
  type AdminOverrideReasonCategory,
} from "@/lib/challenge-override-categories";
import type { ChallengeRow } from "@/hooks/useMatchChallenge";
import { RecordOutcomeDialog } from "./RecordOutcomeDialog";
import { AdminOverrideDialog } from "./AdminOverrideDialog";
import { ChallengeCommentThread } from "@/components/match/ChallengeCommentThread";
import { ChallengeCommentComposer } from "@/components/match/ChallengeCommentComposer";
import { ChallengeEvidenceList } from "@/components/match/ChallengeEvidenceList";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  under_review: "Under review",
  outcome_recorded: "Outcome recorded",
  withdrawn: "Withdrawn",
  closed_no_action: "Closed — no action",
};

const SUBJECT_LABEL: Record<string, string> = {
  terms_disagreement: "Terms disagreement",
  evidence_quality_concern: "Evidence quality concern",
  identity_concern: "Identity concern",
  compliance_concern: "Compliance concern",
  delivery_or_settlement_concern: "Delivery or settlement concern",
  other: "Other",
};

function fmt(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export interface AdminChallengeReviewDrawerProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  challenge: ChallengeRow | null;
}

export function AdminChallengeReviewDrawer({ open, onOpenChange, challenge }: AdminChallengeReviewDrawerProps) {
  const { isPlatformAdmin } = useAuth();
  const transition = useTransitionChallenge();
  const [outcomeMode, setOutcomeMode] = useState<"outcome_recorded" | "closed_no_action" | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);

  const isAdminOverride =
    !!challenge &&
    challenge.outcome_code === "admin_override_recorded" &&
    !!challenge.break_glass_override_used;

  const overrideAuditQ = useChallengeOverrideAudit(challenge?.id ?? null, isAdminOverride);

  if (!challenge) return null;

  const isOpen = challenge.status === "open";
  const isUnderReview = challenge.status === "under_review";
  const isTerminal = !isOpen && !isUnderReview;

  const handleMoveToReview = async () => {
    try {
      await transition.mutateAsync({
        challenge_id: challenge.id,
        match_id: challenge.match_id,
        to_status: "under_review",
      });
      toast.success("Challenge moved to under review.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not move the challenge.";
      toast.error(msg);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl overflow-y-auto"
          data-testid="admin-challenge-drawer"
        >
          <SheetHeader>
            <div className="flex items-center justify-between gap-3">
              <SheetTitle>Challenge review</SheetTitle>
              <Badge
                variant="outline"
                data-testid="drawer-status-badge"
                className="text-xs border-border bg-muted text-foreground"
              >
                {STATUS_LABEL[challenge.status] ?? challenge.status}
              </Badge>
            </div>
            <SheetDescription>
              Read-only summary of the challenge with the actions available to platform administrators.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 py-5 text-sm">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Subject</dt>
                <dd>{SUBJECT_LABEL[challenge.subject_code] ?? challenge.subject_code}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Raised by</dt>
                <dd>{challenge.raised_by_role ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Raised at</dt>
                <dd className="font-mono text-xs">{fmt(challenge.created_at)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Match</dt>
                <dd className="font-mono text-xs">
                  <Link to={`/desk/match/${challenge.match_id}`} className="text-primary hover:underline">
                    {challenge.match_id.slice(0, 8)}…
                  </Link>
                </dd>
              </div>
              {isTerminal && (
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Closed at</dt>
                  <dd className="font-mono text-xs">{fmt(challenge.closed_at)}</dd>
                </div>
              )}
            </dl>

            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Summary</div>
              <p className="whitespace-pre-wrap leading-relaxed" data-testid="drawer-summary">
                {challenge.summary}
              </p>
            </div>

            {isTerminal && challenge.outcome_code && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Outcome</div>
                <p className="text-foreground">
                  {CHALLENGE_OUTCOME_LABELS[challenge.outcome_code as ChallengeOutcomeCode] ??
                    challenge.outcome_code}
                </p>
                {challenge.outcome_summary && (
                  <p className="text-muted-foreground text-xs mt-1 whitespace-pre-wrap">
                    {challenge.outcome_summary}
                  </p>
                )}
              </div>
            )}

            <div className="border-t border-border pt-4 space-y-3">
              <h4 className="text-xs uppercase tracking-wide text-muted-foreground">
                Comments
              </h4>
              <ChallengeCommentThread challengeId={challenge.id} />
              {!isTerminal && isPlatformAdmin && (
                <ChallengeCommentComposer
                  challengeId={challenge.id}
                  authorRole="platform_admin"
                />
              )}
            </div>

            <div className="border-t border-border pt-4 space-y-2">
              <h4 className="text-xs uppercase tracking-wide text-muted-foreground">
                Evidence
              </h4>
              <ChallengeEvidenceList challengeId={challenge.id} />
              <p className="text-[11px] text-muted-foreground">
                Evidence is read-only in this review surface. Parties upload from the match challenge panel.
              </p>
            </div>
          </div>


          {!isTerminal && isPlatformAdmin && (
            <div
              className="border-t border-border pt-4 flex flex-wrap gap-2 justify-end"
              data-testid="drawer-actions"
            >
              {isOpen && (
                <LoadingButton
                  type="button"
                  variant="outline"
                  onClick={handleMoveToReview}
                  loading={transition.isPending}
                  loadingText="Moving…"
                  data-testid="action-move-to-review"
                >
                  Move to under review
                </LoadingButton>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => setOutcomeMode("outcome_recorded")}
                data-testid="action-record-outcome"
              >
                Record outcome
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOutcomeMode("closed_no_action")}
                data-testid="action-close-no-action"
              >
                Close — no action
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOverrideOpen(true)}
                data-testid="action-admin-override"
              >
                Admin override closure
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {outcomeMode && (
        <RecordOutcomeDialog
          open={!!outcomeMode}
          onOpenChange={(next) => !next && setOutcomeMode(null)}
          mode={outcomeMode}
          challengeId={challenge.id}
          matchId={challenge.match_id}
          onRecorded={() => onOpenChange(false)}
        />
      )}

      <AdminOverrideDialog
        open={overrideOpen}
        onOpenChange={setOverrideOpen}
        matchId={challenge.match_id}
        onClosed={() => onOpenChange(false)}
      />
    </>
  );
}
