/**
 * CP-015 - Email-change history evidence panel for /desk/match/:matchId.
 *
 * Renders the full Daniel-acceptance evidence whenever this match has
 * had a Pending Engagement cancelled via the "cancel for email change"
 * path. Daniel must see, on the match page itself (not only on
 * /hq/engagements), the old + new engagement identities, the full
 * CP-015 user-facing message, the inactive-old-link wording, and the
 * blocked side-effects note.
 *
 * Pinned acceptance strings - do NOT rephrase. Pinned by
 * src/tests/cp-015-match-email-change-history.test.tsx.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MailX, RefreshCw } from "lucide-react";

export const CP015_USER_FACING_MESSAGE =
  "Counterparty email cannot be edited silently after a Pending Engagement has been created. The existing engagement will be cancelled and a new engagement must be created with the corrected email. The original record will remain in the audit trail.";

export const CP015_OLD_LINK_INACTIVE_MESSAGE =
  "This engagement invitation is no longer active. Please contact Izenzo admin if you believe this is incorrect.";

export const CP015_BLOCKED_SIDE_EFFECTS_NOTE =
  "No POI, WaD, execution, finality, credit burn, payment event, or silent external notice was triggered by the email change.";

export const CP015_DIRECT_EDIT_BLOCKED_NOTE =
  "Direct email edit is blocked. Email changes require cancellation and creation of a new Pending Engagement.";

export interface EmailChangeHistoryRow {
  id: string;
  match_id?: string;
  engagement_status?: string | null;
  operational_state?: string | null;
  counterparty_email?: string | null;
  renewed_from_engagement_id?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

interface Props {
  /** Current (newest, non-terminal) engagement on the match, if any. */
  current?: EmailChangeHistoryRow | null;
  /** Latest historical (expired/declined). */
  latestHistorical?: EmailChangeHistoryRow | null;
  /** Everything else returned by the by-match envelope. */
  history?: EmailChangeHistoryRow[];
}

function isCancelledForEmailChange(row: EmailChangeHistoryRow | null | undefined): boolean {
  if (!row) return false;
  return (
    row.engagement_status === "cancelled_email_change" ||
    row.operational_state === "cancelled_for_email_change"
  );
}

export function MatchEmailChangeHistoryPanel({
  current,
  latestHistorical,
  history,
}: Props) {
  const allRows: EmailChangeHistoryRow[] = [
    ...(current ? [current] : []),
    ...(latestHistorical ? [latestHistorical] : []),
    ...(history ?? []),
  ];

  const cancelledRows = allRows.filter(isCancelledForEmailChange);
  if (cancelledRows.length === 0) return null;

  // Newest cancelled row is the canonical "old" engagement for the CP-015
  // narrative. The replacement is the row whose renewed_from_engagement_id
  // points to it, if present, otherwise the current engagement when it is
  // not itself the cancelled row.
  const sortedCancelled = [...cancelledRows].sort((a, b) =>
    (b.created_at ?? "").localeCompare(a.created_at ?? ""),
  );
  const oldRow = sortedCancelled[0];

  const replacementByLink = allRows.find(
    (r) => r.renewed_from_engagement_id === oldRow.id && r.id !== oldRow.id,
  );
  const replacementCurrent =
    current && current.id !== oldRow.id && !isCancelledForEmailChange(current)
      ? current
      : null;
  const newRow = replacementByLink ?? replacementCurrent ?? null;

  return (
    <Card
      className="border-amber-300 bg-amber-50/60"
      data-testid="cp015-email-change-history-panel"
      aria-labelledby="cp015-email-change-history-heading"
    >
      <CardHeader className="space-y-2">
        <CardTitle
          id="cp015-email-change-history-heading"
          className="flex items-center gap-2 text-lg"
        >
          <MailX className="h-5 w-5 shrink-0 text-amber-700" />
          Counterparty email change history
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p
          className="text-sm text-foreground/90 leading-relaxed"
          data-testid="cp015-user-facing-message"
        >
          {CP015_USER_FACING_MESSAGE}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div
            className="rounded-md border border-slate-300 bg-white p-3 space-y-1.5"
            data-testid="cp015-old-engagement-block"
            data-engagement-id={oldRow.id}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Old engagement
              </p>
              <Badge
                variant="outline"
                className="bg-slate-100 text-slate-700 border-slate-300 text-[10px]"
                data-testid="cp015-old-status-badge"
              >
                Status: cancelled_email_change
              </Badge>
            </div>
            <p
              className="text-[11px] font-mono text-slate-700 break-all"
              data-testid="cp015-old-engagement-id"
            >
              {oldRow.id}
            </p>
            {oldRow.counterparty_email && (
              <p
                className="text-sm text-foreground break-all"
                data-testid="cp015-old-email"
              >
                Original email: {oldRow.counterparty_email}
              </p>
            )}
            <Badge
              variant="outline"
              className="bg-slate-100 text-slate-700 border-slate-300 text-[10px]"
              data-testid="cp015-old-operational-state-badge"
            >
              Operational state: cancelled_for_email_change
            </Badge>
          </div>

          {newRow ? (
            <div
              className="rounded-md border border-emerald-300 bg-emerald-50 p-3 space-y-1.5"
              data-testid="cp015-new-engagement-block"
              data-engagement-id={newRow.id}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                  New engagement
                </p>
                <Badge
                  variant="outline"
                  className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px]"
                  data-testid="cp015-new-status-badge"
                >
                  Status: {newRow.engagement_status ?? "pending"}
                </Badge>
              </div>
              <p
                className="text-[11px] font-mono text-emerald-900 break-all"
                data-testid="cp015-new-engagement-id"
              >
                {newRow.id}
              </p>
              {newRow.counterparty_email && (
                <p
                  className="text-sm text-foreground break-all"
                  data-testid="cp015-new-email"
                >
                  Corrected email: {newRow.counterparty_email}
                </p>
              )}
              <p className="text-[11px] text-emerald-900/80 flex items-center gap-1">
                <RefreshCw className="h-3 w-3" />
                Replaces old engagement.
              </p>
            </div>
          ) : (
            <div
              className="rounded-md border border-dashed border-slate-300 bg-white p-3"
              data-testid="cp015-new-engagement-missing"
            >
              <p className="text-xs text-slate-600">
                No replacement engagement has been created yet for this match.
              </p>
            </div>
          )}
        </div>

        <div
          className="rounded-md border border-amber-300 bg-white p-3"
          data-testid="cp015-old-link-inactive"
        >
          <p className="text-sm text-foreground/90">
            <span className="font-semibold">Old outreach link: </span>
            {CP015_OLD_LINK_INACTIVE_MESSAGE}
          </p>
        </div>

        <p
          className="text-xs text-foreground/90 leading-relaxed"
          data-testid="cp015-direct-edit-blocked"
        >
          {CP015_DIRECT_EDIT_BLOCKED_NOTE}
        </p>

        <p
          className="text-xs text-muted-foreground leading-relaxed"
          data-testid="cp015-blocked-side-effects"
        >
          {CP015_BLOCKED_SIDE_EFFECTS_NOTE}
        </p>
      </CardContent>
    </Card>
  );
}
