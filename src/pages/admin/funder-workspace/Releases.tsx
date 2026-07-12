/**
 * Institutional Funder Evidence Workspace — Batch 2
 * Admin: Deal Releases list.
 *
 * Controlled-pilot verification sweep: the "Consent (B/S)" column now
 * renders the shared plain-English CONSENT_STATUS_LABELS instead of the
 * raw buyer_consent_status / seller_consent_status enum text.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { listReleases, type DealReleaseWithOrg } from "@/lib/funder-workspace/admin-client";
import {
    effectiveReleaseStatus,
    statusBadgeVariant,
    statusLabel,
    consentSatisfied,
} from "@/lib/funder-workspace/release-state";
import { CONSENT_STATUS_LABELS } from "@/lib/funder-workspace/consent-labels";
import {
    LINKAGE_STATUS_LABEL,
    linkageStatusBadgeVariant,
    linkageStatusOf,
} from "@/lib/funder-workspace/linkage-labels";

function daysUntil(iso: string | null): number | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    return Math.floor((t - Date.now()) / (24 * 60 * 60 * 1000));
}

export default function FunderWorkspaceReleases() {
    const [rows, setRows] = useState<DealReleaseWithOrg[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [q, setQ] = useState("");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [expiringOnly, setExpiringOnly] = useState(false);
    const [overrideOnly, setOverrideOnly] = useState(false);
    const [rawOnly, setRawOnly] = useState(false);

  useEffect(() => {
        (async () => {
                try {
                          setRows(await listReleases());
                } catch (e) {
                          setError((e as Error).message);
                }
        })();
  }, []);

  const filtered = useMemo(() => {
        const list = rows ?? [];
        const needle = q.trim().toLowerCase();
        const now = Date.now();
        return list.filter((r) => {
                const eff = effectiveReleaseStatus(r, now);
                if (statusFilter !== "all" && eff !== statusFilter) return false;
                if (overrideOnly && !r.admin_override_reason) return false;
                if (rawOnly && !r.can_view_raw_documents && !r.can_download_raw_documents) return false;
                if (expiringOnly) {
                          const d = daysUntil(r.expires_at);
                          if (d === null || d < 0 || d > 14) return false;
                }
                if (needle) {
                          const hay = `${r.deal_reference} ${r.funder_organisation?.name ?? ""}`.toLowerCase();
                          if (!hay.includes(needle)) return false;
                }
                return true;
        });
  }, [rows, q, statusFilter, expiringOnly, overrideOnly, rawOnly]);

  return (
        <div className="p-6 space-y-4" data-testid="fw-admin-releases">
              <div className="flex items-start justify-between">
                      <div>
                                <h1 className="text-2xl font-semibold">Deal Releases</h1>h1>
                                <p className="text-sm text-muted-foreground">Evidence packs released to funders. Status, consent and permissions.</p>p>
                      </div>div>
                      <Link to="/admin/funder-workspace/releases/new">
                                <Button data-testid="fw-releases-new">New release</Button>Button>
                      </Link>Link>
              </div>div>
        
              <div className="flex flex-wrap gap-3 items-end">
                      <div className="flex-1 min-w-[240px]">
                                <label className="text-xs text-muted-foreground">Search</label>label>
                                <Input placeholder="Deal reference or funder" value={q} onChange={(e) => setQ(e.target.value)} />
                      </div>div>
                      <div>
                                <label className="text-xs text-muted-foreground">Status</label>label>
                                <Select value={statusFilter} onValueChange={setStatusFilter}>
                                            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>SelectTrigger>
                                            <SelectContent>
                                                          <SelectItem value="all">All</SelectItem>SelectItem>
                                                          <SelectItem value="draft">Draft</SelectItem>SelectItem>
                                                          <SelectItem value="active">Active</SelectItem>SelectItem>
                                                          <SelectItem value="expired">Expired</SelectItem>SelectItem>
                                                          <SelectItem value="revoked">Revoked</SelectItem>SelectItem>
                                            </SelectContent>SelectContent>
                                </Select>Select>
                      </div>div>
                      <label className="flex items-center gap-2 text-sm">
                                <Checkbox checked={expiringOnly} onCheckedChange={(v) => setExpiringOnly(!!v)} /> Expiring ≤14d
                      </label>label>
                      <label className="flex items-center gap-2 text-sm">
                                <Checkbox checked={overrideOnly} onCheckedChange={(v) => setOverrideOnly(!!v)} /> Override used
                      </label>label>
                      <label className="flex items-center gap-2 text-sm">
                                <Checkbox checked={rawOnly} onCheckedChange={(v) => setRawOnly(!!v)} /> Raw docs enabled
                      </label>label>
              </div>div>
        
          {error && (
                  <Card><CardContent className="pt-6 text-sm text-destructive">Failed to load: {error}</CardContent>CardContent></Card>Card>
              )}
        
              <Card>
                      <CardHeader>
                                <CardTitle className="text-base">{filtered.length} release(s)</CardTitle>CardTitle>
                      </CardHeader>CardHeader>
                      <CardContent>
                                <Table>
                                            <TableHeader>
                                                          <TableRow>
                                                                          <TableHead>Deal</TableHead>TableHead>
                                                                          <TableHead>Funder</TableHead>TableHead>
                                                                          <TableHead>Pack</TableHead>TableHead>
                                                                          <TableHead>Status</TableHead>TableHead>
                                                                          <TableHead>Linkage</TableHead>TableHead>
                                                                          <TableHead>Consent (B/S)</TableHead>TableHead>
                                                                          <TableHead>Override</TableHead>TableHead>
                                                                          <TableHead>Funder-ready</TableHead>TableHead>
                                                                          <TableHead>Raw / Compiled</TableHead>TableHead>
                                                                          <TableHead>Expires</TableHead>TableHead>
                                                                          <TableHead>Released</TableHead>TableHead>
                                                                          <TableHead />
                                                          </TableRow>TableRow>
                                            
                                            </TableHeader>TableHeader>
                                            <TableBody>
                                              {filtered.map((r) => {
                          const eff = effectiveReleaseStatus(r);
                          const funderReady =
                                              (eff === "active" || eff === "expiring_soon") && consentSatisfied(r);
                          return (
                                              <TableRow key={r.id}>
                                                                  <TableCell className="font-mono text-xs">{r.deal_reference}</TableCell>TableCell>
                                                                  <TableCell>{r.funder_organisation?.name ?? "—"}</TableCell>TableCell>
                                                                  <TableCell className="text-xs">
                                                                                        <div className="font-mono">{r.evidence_pack_id ?? "—"}</div>div>
                                                                                        <div className="text-muted-foreground">v{r.evidence_pack_version ?? "—"}</div>div>
                                                                  </TableCell>TableCell>
                                                                  <TableCell>
                                                                                        <Badge variant={statusBadgeVariant(eff)}>{statusLabel(eff)}</Badge>Badge>
                                                                  </TableCell>TableCell>
                                                                  <TableCell>
                                                                    {(() => {
                                                                        const l = linkageStatusOf(r);
                                                                        return (
                                                                                                    <Badge variant={linkageStatusBadgeVariant(l)} data-testid={`fw-linkage-${r.id}`}>
                                                                                                      {LINKAGE_STATUS_LABEL[l]}
                                                                                                      </Badge>Badge>
                                                                                                  );
                                              })()}
                                                                  </TableCell>TableCell>
                                                                  <TableCell className="text-xs">
                                                                    {CONSENT_STATUS_LABELS[r.buyer_consent_status] ?? r.buyer_consent_status} / {CONSENT_STATUS_LABELS[r.seller_consent_status] ?? r.seller_consent_status}
                                                                  </TableCell>TableCell>
                                                                  <TableCell>{r.admin_override_reason ? <Badge variant="destructive">Yes</Badge>Badge> : "—"}</TableCell>TableCell>
                                                                  <TableCell>
                                                                                        <Badge variant={funderReady ? "default" : "secondary"} data-testid={`fw-funder-ready-${r.id}`}>
                                                                                          {funderReady ? "Yes" : "No"}
                                                                                          </Badge>Badge>
                                                                  </TableCell>TableCell>
                                                                  <TableCell className="text-xs">
                                                                                        Raw: {r.can_view_raw_documents ? "Y" : "N"} · Compiled: {r.can_download_compiled_pack ? "Y" : "N"}
                                                                  </TableCell>TableCell>
                                                                  <TableCell className="text-xs">{r.expires_at ? new Date(r.expires_at).toLocaleDateString() : "—"}</TableCell>TableCell>
                                                                  <TableCell className="text-xs">{r.released_at ? new Date(r.released_at).toLocaleDateString() : "—"}</TableCell>TableCell>
                                                                  <TableCell className="text-right">
                                                                                        <Link to={`/admin/funder-workspace/releases/${r.id}`} className="text-sm underline">Open</Link>Link>
                                                                  </TableCell>TableCell>
                                              </TableRow>TableRow>
                                            );
        })}
                                              {rows !== null && filtered.length === 0 && (
                          <TableRow>
                                            <TableCell colSpan={12} className="text-center text-sm text-muted-foreground py-8">
                                            
                                                                No releases match the filters.
                                            </TableCell>TableCell>
                          </TableRow>TableRow>
                                                          )}
                                            </TableBody>TableBody>
                                </Table>Table>
                      </CardContent>CardContent>
              </Card>Card>
        </div>div>
      );
}
</div>
