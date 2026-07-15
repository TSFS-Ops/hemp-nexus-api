/**
 * Batch 3 — Funder workspace: assigned deals list with filters.
 * Uses the shared Funder Workspace UI kit for consistency.
 */
import { useEffect, useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Inbox } from "lucide-react";
import { FunderWorkspaceShell } from "./components/FunderWorkspaceShell";
import { listMyReleases } from "@/lib/funder-workspace/funder-client";
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

export default function FunderWorkspaceDeals() {
  return (
    <FunderWorkspaceShell title="Deals" description="Filter your assigned deals.">
      {() => <DealsBody />}
    </FunderWorkspaceShell>
  );
}

function DealsBody() {
  const [rows, setRows] = useState<DealReleaseRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    let alive = true;
    listMyReleases()
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const now = Date.now();
    return rows.filter((r) => {
      const eff = effectiveReleaseStatus(r, now);
      switch (filter) {
        case "active":
          return eff === "active" || eff === "expiring_soon";
        case "expired":
          return eff === "expired";
        case "revoked":
          return eff === "revoked";
        case "expiring_soon":
          return eff === "expiring_soon";
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
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Deal filters">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {err && (
        <InfoBanner tone="destructive" title="Failed to load deals">
          {err}
        </InfoBanner>
      )}

      <Card>
        <CardHeader>
          <SectionHeading
            title={`${filtered.length} deal${filtered.length === 1 ? "" : "s"}`}
            description={
              filter === "all"
                ? "Every release assigned to your organisation."
                : "Filtered view — clear filters to see everything."
            }
          />
        </CardHeader>
        <CardContent>
          {rows === null ? (
            <LoadingState label="Loading your assigned deals…" />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No deals match this filter"
              description="Try a different filter, or wait for Izenzo to release a new deal to your organisation."
              icon={<Inbox className="h-8 w-8" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Buyer consent</TableHead>
                    <TableHead>Seller consent</TableHead>
                    <TableHead>Pack download</TableHead>
                    <TableHead>Raw docs</TableHead>
                    <TableHead>Access expires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link
                          to={`/funder/workspace/deals/${r.id}`}
                          className="text-primary underline underline-offset-2 font-medium"
                        >
                          {r.deal_reference}
                        </Link>
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
