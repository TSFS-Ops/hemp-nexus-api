/**
 * ChallengeStatusCard — Phase 3B
 *
 * Read-only summary of the latest challenge on a match. Renders only when
 * the latest row has one of:
 *   open, under_review, outcome_recorded, withdrawn, closed_no_action.
 *
 * Neutral institutional palette (no danger reds). All actions live OUTSIDE
 * the card (Raise Challenge sits next to it on the host page).
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ChallengeRow, ChallengeStatus } from "@/hooks/useMatchChallenge";

const SUBJECT_LABELS: Record<string, string> = {
  terms_disagreement: "Terms disagreement",
  evidence_quality_concern: "Evidence quality concern",
  identity_concern: "Identity concern",
  compliance_concern: "Compliance concern",
  delivery_or_settlement_concern: "Delivery or settlement concern",
  other: "Other",
};

const STATUS_LABELS: Record<ChallengeStatus, string> = {
  open: "Open",
  under_review: "Under review",
  outcome_recorded: "Outcome recorded",
  withdrawn: "Withdrawn",
  closed_no_action: "Closed — no action",
};

const OUTCOME_LABELS: Record<string, string> = {
  no_action_required: "No action required",
  corrected_and_proceed: "Corrected and proceed",
  withdrawn_by_raiser: "Withdrawn by raiser",
  superseded_by_updated_terms: "Superseded by updated terms",
  evidence_required: "Evidence required",
  cannot_proceed: "Cannot proceed",
  admin_override_recorded: "Administrator override recorded",
};

const ROLE_LABELS: Record<string, string> = {
  buyer_org_admin: "Buyer organisation administrator",
  seller_org_admin: "Seller organisation administrator",
  platform_admin: "Platform administrator",
};

const VISIBLE_STATUSES = new Set<ChallengeStatus>([
  "open",
  "under_review",
  "outcome_recorded",
  "withdrawn",
  "closed_no_action",
]);

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export interface ChallengeStatusCardProps {
  challenge: ChallengeRow | null | undefined;
}

export function ChallengeStatusCard({ challenge }: ChallengeStatusCardProps) {
  if (!challenge) return null;
  if (!VISIBLE_STATUSES.has(challenge.status)) return null;

  const isTerminal =
    challenge.status === "outcome_recorded" ||
    challenge.status === "withdrawn" ||
    challenge.status === "closed_no_action";

  return (
    <Card
      data-testid="challenge-status-card"
      className="border-border bg-card"
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base font-semibold text-foreground">
            Challenge on this match
          </CardTitle>
          <Badge
            variant="outline"
            data-testid="challenge-status-badge"
            className="text-xs font-medium border-border bg-muted text-foreground"
          >
            {STATUS_LABELS[challenge.status] ?? challenge.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Subject
            </dt>
            <dd className="text-foreground">
              {SUBJECT_LABELS[challenge.subject_code] ?? challenge.subject_code}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Raised by
            </dt>
            <dd className="text-foreground">
              {challenge.raised_by_role
                ? ROLE_LABELS[challenge.raised_by_role] ?? challenge.raised_by_role
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Raised at
            </dt>
            <dd className="text-foreground font-mono text-xs">
              {fmtDate(challenge.created_at)}
            </dd>
          </div>
          {isTerminal && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Closed at
              </dt>
              <dd className="text-foreground font-mono text-xs">
                {fmtDate(challenge.closed_at)}
              </dd>
            </div>
          )}
        </dl>

        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Summary
          </div>
          <p
            data-testid="challenge-summary"
            className="text-foreground whitespace-pre-wrap leading-relaxed"
          >
            {challenge.summary}
          </p>
        </div>

        {isTerminal && challenge.outcome_code && (
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Outcome
            </div>
            <p className="text-foreground">
              {OUTCOME_LABELS[challenge.outcome_code] ?? challenge.outcome_code}
            </p>
            {challenge.outcome_summary && (
              <p className="text-muted-foreground text-xs mt-1 whitespace-pre-wrap">
                {challenge.outcome_summary}
              </p>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground font-mono pt-1 border-t border-border">
          Challenge ID: {challenge.id.slice(0, 8)}…
        </p>
      </CardContent>
    </Card>
  );
}
