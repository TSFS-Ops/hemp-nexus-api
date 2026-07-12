/**
 * Batch 3 — Funder workspace: read-only release detail.
 * RLS-scoped: getMyRelease returns null for releases not linked to the
 * caller's funder organisation. We render an opaque access-denied state
 * that does not confirm the release's existence.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle } from "lucide-react";
import { FunderWorkspaceShell } from "./components/FunderWorkspaceShell";
import {
  ConsentStatusBadge,
  FunderReleaseStatusBadge,
  PermissionBadge,
} from "./components/FunderBadges";
import {
  getMyRelease,
  listMyPackVersions,
  listMyReleaseConsents,
  listMyUsageEvents,
} from "@/lib/funder-workspace/funder-client";
import type {
  DealReleaseRow,
  PackVersionRow,
  ReleaseConsentRow,
  UsageEventRow,
} from "@/lib/funder-workspace/types";

const EVIDENCE_SECTIONS: Array<{ title: string; description: string }> = [
  { title: "Buyer summary", description: "Released buyer summary will appear here." },
  { title: "Seller summary", description: "Released seller summary will appear here." },
  { title: "Verification summary", description: "Verification outcome summary." },
  { title: "IDV / KYB summary", description: "Identity and business verification summary." },
  { title: "WaD status", description: "Without-a-Doubt evidence status." },
  { title: "Bank-confidence section", description: "Bank confirmation confidence." },
  { title: "Evidence register", description: "Register of released evidence items." },
  { title: "Missing evidence", description: "Evidence known to be outstanding." },
  { title: "Risk / exception summary", description: "Risk flags and exceptions." },
  { title: "Finality snapshot", description: "Latest finality snapshot." },
  { title: "Audit summary", description: "Audit trail summary." },
];

export default function FunderWorkspaceDealDetail() {
  const { releaseId = "" } = useParams();
  return (
    <FunderWorkspaceShell title="Deal detail" description="Read-only evidence room.">
      {() => <Body releaseId={releaseId} />}
    </FunderWorkspaceShell>
  );
}

function Body({ releaseId }: { releaseId: string }) {
  const [release, setRelease] = useState<DealReleaseRow | null | undefined>(undefined);
  const [consents, setConsents] = useState<ReleaseConsentRow[]>([]);
  const [packs, setPacks] = useState<PackVersionRow[]>([]);
  const [usage, setUsage] = useState<UsageEventRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await getMyRelease(releaseId);
        setRelease(r ?? null);
        if (r) {
          const [c, p, u] = await Promise.all([
            listMyReleaseConsents(releaseId),
            listMyPackVersions(releaseId),
            listMyUsageEvents({ releaseId, limit: 50 }),
          ]);
          setConsents(c);
          setPacks(p);
          setUsage(u);
        }
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [releaseId]);

  if (err) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-destructive">{err}</CardContent>
      </Card>
    );
  }

  if (release === undefined) return <p className="text-sm">Loading…</p>;

  if (release === null) {
    // Opaque: do not confirm existence of the id.
    return (
      <Card data-testid="fw-funder-access-denied">
        <CardContent className="pt-6 space-y-2">
          <h2 className="text-lg font-semibold">Not available</h2>
          <p className="text-sm text-muted-foreground">
            This link is not available to your organisation. If you believe this
            is a mistake, please contact Izenzo.
          </p>
          <Link
            to="/funder/workspace/deals"
            className="text-sm underline text-primary"
          >
            Back to deals
          </Link>
        </CardContent>
      </Card>
    );
  }

  const overrideUsed =
    release.buyer_consent_status === "overridden" ||
    release.seller_consent_status === "overridden";

  return (
    <div className="space-y-4" data-testid="fw-funder-deal-detail">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold font-mono">
            {release.deal_reference}
          </h2>
          <p className="text-sm text-muted-foreground">
            Pack {release.evidence_pack_id ?? "—"} · v
            {release.evidence_pack_version ?? "—"}
          </p>
        </div>
        <FunderReleaseStatusBadge status={release.release_status} />
      </div>

      {(release.release_status === "revoked" || release.release_status === "expired") && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Access no longer active</AlertTitle>
          <AlertDescription>
            This release is {release.release_status}. Historical data is shown for
            audit purposes only.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overview</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <Field label="Deal reference" value={release.deal_reference} mono />
          <Field label="Release status" value={release.release_status} />
          <Field
            label="Released at"
            value={
              release.released_at
                ? new Date(release.released_at).toLocaleString()
                : "—"
            }
          />
          <Field
            label="Expires at"
            value={
              release.expires_at
                ? new Date(release.expires_at).toLocaleString()
                : "—"
            }
          />
          <Field label="Evidence pack ID" value={release.evidence_pack_id ?? "—"} mono />
          <Field
            label="Evidence pack version"
            value={release.evidence_pack_version ?? "—"}
          />
          <div className="md:col-span-2">
            <Field label="Release reason" value={release.release_reason ?? "—"} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Permissions</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <PermRow label="View evidence summary" value={release.can_view_evidence_summary} />
          <PermRow label="View evidence room" value={release.can_view_evidence_room} />
          <PermRow label="Download compiled pack" value={release.can_download_compiled_pack} />
          <PermRow label="View raw documents" value={release.can_view_raw_documents} />
          <PermRow label="Download raw documents" value={release.can_download_raw_documents} />
          <PermRow label="View unmasked sensitive details" value={release.can_view_unmasked_sensitive_details} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Buyer</div>
              <ConsentStatusBadge status={release.buyer_consent_status} />
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Seller</div>
              <ConsentStatusBadge status={release.seller_consent_status} />
            </div>
          </div>
          {overrideUsed && (
            <p className="text-xs text-muted-foreground">
              An admin override was used to grant access. Detailed override
              reasoning is not disclosed on funder surfaces.
            </p>
          )}
          {consents.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Party</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Captured</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {consents.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="capitalize">{c.party_type}</TableCell>
                    <TableCell>
                      <ConsentStatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {c.captured_at
                        ? new Date(c.captured_at).toLocaleString()
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evidence room</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {EVIDENCE_SECTIONS.map((s) => (
            <div
              key={s.title}
              className="rounded-md border p-3 bg-muted/30"
              data-testid={`fw-evidence-${s.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}
            >
              <div className="text-sm font-medium">{s.title}</div>
              <div className="text-xs text-muted-foreground">{s.description}</div>
              <Badge variant="secondary" className="mt-2">
                Not yet connected
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pack versions</CardTitle>
        </CardHeader>
        <CardContent>
          {packs.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="fw-pack-empty">
              PDF generation comes in the next build batch.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead>Sealed</TableHead>
                  <TableHead>File hash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packs.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>v{p.version}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.generated_at
                        ? new Date(p.generated_at).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.sealed_at
                        ? new Date(p.sealed_at).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.file_sha256 ? "present" : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            PDF generation and sealed-pack download will be introduced in a later
            build batch.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {usage.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recorded activity yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs">
                      {new Date(e.occurred_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.event_type}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Information above has been approved for release. Internal admin notes,
        raw documents and provider raw responses are not shown here.
      </p>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-xs" : "text-sm"}>{value}</div>
    </div>
  );
}

function PermRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <PermissionBadge value={value} />
    </div>
  );
}
