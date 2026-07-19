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
import { Inbox } from "lucide-react";
import { FunderWorkspaceShell } from "./components/FunderWorkspaceShell";
import {
  fetchFunderCounters,
  listMyReleases,
  type FunderWorkspaceFunderCounters,
} from "@/lib/funder-workspace/funder-client";
import type { DealReleaseRow } from "@/lib/funder-workspace/types";
import { effectiveReleaseStatus } from "@/lib/funder-workspace/release-state";
import {
  EmptyState,
  ExpiryIndicator,
  InfoBanner,
  LoadingState,
  SectionHeading,
  StatusBadge,
} from "@/lib/funder-workspace/ui";

const EXPIRING_SOON_MS = 14 * 24 * 60 * 60 * 1000;

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
  const active = (rows ?? []).filter((r) => r.release_status === "active");
  const expiringSoon = active.filter(
    (r) => r.expires_at && new Date(r.expires_at).getTime() - now < EXPIRING_SOON_MS,
  );

  if (err) {
    return (
      <InfoBanner tone="destructive" title="Failed to load your assigned deals">
        {err}
      </InfoBanner>
    );
  }

  return (
    <div className="space-y-4" data-testid="fw-funder-dashboard">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Active deals"
          value={counters?.active_deals ?? active.length}
          loading={rows === null && counters === null}
        />
        <StatCard
          label="Expiring in 14 days"
          value={counters?.expiring_soon ?? expiringSoon.length}
          loading={rows === null && counters === null}
        />
        <StatCard
          label="Sealed packs"
          value={counters?.packs_available ?? 0}
          loading={counters === null}
        />
        <StatCard label="Open RFIs" value={counters?.open_rfis ?? 0} loading={counters === null} />
        <StatCard label="Answered RFIs" value={counters?.answered_rfis ?? 0} loading={counters === null} />
        <StatCard
          label="Decisions recorded"
          value={counters?.decisions_recorded ?? 0}
          loading={counters === null}
        />
      </div>

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
