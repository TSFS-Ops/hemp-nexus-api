/**
 * Customer Compliance Area — case list.
 *
 * Customer surface. NEVER shows analyst names, internal notes, provider
 * payloads or risk methodology. Sender identity is "Izenzo Compliance".
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { CWStatusBadge, AdapterModeBanner, EmptyState, EvidenceSkeleton } from "@/components/compliance-workbench";
import { CASE_TYPE_LABELS, listCases, type CaseSummary } from "@/lib/compliance-workbench";
import { relativeFromNow } from "@/lib/funder-workspace/ui/labels";
import { AlertTriangle, Inbox, ShieldCheck } from "lucide-react";
import { DeskLayout } from "@/components/desk/DeskLayout";

export default function DeskComplianceCases() {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listCases({})
      .then((c) => alive && setCases(c))
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  return (
    <DeskLayout>
      <div className="mx-auto max-w-4xl space-y-4">
      <header className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-lg font-semibold">Your Compliance Reviews</h1>
          <p className="text-sm text-muted-foreground">
            Managed by Izenzo Compliance. If we need anything from you it will appear below.
          </p>
        </div>
      </header>

      <AdapterModeBanner />

      {error ? (
        <Card className="p-6" role="alert">
          <div className="flex items-start gap-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
            <div>
              <div className="font-medium text-destructive">Cannot load your cases</div>
              <div className="text-muted-foreground">{error}</div>
            </div>
          </div>
        </Card>
      ) : !cases ? (
        <EvidenceSkeleton items={3} />
      ) : cases.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-6 w-6 text-muted-foreground" />}
          tone="success"
          title="No open compliance reviews"
          description="You are all clear. When we need anything from you it will appear here."
        />
      ) : (
        <ul className="space-y-2">
          {cases.map((c) => (
            <li key={c.internalId}>
              <Link to={`/desk/compliance-cases/${encodeURIComponent(c.reference)}`}>
                <Card className="p-4 transition-colors hover:border-primary/50">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="font-mono text-xs text-muted-foreground">{c.reference}</div>
                      <div className="text-sm font-medium">{CASE_TYPE_LABELS[c.type]}</div>
                      {c.hasOpenRfi && (
                        <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                          Action required from you
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <CWStatusBadge kind="case_status" value={c.status} />
                      <span className="text-xs text-muted-foreground">
                        Updated {c.lastActivityAt ? relativeFromNow(c.lastActivityAt) : "—"}
                      </span>
                    </div>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      </div>
    </DeskLayout>
  );
}
