/**
 * Batch 3 — Funder workspace dashboard.
 * Assigned-only. No search, no browse, no transaction-reference paste.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FunderWorkspaceShell } from "./components/FunderWorkspaceShell";
import {
  ConsentStatusBadge,
  FunderReleaseStatusBadge,
  PermissionBadge,
} from "./components/FunderBadges";
import { listMyReleases } from "@/lib/funder-workspace/funder-client";
import type { DealReleaseRow } from "@/lib/funder-workspace/types";

const EXPIRING_SOON_MS = 14 * 24 * 60 * 60 * 1000;

export default function FunderWorkspaceIndex() {
  return (
    <FunderWorkspaceShell
      title="Assigned deals"
      description="Deals released to your organisation by Izenzo."
    >
      {() => <DashboardBody />}
    </FunderWorkspaceShell>
  );
}

function DashboardBody() {
  const [rows, setRows] = useState<DealReleaseRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listMyReleases()
      .then(setRows)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const now = Date.now();
  const active = rows.filter((r) => r.release_status === "active");
  const expiringSoon = active.filter(
    (r) => r.expires_at && new Date(r.expires_at).getTime() - now < EXPIRING_SOON_MS,
  );
  const revokedOrExpired = rows.filter(
    (r) => r.release_status === "expired" || r.release_status === "revoked",
  );

  if (err) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-destructive">
          Failed to load your assigned deals: {err}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="fw-funder-dashboard">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Active assigned deals" value={active.length} />
        <StatCard label="Expiring within 14 days" value={expiringSoon.length} />
        <StatCard label="Revoked / expired" value={revokedOrExpired.length} />
        <StatCard label="Total assigned" value={rows.length} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assigned deals</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="fw-funder-empty">
              You do not currently have any assigned deals. Izenzo will notify you
              when a deal is released to your organisation.
            </p>
          ) : (
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
                    <TableCell className="font-mono text-xs">
                      <Link
                        to={`/funder/workspace/deals/${r.id}`}
                        className="underline"
                      >
                        {r.deal_reference}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.evidence_pack_version ?? "—"}
                    </TableCell>
                    <TableCell>
                      <FunderReleaseStatusBadge status={r.release_status} />
                    </TableCell>
                    <TableCell>
                      <ConsentStatusBadge status={r.buyer_consent_status} />
                    </TableCell>
                    <TableCell>
                      <ConsentStatusBadge status={r.seller_consent_status} />
                    </TableCell>
                    <TableCell>
                      <PermissionBadge value={r.can_download_compiled_pack} />
                    </TableCell>
                    <TableCell>
                      <PermissionBadge value={r.can_view_raw_documents} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.expires_at
                        ? new Date(r.expires_at).toLocaleDateString()
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
