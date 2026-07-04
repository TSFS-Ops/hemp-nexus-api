/**
 * Batch V-UI — funder-safe IDV summary.
 *
 * Renders ONLY the safe label + next-action wording from the SSOT.
 * Never renders full ID numbers, ID photos, selfies, raw provider
 * payloads, mismatch details, biometrics, or private admin notes.
 */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { idvSafeLabel } from "./idv-status-labels";

export interface FunderIdvSummaryProps {
  status: string | null | undefined;
  className?: string;
}

export function FunderIdvSummary({ status, className }: FunderIdvSummaryProps) {
  const safe = idvSafeLabel(status);
  const isReady =
    status === "idv_completed" || status === "manual_review_accepted";
  return (
    <Card className={className} data-testid="funder-idv-summary">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Representative identity</CardTitle>
        <Badge variant="secondary">{safe.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!isReady && (
          <div className="text-muted-foreground">
            Not ready — identity verification required
          </div>
        )}
        {safe.next_action && (
          <div className="text-muted-foreground">{safe.next_action}</div>
        )}
        <div className="text-xs text-muted-foreground">
          Identity verification applies to the representative only. Company
          readiness depends on other requirements.
        </div>
      </CardContent>
    </Card>
  );
}
