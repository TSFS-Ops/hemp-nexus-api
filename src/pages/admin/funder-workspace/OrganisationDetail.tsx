/**
 * Institutional Funder Evidence Workspace — Batch 2
 * Admin: Funder Organisation Detail (read-only in Batch 2).
 * Team management is intentionally out of scope for this batch.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BackButton } from "@/components/BackButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getFunderOrganisation,
  listAuditEvents,
  listReleasesForOrg,
  listUsageEvents,
} from "@/lib/funder-workspace/admin-client";
import type {
  AuditEventRow,
  DealReleaseRow,
  FunderOrganisationRow,
  UsageEventRow,
} from "@/lib/funder-workspace/types";

export default function FunderWorkspaceOrganisationDetail() {
  const { organisationId = "" } = useParams();
  const [org, setOrg] = useState<FunderOrganisationRow | null>(null);
  const [releases, setReleases] = useState<DealReleaseRow[]>([]);
  const [usage, setUsage] = useState<UsageEventRow[]>([]);
  const [audit, setAudit] = useState<AuditEventRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [o, rels, u, a] = await Promise.all([
          getFunderOrganisation(organisationId),
          listReleasesForOrg(organisationId),
          listUsageEvents({ organisationId, limit: 50 }),
          listAuditEvents({ organisationId, limit: 50 }),
        ]);
        setOrg(o);
        setReleases(rels);
        setUsage(u);
        setAudit(a);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [organisationId]);

  const active = releases.filter((r) => r.release_status === "active");
  const closed = releases.filter((r) => r.release_status !== "active");

  return (
    <div className="p-6 space-y-4" data-testid="fw-admin-org-detail">
      <BackButton fallback="/admin/funder-workspace/organisations" label="All organisations" />

      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">Failed to load: {error}</CardContent>
        </Card>
      )}

      {org && (
        <>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold">{org.name}</h1>
              <p className="text-sm text-muted-foreground">Funder organisation record.</p>
            </div>
            <div className="space-x-2">
              <Badge>{org.approval_status ?? "admin_created"}</Badge>
              <Badge variant={org.status === "active" ? "default" : "secondary"}>{org.status}</Badge>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Organisation details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">Registration number:</span> <span className="font-mono">{org.registration_number ?? "—"}</span></div>
              <div><span className="text-muted-foreground">Jurisdiction:</span> {org.jurisdiction ?? "—"}</div>
              <div><span className="text-muted-foreground">Contact email:</span> {org.contact_email ?? "—"}</div>
              <div><span className="text-muted-foreground">Contact name:</span> {org.contact_person_name ?? "—"}</div>
              <div><span className="text-muted-foreground">Contact phone:</span> {org.contact_phone ?? "—"}</div>
              <div><span className="text-muted-foreground">Approved at:</span> {org.approved_at ? new Date(org.approved_at).toLocaleString() : "—"}</div>
              <div><span className="text-muted-foreground">Created at:</span> {new Date(org.created_at).toLocaleString()}</div>
              {org.rejection_reason && (
                <div className="md:col-span-2"><span className="text-muted-foreground">Rejection reason:</span> {org.rejection_reason}</div>
              )}
              {org.suspension_reason && (
                <div className="md:col-span-2"><span className="text-muted-foreground">Suspension reason:</span> {org.suspension_reason}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Funder users</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Funder team self-service management is not available in this batch. Users are managed via the existing P-5 Batch 3 admin console.
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active releases ({active.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <ReleasesTable rows={active} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revoked / expired releases ({closed.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <ReleasesTable rows={closed} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent usage events</CardTitle>
            </CardHeader>
            <CardContent>
              <UsageTable rows={usage} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent audit events</CardTitle>
            </CardHeader>
            <CardContent>
              <AuditTable rows={audit} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ReleasesTable({ rows }: { rows: DealReleaseRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Deal</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Buyer / Seller consent</TableHead>
          <TableHead>Override</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-mono text-xs">{r.deal_reference}</TableCell>
            <TableCell><Badge variant={r.release_status === "active" ? "default" : "secondary"}>{r.release_status}</Badge></TableCell>
            <TableCell className="text-xs">{r.buyer_consent_status} / {r.seller_consent_status}</TableCell>
            <TableCell>{r.admin_override_reason ? <Badge variant="destructive">Override</Badge> : "—"}</TableCell>
            <TableCell className="text-xs">{r.expires_at ? new Date(r.expires_at).toLocaleDateString() : "—"}</TableCell>
            <TableCell className="text-right">
              <Link to={`/admin/funder-workspace/releases/${r.id}`} className="text-sm underline">Open</Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function UsageTable({ rows }: { rows: UsageEventRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Event</TableHead>
          <TableHead>Deal</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="text-xs">{new Date(e.occurred_at).toLocaleString()}</TableCell>
            <TableCell className="font-mono text-xs">{e.event_type}</TableCell>
            <TableCell className="font-mono text-xs">{e.deal_reference ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AuditTable({ rows }: { rows: AuditEventRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Object</TableHead>
          <TableHead>Reason</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="text-xs">{new Date(e.occurred_at).toLocaleString()}</TableCell>
            <TableCell className="font-mono text-xs">{e.action}</TableCell>
            <TableCell className="text-xs">{e.object_type ?? "—"}</TableCell>
            <TableCell className="text-xs">{e.reason_code ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
