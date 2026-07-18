/**
 * Funder Compliance Summary — funder-facing surface.
 *
 * Renders only approved, purpose-bound, expiring compliance information.
 * NEVER shows raw provider data, provider names by default, internal notes,
 * approval deliberations or unapproved evidence.
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AdapterModeBanner,
  CWStatusBadge,
} from "@/components/compliance-workbench";
import {
  getFunderSummary,
  type FunderSummary,
} from "@/lib/compliance-workbench";
import { formatDate, relativeFromNow } from "@/lib/funder-workspace/ui/labels";
import { AlertTriangle, ShieldCheck, Clock } from "lucide-react";

export default function FunderComplianceSummaryPage() {
  const [s, setS] = useState<FunderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getFunderSummary()
      .then((v) => alive && setS(v))
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  if (error) return (
    <div className="mx-auto max-w-3xl p-6" role="alert">
      <Card className="p-6">
        <AlertTriangle className="mb-2 h-5 w-5 text-destructive" />
        <div className="font-medium">Cannot load compliance summary</div>
        <div className="text-sm text-muted-foreground">{error}</div>
      </Card>
    </div>
  );

  if (!s) return (
    <div className="mx-auto max-w-3xl space-y-3 p-6">
      <Skeleton className="h-24" />
      <Skeleton className="h-48" />
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <header className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-semibold">Compliance summary</h1>
          <p className="text-sm text-muted-foreground">
            Purpose-bound disclosure released by Izenzo Compliance.
          </p>
        </div>
      </header>

      <AdapterModeBanner />

      <Card className="p-4">
        <div className="text-xs uppercase text-muted-foreground">Case reference</div>
        <div className="font-mono text-sm">{s.caseReference}</div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Approved outcome</div>
          <div className="mt-1 flex items-center gap-2">
            <CWStatusBadge kind="decision" value="approved" />
            <span className="text-sm">{s.approvedOutcomeLabel}</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">High-level risk band</div>
          <div className="mt-1">
            <CWStatusBadge kind="risk" value={s.highLevelRiskBand} />
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Active hold</div>
          <div className="mt-1 text-sm">{s.activeHold ? "Yes — review in progress" : "None"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Evidence pack</div>
          <div className="mt-1 font-mono text-sm">{s.evidencePackVersion}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Last review</div>
          <div className="mt-1 text-sm">{formatDate(s.lastReviewAt)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase text-muted-foreground">Next review</div>
          <div className="mt-1 text-sm">{formatDate(s.nextReviewAt)}</div>
        </Card>
      </div>

      {s.materialOutstandingItems.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-medium">Material outstanding items</div>
          <ul className="mt-2 list-inside list-disc text-sm">
            {s.materialOutstandingItems.map((i, ix) => <li key={ix}>{i}</li>)}
          </ul>
        </Card>
      )}

      {s.approvedConditions.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-medium">Approved conditions</div>
          <ul className="mt-2 list-inside list-disc text-sm">
            {s.approvedConditions.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </Card>
      )}

      <Card className="p-4">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Clock className="h-4 w-4" /> Access expiry
        </div>
        <div className="mt-1 text-sm">
          Expires {formatDate(s.accessExpiresAt)} ({relativeFromNow(s.accessExpiresAt)})
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Released by {s.releasedByDisplayName}. Purpose: {s.purpose}
          {s.transactionContext ? ` · Context: ${s.transactionContext}` : ""}.
        </div>
      </Card>

      <Card className="p-4 text-xs text-muted-foreground">
        This summary contains only approved compliance information for the stated purpose.
        Provider names, raw provider responses, internal notes and approval deliberations are not
        included. Confidential — not for onward distribution.
      </Card>
    </div>
  );
}
