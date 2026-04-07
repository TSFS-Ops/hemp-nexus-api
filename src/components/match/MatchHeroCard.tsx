/**
 * MatchHeroCard — Top-level match summary card with buyer/seller/price info.
 *
 * Single Responsibility: display-only presentation of core match data.
 * Handles draft matches (null quantity/price) gracefully.
 * Does NOT expose raw metadata JSON.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { MatchStatusBadge } from "@/components/ui/match-status-badge";
import { ProofDocumentsList } from "@/components/match/ProofDocumentsList";
import type { Match } from "@/hooks/use-match-details";

interface MatchHeroCardProps {
  match: Match;
  isSettled: boolean;
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

export function MatchHeroCard({ match, isSettled }: MatchHeroCardProps) {
  const draft = isDraft(match);
  const contextItems = getMatchContext(match);
  const currentState = match.state || "discovery";
  const matchType = (match as any).match_type || "search";
  const isRevealed = ["counterparty_sighted", "committed", "completed"].includes(currentState);
  const isUnilateral = matchType === "unilateral";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-2xl mb-2">{match.commodity}</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <MatchStatusBadge status={match.status} />
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
                  Draft — no commercial terms
                </Badge>
              )}
              <span className="text-sm text-muted-foreground font-mono">
                {match.hash.substring(0, 8)}...
              </span>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold mb-4">Buyer</h3>
            <dl className="space-y-2">
              <div>
                <dt className="text-sm text-muted-foreground">Name</dt>
                <dd className="font-medium">
                  {match.buyer_name == null ? (
                    <span className="text-muted-foreground italic">
                      {isUnilateral ? "Open — no buyer specified" : "—"}
                    </span>
                  ) : isRevealed ? match.buyer_name : (
                    <span className="text-muted-foreground italic">Hidden until counterparty reveal</span>
                  )}
                </dd>
              </div>
              {isRevealed && match.buyer_org_id && (
                <div>
                  <dt className="text-sm text-muted-foreground">Organisation</dt>
                  <dd className="font-mono text-xs">{match.buyer_org_id.slice(0, 8)}…</dd>
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
                      {isUnilateral ? "Open — no seller specified" : "—"}
                    </span>
                  ) : isRevealed ? match.seller_name : (
                    <span className="text-muted-foreground italic">Hidden until counterparty reveal</span>
                  )}
                </dd>
              </div>
              {isRevealed && match.seller_org_id && (
                <div>
                  <dt className="text-sm text-muted-foreground">Organisation</dt>
                  <dd className="font-mono text-xs">{match.seller_org_id.slice(0, 8)}…</dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        <Separator className="my-6" />

        {draft ? (
          <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
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
                {match.quantity_amount ?? "—"} <span className="text-base font-normal text-muted-foreground">{match.quantity_unit ?? ""}</span>
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
