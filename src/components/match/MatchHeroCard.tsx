/**
 * MatchHeroCard - Top-level match summary card with buyer/seller/price info.
 *
 * Single Responsibility: display-only presentation of core match data.
 * Handles draft matches (null quantity/price) gracefully.
 * Does NOT expose raw metadata JSON.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { MatchStatusBadge } from "@/components/ui/match-status-badge";
import { ProofDocumentsList } from "@/components/match/ProofDocumentsList";
import { DraftPoiBadge } from "@/components/match/DraftPoiBadge";
import { CounterpartyRatingBadge } from "@/components/ratings/CounterpartyRatingBadge";
import { useUserOrg, getMatchRole } from "@/hooks/use-user-org";
import { isPendingEngagementActive } from "@/lib/engagement-state";
import type { Match } from "@/hooks/use-match-details";

interface MatchHeroCardProps {
  match: Match;
  isSettled: boolean;
  /**
   * UI-001: when the POI mint soft-routed (counterparty named but not
   * registered), `match.status` stays `matched` / `match.state` stays
   * `discovery` even though a non-terminal `poi_engagements` row exists.
   * Reading "Awaiting Confirmation" alone is misleading; we surface a
   * second small badge so this hero card matches reality.
   */
  engagementStatus?: string | null;
}

function isDraft(match: Match): boolean {
  return (
    (match.quantity_amount === 0 || match.quantity_amount === null) &&
    (match.price_amount === 0 || match.price_amount === null) &&
    (match.metadata as any)?.isDraft === true
  );
}

/** Extract meaningful context from metadata without dumping raw JSON */
function getMatchContext(match: Match): { label: string; value: string }[] {
  const meta = match.metadata as Record<string, unknown> | null;
  if (!meta) return [];
  
  const items: { label: string; value: string }[] = [];
  
  if (meta.searchQuery && typeof meta.searchQuery === "string") {
    items.push({ label: "Search query", value: meta.searchQuery });
  }
  if (meta.source && typeof meta.source === "string") {
    items.push({ label: "Source", value: meta.source });
  }
  if (typeof meta.coherenceScore === "number") {
    items.push({ label: "Match confidence", value: `${Math.round(meta.coherenceScore * 100)}%` });
  }
  if (meta.draftReason && typeof meta.draftReason === "string") {
    items.push({ label: "Note", value: meta.draftReason });
  }

  return items;
}

