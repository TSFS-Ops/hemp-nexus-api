/**
 * Batch 3 — Funder workspace: read-only release detail.
 *
 * RLS-scoped: getMyRelease returns null for releases not linked to the
 * caller's funder organisation. We render an opaque access-denied state
 * that does not confirm the release's existence.
 *
 * TODO(backend): buyer_display_name and seller_display_name are NOT in
 * the funder-authorised release row (DealReleaseRow). A narrow
 * server-side projection scoped to the assigned release is needed
 * before we can surface counterparty names here. Do not fabricate.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, Download, MinusCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FunderWorkspaceShell } from "./components/FunderWorkspaceShell";
import {
  FunderDecisionPanel,
  FunderNotesPanel,
  FunderRfiPanel,
} from "./components/FunderWorkflowPanels";
import type { V1Role } from "@/lib/funder-workspace/workflow-client";
import {
  getMyRelease,
  listMyPackVersions,
  listMyReleaseConsents,
  listMyUsageEvents,
  requestPackDownload,
} from "@/lib/funder-workspace/funder-client";
import type { CurrentFunderContext } from "@/lib/funder-workspace/funder-client";
import type {
  DealReleaseRow,
  PackVersionRow,
  ReleaseConsentRow,
  UsageEventRow,
} from "@/lib/funder-workspace/types";
import {
  effectiveReleaseStatus,
  packDownloadReadiness,
} from "@/lib/funder-workspace/release-state";
import {
  EmptyState,
  ExpiryIndicator,
  InfoBanner,
  LoadingState,
  SectionHeading,
  StatusBadge,
  formatDate,
  formatDateTime,
  usageEventLabel,
} from "@/lib/funder-workspace/ui";

function mapEnumToV1Role(role: string | null | undefined): V1Role | null {
  switch (role) {
    case "funder_org_admin": return "admin";
    case "funder_approver": return "approver";
    case "funder_reviewer": return "reviewer";
    case "funder_viewer": return "viewer";
    case "external_adviser": return "external_adviser";
    default: return null;
  }
}

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
      {(ctx) => <Body releaseId={releaseId} ctx={ctx} />}
    </FunderWorkspaceShell>
  );
}

function Body({ releaseId, ctx }: { releaseId: string; ctx: CurrentFunderContext }) {
  const v1Role = mapEnumToV1Role(ctx.role);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, []);
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

  if (err) return <InfoBanner tone="destructive" title="Failed to load deal">{err}</InfoBanner>;
  if (release === undefined) return <LoadingState label="Loading deal…" />;

  if (release === null) {
    return (
      <Card data-testid="fw-funder-access-denied">
        <CardContent className="pt-6 space-y-2">
          <h2 className="text-lg font-semibold">Not available</h2>
          <p className="text-sm text-muted-foreground">
            This link is not available to your organisation. If you believe this
            is a mistake, please contact Izenzo.
          </p>
          <Link to="/funder/workspace/deals" className="text-sm underline text-primary">
            ← Back to deals
          </Link>
        </CardContent>
      </Card>
    );
  }

  const overrideUsed =
    release.buyer_consent_status === "overridden" ||
    release.seller_consent_status === "overridden";
  const eff = effectiveReleaseStatus(release);

  return (
    <div className="space-y-4" data-testid="fw-funder-deal-detail">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Assigned deal
          </div>
          <h2 className="text-xl sm:text-2xl font-semibold text-foreground mt-0.5">
            {release.deal_reference}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Released to <span className="font-medium text-foreground">{ctx.organisation.name}</span>
            {release.expires_at && (
              <>
                {" "}· access expires <ExpiryIndicator expiresAt={release.expires_at} compact />
              </>
            )}
          </p>
        </div>
        <StatusBadge kind="release" value={eff} className="self-start sm:self-auto" />
      </div>

      {(eff === "revoked" || eff === "expired") && (
        <InfoBanner tone="destructive" title="Access no longer active">
          This release is {eff}. Historical data is shown for audit purposes only.
        </InfoBanner>
      )}

      {/* Overview */}
      <Card>
        <CardHeader>
          <SectionHeading title="Overview" />
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <Field label="Deal reference" value={release.deal_reference} />
          <Field
            label="Release status"
            valueNode={<StatusBadge kind="release" value={eff} />}
          />
          <Field label="Funder organisation" value={ctx.organisation.name} />
          <Field
            label="Evidence pack version"
            value={release.evidence_pack_version ? `v${release.evidence_pack_version}` : "—"}
          />
          <Field label="Released" value={formatDateTime(release.released_at)} />
          <Field
            label="Access expires"
            valueNode={<ExpiryIndicator expiresAt={release.expires_at} />}
          />
          <div className="sm:col-span-2">
            <Field label="Release reason" value={release.release_reason ?? "—"} />
          </div>
          {/* TODO(backend): buyer/seller display names not yet in funder projection */}
        </CardContent>
      </Card>

      {/* Permissions */}
      <Card>
        <CardHeader>
          <SectionHeading
            title="Permissions granted for this release"
            description="What Izenzo has approved for your organisation on this deal."
          />
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <PermRow label="View evidence summary" value={release.can_view_evidence_summary} />
          <PermRow label="View evidence room" value={release.can_view_evidence_room} />
          <PermRow label="Download compiled pack" value={release.can_download_compiled_pack} />
          <PermRow label="View raw documents" value={release.can_view_raw_documents} />
          <PermRow label="Download raw documents" value={release.can_download_raw_documents} />
          <PermRow label="View unmasked sensitive details" value={release.can_view_unmasked_sensitive_details} />
        </CardContent>
      </Card>

      {/* Consent */}
      <Card>
        <CardHeader>
          <SectionHeading title="Consent" />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ConsentTile label="Buyer" status={release.buyer_consent_status} />
            <ConsentTile label="Seller" status={release.seller_consent_status} />
          </div>
          {overrideUsed && (
            <p className="text-xs text-muted-foreground">
              An admin override was used to grant access. Detailed override
              reasoning is not disclosed on funder surfaces.
            </p>
          )}
          {consents.length > 0 && (
            <div className="overflow-x-auto">
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
                      <TableCell><StatusBadge kind="consent" value={c.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(c.captured_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Evidence room */}
      <Card>
        <CardHeader>
          <SectionHeading
            title="Evidence room"
            description="Sections included in the sealed pack. Data pipes for each section are being connected."
          />
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {EVIDENCE_SECTIONS.map((s) => (
            <div
              key={s.title}
              className="rounded-md border p-3 bg-muted/30"
              data-testid={`fw-evidence-${s.title.toLowerCase().replace(/[^a-z]+/g, "-")}`}
            >
              <div className="text-sm font-medium text-foreground">{s.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{s.description}</div>
              <Badge variant="secondary" className="mt-2 text-[11px]">
                Not yet connected
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Pack versions */}
      <Card>
        <CardHeader>
          <SectionHeading
            title="Pack versions"
            description="Downloads produce a short-lived signed link. Raw underlying documents are not included in the compiled pack."
          />
        </CardHeader>
        <CardContent>
          {packs.length === 0 ? (
            <EmptyState
              title="No pack versions yet"
              description="A sealed pack will appear here once Izenzo generates it."
              testId="fw-pack-empty"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Generated</TableHead>
                    <TableHead>Sealed</TableHead>
                    <TableHead>Integrity</TableHead>
                    <TableHead className="text-right">Download</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {packs.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">v{p.version}</TableCell>
                      <TableCell><StatusBadge kind="pack" value={p.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(p.generated_at)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(p.sealed_at)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {p.file_sha256 ? (
                          <span className="inline-flex items-center gap-1 text-foreground">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Sealed
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <FunderPackDownloadButton pack={p} release={release} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activity */}
      <Card>
        <CardHeader>
          <SectionHeading title="Activity on this deal" />
        </CardHeader>
        <CardContent>
          {usage.length === 0 ? (
            <EmptyState title="No activity yet on this deal" />
          ) : (
            <div className="overflow-x-auto">
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
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(e.occurred_at)}
                      </TableCell>
                      <TableCell className="text-sm">{usageEventLabel(e.event_type)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <FunderRfiPanel release={release} role={v1Role} currentUserId={currentUserId} />
      <FunderNotesPanel release={release} role={v1Role} currentUserId={currentUserId} />
      <FunderDecisionPanel release={release} role={v1Role} />

      <p className="text-xs text-muted-foreground">
        Information above has been approved for release. Internal admin notes,
        raw documents and provider raw responses are not shown here.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  valueNode,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground mt-0.5">{valueNode ?? value ?? "—"}</div>
    </div>
  );
}

function PermRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-foreground">{label}</span>
      {value ? (
        <span className="inline-flex items-center gap-1 text-sm text-primary font-medium">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Yes
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <MinusCircle className="h-4 w-4" aria-hidden="true" />
          No
        </span>
      )}
    </div>
  );
}

function ConsentTile({
  label,
  status,
}: {
  label: string;
  status: DealReleaseRow["buyer_consent_status"];
}) {
  return (
    <div className="rounded-md border p-3 bg-muted/30">
      <div className="text-xs text-muted-foreground">{label} consent</div>
      <div className="mt-1"><StatusBadge kind="consent" value={status} /></div>
    </div>
  );
}

function FunderPackDownloadButton({
  pack,
  release,
}: {
  pack: PackVersionRow;
  release: DealReleaseRow;
}) {
  const [busy, setBusy] = useState(false);
  const readiness = packDownloadReadiness(release, pack);

  if (!readiness.ready) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled
        data-testid={`fw-download-disabled-${pack.id}`}
        title={readiness.reason}
        aria-label={readiness.reason ?? "Download not available"}
      >
        Not available
      </Button>
    );
  }

  const handle = async () => {
    setBusy(true);
    try {
      const res = await requestPackDownload(pack.id);
      // Trigger via a real anchor click (navigation, not popup) so browsers
      // do not block it after the async round-trip. window.open() from an
      // async callback is treated as a programmatic popup and routinely
      // blocked, which previously surfaced to funders as "download error".
      const a = document.createElement("a");
      a.href = res.signed_url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.download = `evidence-pack-v${res.version}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(
        `Download starting. Link expires in ${Math.round(res.expires_in_seconds / 60)} min.`,
      );
    } catch (e) {
      toast.error((e as Error).message || "Download not available");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size="sm"
      onClick={handle}
      disabled={busy}
      data-testid={`fw-download-${pack.id}`}
    >
      <Download className="h-4 w-4 mr-1" aria-hidden="true" />
      {busy ? "Preparing…" : "Download sealed pack"}
    </Button>
  );
}
