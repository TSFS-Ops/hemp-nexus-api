/**
 * Batch 3 — Funder workspace: assigned deals list with filters.
 * No global search, no browse across unassigned deals.
 */
import { useEffect, useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { FunderWorkspaceShell } from "./components/FunderWorkspaceShell";
import {
  ConsentStatusBadge,
  FunderReleaseStatusBadge,
  PermissionBadge,
} from "./components/FunderBadges";
import { listMyReleases } from "@/lib/funder-workspace/funder-client";
import type { DealReleaseRow } from "@/lib/funder-workspace/types";

type FilterKey =
  | "all"
  | "active"
  | "expiring_soon"
  | "expired"
  | "revoked"
  | "raw_access"
  | "pack_download";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "expiring_soon", label: "Expiring soon" },
  { key: "expired", label: "Expired" },
  { key: "revoked", label: "Revoked" },
  { key: "raw_access", label: "Raw access enabled" },
  { key: "pack_download", label: "Pack download enabled" },
];

const EXPIRING_SOON_MS = 14 * 24 * 60 * 60 * 1000;

export default function FunderWorkspaceDeals() {
  return (
    <FunderWorkspaceShell title="Deals" description="Filter your assigned deals.">
      {() => <DealsBody />}
    </FunderWorkspaceShell>
  );
}

function DealsBody() {
  const [rows, setRows] = useState<DealReleaseRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    listMyReleases()
      .then(setRows)
      .catch((e) => setErr((e as Error).message));
  }, []);

  const filtered = useMemo(() => {
    const now = Date.now();
    return rows.filter((r) => {
      switch (filter) {
        case "active":
          return r.release_status === "active";
        case "expired":
          return r.release_status === "expired";
        case "revoked":
          return r.release_status === "revoked";
        case "expiring_soon":
          return (
            r.release_status === "active" &&
            r.expires_at &&
            new Date(r.expires_at).getTime() - now < EXPIRING_SOON_MS
          );
        case "raw_access":
          return r.can_view_raw_documents || r.can_download_raw_documents;
        case "pack_download":
          return r.can_download_compiled_pack;
        default:
          return true;
      }
    });
  }, [rows, filter]);

  return (
    <div className="space-y-4" data-testid="fw-funder-deals">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {err && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">{err}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {filtered.length} deal{filtered.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No deals match this filter.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Seller</TableHead>
                  <TableHead>Pack download</TableHead>
                  <TableHead>Raw</TableHead>
                  <TableHead>Expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        to={`/funder/workspace/deals/${r.id}`}
                        className="underline"
                      >
                        {r.deal_reference}
                      </Link>
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
