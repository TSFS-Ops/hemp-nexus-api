/**
 * MatchHeroCard — Top-level match summary card with buyer/seller/price info.
 *
 * Single Responsibility: display-only presentation of core match data.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2 } from "lucide-react";
import { MatchStatusBadge } from "@/components/ui/match-status-badge";
import { ProofDocumentsList } from "@/components/match/ProofDocumentsList";
import type { Match } from "@/hooks/use-match-details";

interface MatchHeroCardProps {
  match: Match;
  isSettled: boolean;
}

export function MatchHeroCard({ match, isSettled }: MatchHeroCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-2xl mb-2">{match.commodity}</CardTitle>
            <div className="flex items-center gap-2">
              <MatchStatusBadge status={match.status} />
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
            <h3 className="font-semibold mb-4">Buyer Information</h3>
            <dl className="space-y-2">
              <div>
                <dt className="text-sm text-muted-foreground">Name</dt>
                <dd className="font-medium">{match.buyer_name}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">ID</dt>
                <dd className="font-mono text-sm">{match.buyer_id}</dd>
              </div>
            </dl>
          </div>

          <div>
            <h3 className="font-semibold mb-4">Seller Information</h3>
            <dl className="space-y-2">
              <div>
                <dt className="text-sm text-muted-foreground">Name</dt>
                <dd className="font-medium">{match.seller_name}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">ID</dt>
                <dd className="font-mono text-sm">{match.seller_id}</dd>
              </div>
            </dl>
          </div>
        </div>

        <Separator className="my-6" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h3 className="font-semibold mb-4">Quantity</h3>
            <p className="text-2xl font-bold">
              {match.quantity_amount} <span className="text-base font-normal text-muted-foreground">{match.quantity_unit}</span>
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-4">Price</h3>
            <p className="text-2xl font-bold">
              {match.price_currency} {match.price_amount.toLocaleString()}
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-4">Total Value</h3>
            <p className="text-2xl font-bold">
              {match.price_currency} {(match.price_amount * match.quantity_amount).toLocaleString()}
            </p>
          </div>
        </div>

        {match.terms && (
          <>
            <Separator className="my-6" />
            <div>
              <h3 className="font-semibold mb-2">Terms & Conditions</h3>
              <p className="text-sm text-muted-foreground">{match.terms}</p>
            </div>
          </>
        )}

        {match.metadata && Object.keys(match.metadata).length > 0 && (
          <>
            <Separator className="my-6" />
            <div>
              <h3 className="font-semibold mb-2">Additional Metadata</h3>
              <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto">
                {JSON.stringify(match.metadata, null, 2)}
              </pre>
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
