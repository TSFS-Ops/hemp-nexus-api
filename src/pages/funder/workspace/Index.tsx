/**
 * Batch 3 — Funder workspace dashboard.
 * Assigned-only. No search, no browse.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Inbox, Info } from "lucide-react";
import { FunderWorkspaceShell } from "./components/FunderWorkspaceShell";
import {
  fetchFunderCounters,
  listMyReleases,
  type FunderWorkspaceFunderCounters,
} from "@/lib/funder-workspace/funder-client";
import type { DealReleaseRow } from "@/lib/funder-workspace/types";
import { effectiveReleaseStatus } from "@/lib/funder-workspace/release-state";
import { computeReleaseMetrics } from "@/lib/funder-workspace/metrics";
import {
  EmptyState,
  ExpiryIndicator,
  InfoBanner,
  LoadingState,
  SectionHeading,
  StatusBadge,
} from "@/lib/funder-workspace/ui";

export default function FunderWorkspaceIndex() {
  return (
    <FunderWorkspaceShell
      title="Assigned deals"
      description="Deals released to your organisation by Izenzo."
    >
      {(ctx) => <DashboardBody orgName={ctx.organisation.name} />}
    </FunderWorkspaceShell>
  );
}

function DashboardBody({ orgName }: { orgName: string }) {
  const [rows, setRows] = useState<DealReleaseRow[] | null>(null);
  const [counters, setCounters] = useState<FunderWorkspaceFunderCounters | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listMyReleases(), fetchFunderCounters().catch(() => null)])
      .then(([r, c]) => {
        if (cancelled) return;
        setRows(r);
        setCounters(c);
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const now = Date.now();
  const metrics = computeReleaseMetrics(rows ?? [], now);


  if (err) {
    return (
      <InfoBanner tone="destructive" title="Failed to load your assigned deals">
        {err}
      </InfoBanner>
    );
  }

  return (
    <div className="space-y-4" data-testid="fw-funder-dashboard">
      <TooltipProvider>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Active releases"
          value={counters?.active_deals ?? metrics.active}
          loading={rows === null && counters === null}
          hint="Releases assigned to your organisation whose access is currently usable — not revoked, not expired. Releases within 14 days of expiry are still counted here (they are also shown in ‘Expiring in 14 days’)."
        />
        <StatCard
          label="Expiring in 14 days"
          value={counters?.expiring_soon ?? metrics.expiring_soon}
          loading={rows === null && counters === null}
          hint="Warning subset of Active releases. Excludes already-expired and revoked releases. These are also included in ‘Active releases’."
        />
        <StatCard
          label="Sealed pack versions"
          value={counters?.packs_available ?? 0}
          loading={counters === null}
          hint="Total sealed pack VERSIONS across your assigned releases. A deal with v1 and v2 counts as 2. Includes packs on revoked releases (revocation blocks download but preserves the sealed record for audit)."
        />
        <StatCard
          label="Open RFIs"
          value={counters?.open_rfis ?? 0}
          loading={counters === null}
          hint="RFIs with status open, assigned or in-progress across all your releases. Includes RFIs on releases later revoked (server cannot post new messages once a release is inactive)."
        />
        <StatCard
          label="Answered RFIs"
          value={counters?.answered_rfis ?? 0}
          loading={counters === null}
          hint="RFIs whose current status is ‘answered’. Once closed or withdrawn they no longer count here."
        />
        <StatCard
          label="Deals with a current decision"
          value={counters?.decisions_recorded ?? 0}
          loading={counters === null}
          hint="Counts the current (latest) decision per release. Superseded decision versions are not double-counted."
        />
      </div>
      </TooltipProvider>


      <Card>
        <CardHeader>
          <SectionHeading
            title="Assigned deals"
            description="Click a deal to open the evidence room."
          />
        </CardHeader>
        <CardContent>
          {rows === null ? (
            <LoadingState label="Loading your assigned deals…" />
          ) : rows.length === 0 ? (
            <EmptyState
              title={`No deals have been released to ${orgName} yet`}
              description="Once Izenzo releases a deal to your organisation, it will appear here. You will also be notified by email."
              icon={<Inbox className="h-8 w-8" />}
              testId="fw-funder-empty"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deal</TableHead>
                    <TableHead>Pack version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Buyer consent</TableHead>
                    <TableHead>Seller consent</TableHead>
                    <TableHead>Pack download</TableHead>
                    <TableHead>Raw docs</TableHead>
                    <TableHead>Expires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} data-testid={`fw-funder-row-${r.id}`}>
                      <TableCell>
                        <Link
                          to={`/funder/workspace/deals/${r.id}`}
                          className="text-primary underline underline-offset-2 font-medium"
                        >
                          {r.deal_reference}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.evidence_pack_version ? `v${r.evidence_pack_version}` : "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="release" value={effectiveReleaseStatus(r)} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="consent" value={r.buyer_consent_status} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="consent" value={r.seller_consent_status} />
                      </TableCell>
                      <TableCell>{r.can_download_compiled_pack ? "Yes" : "No"}</TableCell>
                      <TableCell>{r.can_view_raw_documents ? "Yes" : "No"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        <ExpiryIndicator expiresAt={r.expires_at} compact />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: number;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1 tabular-nums">
          {loading ? <span className="text-muted-foreground">—</span> : value}
        </div>
      </CardContent>
    </Card>
  );
}
