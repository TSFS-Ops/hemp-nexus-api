/**
 * Institutional Funder Evidence Workspace — Batch 2
 * Admin: Release Detail. Read-only view + revoke action.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  generateSealedPack,
  getRelease,
  listAuditEvents,
  listReleaseConsents,
  listReleasePackVersions,
  listUsageEvents,
  revokeRelease,
} from "@/lib/funder-workspace/admin-client";
import type { DealReleaseWithOrg } from "@/lib/funder-workspace/admin-client";
import type {
  AuditEventRow,
  PackVersionRow,
  ReleaseConsentRow,
  UsageEventRow,
} from "@/lib/funder-workspace/types";


export default function FunderWorkspaceReleaseDetail() {
  const { releaseId = "" } = useParams();
  const [release, setRelease] = useState<DealReleaseWithOrg | null>(null);
  const [consents, setConsents] = useState<ReleaseConsentRow[]>([]);
  const [packs, setPacks] = useState<PackVersionRow[]>([]);
  const [usage, setUsage] = useState<UsageEventRow[]>([]);
  const [audit, setAudit] = useState<AuditEventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [r, c, p, u, a] = await Promise.all([
        getRelease(releaseId),
        listReleaseConsents(releaseId),
        listReleasePackVersions(releaseId),
        listUsageEvents({ releaseId, limit: 100 }),
        listAuditEvents({ objectId: releaseId, limit: 100 }),
      ]);
      setRelease(r);
      setConsents(c);
      setPacks(p);
      setUsage(u);
      setAudit(a);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [releaseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRevoke = async () => {
    const trimmed = reason.trim();
    if (trimmed === "") {
      toast.error("Revocation reason is required");
      return;
    }
    setBusy(true);
    try {
      await revokeRelease({ p_release_id: releaseId, p_reason: trimmed });
      toast.success("Release revoked");
      setRevokeOpen(false);
      setReason("");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const [generating, setGenerating] = useState(false);
  const handleGenerate = async () => {
    if (!release) return;
    setGenerating(true);
    try {
      const res = await generateSealedPack(releaseId);
      toast.success(`Sealed pack v${res.version} generated`);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-6 space-y-4" data-testid="fw-admin-release-detail">
      <BackButton fallback="/admin/funder-workspace/releases" label="Releases" />

      {error && <Card><CardContent className="pt-6 text-sm text-destructive">Failed to load: {error}</CardContent></Card>}

      {release && (
        <>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold">Release {release.deal_reference}</h1>
              <p className="text-sm text-muted-foreground">
                {release.funder_organisation?.name ?? "—"} · Pack v{release.evidence_pack_version ?? "—"}
              </p>
            </div>
            <div className="space-x-2">
              <Badge variant={release.release_status === "active" ? "default" : release.release_status === "revoked" ? "destructive" : "secondary"}>
                {release.release_status}
              </Badge>
              <Button
                variant="destructive"
                disabled={release.release_status === "revoked"}
                onClick={() => setRevokeOpen(true)}
                data-testid="fw-release-revoke"
              >
                Revoke
              </Button>
            </div>
          </div>

          {release.admin_override_reason && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Admin override in effect</AlertTitle>
              <AlertDescription>{release.admin_override_reason}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Release details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Deal:</span> <span className="font-mono">{release.deal_reference}</span></div>
              <div><span className="text-muted-foreground">Funder:</span> {release.funder_organisation?.name ?? "—"}</div>
              <div><span className="text-muted-foreground">Pack ID:</span> <span className="font-mono text-xs">{release.evidence_pack_id ?? "—"}</span></div>
              <div><span className="text-muted-foreground">Pack version:</span> {release.evidence_pack_version ?? "—"}</div>
              <div><span className="text-muted-foreground">Released at:</span> {release.released_at ? new Date(release.released_at).toLocaleString() : "—"}</div>
              <div><span className="text-muted-foreground">Expires at:</span> {release.expires_at ? new Date(release.expires_at).toLocaleString() : "—"}</div>
              {release.revoked_at && (
                <>
                  <div><span className="text-muted-foreground">Revoked at:</span> {new Date(release.revoked_at).toLocaleString()}</div>
                  <div className="md:col-span-2"><span className="text-muted-foreground">Revocation reason:</span> {release.revocation_reason}</div>
                </>
              )}
              <div className="md:col-span-2"><span className="text-muted-foreground">Release reason:</span> {release.release_reason ?? "—"}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Permissions</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
              <Perm label="Evidence summary" v={release.can_view_evidence_summary} />
              <Perm label="Evidence room" v={release.can_view_evidence_room} />
              <Perm label="Compiled pack download" v={release.can_download_compiled_pack} />
              <Perm label="Raw documents (view)" v={release.can_view_raw_documents} elevated />
              <Perm label="Raw documents (download)" v={release.can_download_raw_documents} elevated />
              <Perm label="Unmasked sensitive details" v={release.can_view_unmasked_sensitive_details} elevated />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Consent</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Party</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Captured at</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Override reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consents.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="capitalize">{c.party_type}</TableCell>
                      <TableCell><Badge variant={c.status === "granted" ? "default" : c.status === "overridden" ? "destructive" : "secondary"}>{c.status}</Badge></TableCell>
                      <TableCell className="text-xs">{c.captured_at ? new Date(c.captured_at).toLocaleString() : "—"}</TableCell>
                      <TableCell className="text-xs">{c.source ?? "—"}</TableCell>
                      <TableCell className="text-xs">{c.override_reason ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Pack versions</CardTitle></CardHeader>
            <CardContent>
              {packs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No compiled pack versions have been produced yet. PDF generation is not part of this batch.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Generated</TableHead>
                      <TableHead>Sealed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {packs.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>v{p.version}</TableCell>
                        <TableCell><Badge>{p.status}</Badge></TableCell>
                        <TableCell className="text-xs">{p.generated_at ? new Date(p.generated_at).toLocaleString() : "—"}</TableCell>
                        <TableCell className="text-xs">{p.sealed_at ? new Date(p.sealed_at).toLocaleString() : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Usage events</CardTitle></CardHeader>
            <CardContent>
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
                      <TableCell className="text-xs">{new Date(e.occurred_at).toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-xs">{e.event_type}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Audit events</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{new Date(a.created_at).toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-xs">{a.action}</TableCell>
                      <TableCell className="text-xs">{a.reason_code ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Revoke deal release</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-sm">
              This immediately terminates the funder's access to this release. A written reason is required.
            </p>
            <Label htmlFor="fw-revoke-reason">Revocation reason (required)</Label>
            <Textarea id="fw-revoke-reason" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={1000} />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button variant="destructive" onClick={handleRevoke} disabled={busy || reason.trim() === ""} data-testid="fw-release-revoke-confirm">
              Revoke release
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Perm({ label, v, elevated }: { label: string; v: boolean; elevated?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={elevated ? "text-sm" : "text-sm"}>{label}</span>
      <Badge variant={v ? (elevated ? "destructive" : "default") : "secondary"}>{v ? "Enabled" : "Off"}</Badge>
    </div>
  );
}
