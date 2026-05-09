/**
 * AdminChallengeQueuePanel — Phase 3C
 *
 * HQ → Disputes → "Challenges" sub-tab content. Lists all match
 * challenges for platform admins (RLS-trusted), with a status filter
 * and a per-row review drawer for actions.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useAdminChallengeQueue, type AdminChallengeFilter } from "@/hooks/useAdminChallengeQueue";
import type { ChallengeRow } from "@/hooks/useMatchChallenge";
import { AdminChallengeReviewDrawer } from "./challenges/AdminChallengeReviewDrawer";

const FILTERS: { id: AdminChallengeFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "under_review", label: "Under review" },
  { id: "terminal", label: "Terminal" },
  { id: "all", label: "All" },
];

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

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AdminChallengeQueuePanel() {
  const [filter, setFilter] = useState<AdminChallengeFilter>("open");
  const [selected, setSelected] = useState<ChallengeRow | null>(null);
  const { data, isLoading, error, refetch } = useAdminChallengeQueue(filter);

  return (
    <div className="space-y-4" data-testid="admin-challenge-queue">
      <div className="flex flex-wrap items-center gap-2" data-testid="queue-filters">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            type="button"
            variant={filter === f.id ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f.id)}
            data-testid={`filter-${f.id}`}
          >
            {f.label}
          </Button>
        ))}
        <div className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="p-4 border-destructive bg-destructive/5 text-sm text-destructive">
          Could not load challenges: {error.message}
        </Card>
      )}

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading challenges…</Card>
      ) : !data || data.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground" data-testid="queue-empty">
          No challenges in this view.
        </Card>
      ) : (
        <div className="border border-border rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Raised at</th>
                <th className="text-left px-3 py-2 font-medium">Match</th>
                <th className="text-left px-3 py-2 font-medium">Subject</th>
                <th className="text-left px-3 py-2 font-medium">Raised by</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-border hover:bg-muted/20"
                  data-testid={`queue-row-${c.id}`}
                >
                  <td className="px-3 py-2 font-mono text-xs">{fmt(c.created_at)}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      to={`/desk/match/${c.match_id}`}
                      className="text-primary hover:underline"
                    >
                      {c.match_id.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="px-3 py-2">{SUBJECT_LABEL[c.subject_code] ?? c.subject_code}</td>
                  <td className="px-3 py-2 text-xs">{c.raised_by_role ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-xs border-border bg-muted text-foreground">
                      {STATUS_LABEL[c.status] ?? c.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelected(c)}
                      data-testid={`row-review-${c.id}`}
                    >
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminChallengeReviewDrawer
        open={!!selected}
        onOpenChange={(next) => !next && setSelected(null)}
        challenge={selected}
      />
    </div>
  );
}
