/**
 * P-5 Batch 3 — Stage 5 funder download centre.
 *
 * Read-only. Only released, watermarked PDF packs are downloadable, via the
 * p5b3_funder_record_download_v1 RPC wrapper which issues an audited,
 * time-limited link. Raw KYC/KYB, raw bank, raw ID/passport, raw UBO,
 * CSV/database exports and unmasked sensitive data are never offered here.
 */
import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchFunderSummary, type P5B3FunderSummaryResponse } from "@/lib/p5-batch3/summary-client";
import { p5b3RecordDownload } from "@/lib/p5-batch3/rpc";
import { P5B3DOWNLOAD_LINK_TTL_DAYS_LABEL } from "@/lib/p5-batch3/downloads-constants";
import { P5B3FunderShell } from "./components/P5B3FunderShell";
import { P5B3FunderUnavailable } from "./components/P5B3FunderUnavailable";

export default function P5Batch3FunderDownloads() {
  const { grantId } = useParams();
  const location = useLocation();
  const passedRef = (location.state as { transaction_reference?: string } | null)?.transaction_reference ?? "";
  const [txRef, setTxRef] = useState(passedRef);
  const [data, setData] = useState<P5B3FunderSummaryResponse | null>(null);
  const [denial, setDenial] = useState<{ reason?: string; message?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [issuingPdf, setIssuingPdf] = useState(false);

  const load = async (ref: string) => {
    setBusy(true);
    setDenial(null);
    const res = await fetchFunderSummary({ transaction_reference: ref.trim() });
    if (!res.ok) {
      setData(null);
      setDenial({ reason: res.denial.reason, message: res.denial.error });
    } else setData(res.data);
    setBusy(false);
  };

  useEffect(() => {
    if (passedRef) void load(passedRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passedRef]);

  const requestPdf = async () => {
    if (!grantId || !data?.access_grant) return;
    if (!data.access_grant.can_download) {
      toast.error("Download is not enabled on this grant.");
      return;
    }
    setIssuingPdf(true);
    try {
      await p5b3RecordDownload({
        p_grant_id: grantId,
        p_evidence_pack_id: "released",
        p_evidence_pack_version: data.released_evidence_pack_version ?? "",
        p_file_name: `pack-${data.access_grant.transaction_reference}-v${
          data.released_evidence_pack_version ?? "n"
        }.pdf`,
        p_file_type: "pdf",
      });
      toast.success("Download recorded. Time-limited link issued by Izenzo.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIssuingPdf(false);
    }
  };

  const grantStatus = data?.access_grant?.status;
  const expired = grantStatus === "expired";
  const revoked = grantStatus === "revoked";

  return (
    <P5B3FunderShell
      title="Download centre"
      description={`Grant ${grantId ?? ""} — released PDF packs only.`}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transaction reference</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="p5b3-download-ref">Reference</Label>
            <Input id="p5b3-download-ref" value={txRef} onChange={(e) => setTxRef(e.target.value)} />
          </div>
          <Button className="self-end" onClick={() => load(txRef)} disabled={busy || !txRef.trim()}>
            Load
          </Button>
        </CardContent>
      </Card>

      {denial ? <P5B3FunderUnavailable reason={denial.reason} message={denial.message} /> : null}
      {expired ? <P5B3FunderUnavailable reason="grant_expired" /> : null}
      {revoked ? <P5B3FunderUnavailable reason="grant_revoked" /> : null}

      {data && !expired && !revoked ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Released evidence pack (PDF)</CardTitle>
            <CardDescription>
              Watermarked PDF only. Links are time-limited ({P5B3DOWNLOAD_LINK_TTL_DAYS_LABEL}).
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <div className="rounded-md border p-3 space-y-1">
              <Row label="Funder organisation" value={data.access_grant?.funder_organisation_id ?? "—"} />
              <Row label="Funder user" value={data.access_grant?.funder_user_id ?? "—"} />
              <Row label="Transaction reference" value={data.access_grant?.transaction_reference ?? "—"} />
              <Row label="Pack version" value={data.released_evidence_pack_version ?? "—"} />
              <Row label="Access expires" value={data.access_grant ? new Date(data.access_grant.expiry_at).toLocaleString() : "—"} />
              <Row label="Watermark" value="Confidential — released for authorised funder review only" />
            </div>
            <Button onClick={requestPdf} disabled={issuingPdf || !data.access_grant?.can_download}>
              Request signed PDF link
            </Button>
            {!data.access_grant?.can_download ? (
              <p className="text-xs text-muted-foreground">
                Download is not enabled on this grant. Contact Izenzo to request download access.
              </p>
            ) : null}
            <div className="text-xs text-muted-foreground space-y-1 pt-2">
              <div>Not available here: raw KYC/KYB, raw bank, raw ID/passport, raw UBO, CSV exports, database exports, unmasked sensitive data.</div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </P5B3FunderShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-muted-foreground w-44 shrink-0">{label}:</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