export function MatchHeroCard({ match, isSettled, engagementStatus }: MatchHeroCardProps) {
  const draft = isDraft(match);
  const contextItems = getMatchContext(match);
  const currentState = match.state || "discovery";
  const matchType = (match as any).match_type || "search";
  const isRevealed = true; // Names are always visible per client requirement
  const isUnilateral = matchType === "unilateral";

  // UI-001: soft-route pending - see DealWizard / StateProgressionCard for
  // the matching SSOT. We compute it locally so the hero stays a leaf.
  const softRoutePending =
    currentState === "discovery" &&
    isPendingEngagementActive({ engagement_status: engagementStatus ?? null });

  // Determine user's role from canonical buyer_org_id / seller_org_id fields.
  const userOrgId = useUserOrg();
  const inferredRole = getMatchRole(userOrgId, match as any);



  let roleBadgeLabel: string | null = null;
  if (inferredRole === "buyer") {
    roleBadgeLabel = "Buyer";
  } else if (inferredRole === "seller") {
    roleBadgeLabel = "Seller";
  }

  return (
    <Card className="bg-muted/30 border-border/80">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-2xl mb-2">{match.commodity}</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <MatchStatusBadge status={match.status} />
              {softRoutePending && (
                <Badge
                  variant="outline"
                  className="text-xs border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400 inline-flex items-center gap-1"
                  data-soft-route-pending="true"
                  title="A Pending Engagement is open for this trade. POI minting resumes once the counterparty accepts."
                >
                  <Clock className="h-3 w-3" />
                  Pending Engagement
                </Badge>
              )}
              {matchType === "unilateral" && (
                <Badge variant="outline" className="text-xs border-primary/40 text-primary">
                  Unilateral Intent
                </Badge>
              )}
              {matchType === "bilateral" && (
                <Badge variant="secondary" className="text-xs">
                  Bilateral
                </Badge>
              )}
              {draft && (
                <Badge variant="outline" className="text-xs border-destructive/50 text-destructive">
                  Draft - no commercial terms
                </Badge>
              )}
              <span className="text-sm text-muted-foreground font-mono">
                {match.hash.substring(0, 8)}...
              </span>
              {roleBadgeLabel && (
                <Badge variant="outline" className="text-xs border-primary/40 text-primary">
                  Your role: {roleBadgeLabel}
                </Badge>
              )}
            </div>
          </div>
          {isSettled && (
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              <span className="text-sm font-medium">Intent Confirmed</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {(match as any).poi_state === "DRAFT" && (
          <DraftPoiBadge className="mb-4" />
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold mb-4">Buyer</h3>
            <dl className="space-y-2">
              <div>
                <dt className="text-sm text-muted-foreground">Name</dt>
                 <dd className="font-medium">
                   {match.buyer_name == null ? (
                     <span className="text-muted-foreground italic">
                       {isUnilateral ? "Open - no buyer specified" : "-"}
                     </span>
                   ) : (
                     match.buyer_name
                   )}
                 </dd>
              </div>
              {isRevealed && match.buyer_org_id && (
                <div>
                  <dt className="text-sm text-muted-foreground">Organisation</dt>
                  <dd className="font-mono text-xs">{match.buyer_org_id.slice(0, 8)}…</dd>
                </div>
              )}
              {match.buyer_org_id && (
                <div>
                  <dt className="text-sm text-muted-foreground mb-1">Counterparty rating</dt>
                  <dd><CounterpartyRatingBadge orgId={match.buyer_org_id} /></dd>
                </div>
              )}
            </dl>
          </div>

          <div>
            <h3 className="font-semibold mb-4">Seller</h3>
            <dl className="space-y-2">
              <div>
                <dt className="text-sm text-muted-foreground">Name</dt>
                 <dd className="font-medium">
                   {match.seller_name == null ? (
                     <span className="text-muted-foreground italic">
                       {isUnilateral ? "Open - no seller specified" : "-"}
                     </span>
                   ) : (
                     match.seller_name
                   )}
                 </dd>
              </div>
              {isRevealed && match.seller_org_id && (
                <div>
                  <dt className="text-sm text-muted-foreground">Organisation</dt>
                  <dd className="font-mono text-xs">{match.seller_org_id.slice(0, 8)}…</dd>
                </div>
              )}
              {match.seller_org_id && (
                <div>
                  <dt className="text-sm text-muted-foreground mb-1">Counterparty rating</dt>
                  <dd><CounterpartyRatingBadge orgId={match.seller_org_id} /></dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        <Separator className="my-6" />

        {draft ? (
          <div className="p-4 rounded-md border border-amber-500/30 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Commercial terms not yet added</p>
                <p className="text-sm text-muted-foreground mt-1">
                  This is a draft match. Go to the <strong>Terms</strong> tab to propose quantity, price, delivery, and payment terms before confirming intent.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <h3 className="font-semibold mb-4">Quantity</h3>
              <p className="text-2xl font-bold">
                {match.quantity_amount ?? "-"} <span className="text-base font-normal text-muted-foreground">{match.quantity_unit ?? ""}</span>
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Price</h3>
              <p className="text-2xl font-bold">
                {match.price_currency} {match.price_amount?.toLocaleString()}
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Total Value</h3>
              <p className="text-2xl font-bold">
                {match.price_currency} {((match.price_amount ?? 0) * (match.quantity_amount ?? 0)).toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {match.terms && (
          <>
            <Separator className="my-6" />
            <div>
              <h3 className="font-semibold mb-2">Terms</h3>
              <p className="text-sm text-muted-foreground">{match.terms}</p>
            </div>
          </>
        )}

        {/* Human-readable context instead of raw JSON */}
        {contextItems.length > 0 && (
          <>
            <Separator className="my-6" />
            <div>
              <h3 className="font-semibold mb-3">Match Context</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {contextItems.map((item) => (
                  <div key={item.label}>
                    <dt className="text-muted-foreground">{item.label}</dt>
                    <dd className="font-medium">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </>
        )}

        {isSettled && (
          <>
            <Separator className="my-6" />
            <ProofDocumentsList matchId={match.id} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
