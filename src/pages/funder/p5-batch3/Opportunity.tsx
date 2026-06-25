/**
 * P-5 Batch 3 — Stage 5 released opportunity detail.
 *
 * Renders only safe summary fields. No raw documents, no other-funder data,
 * no internal notes. Provider wording is double-guarded.
 */
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchFunderSummary, type P5B3FunderSummaryResponse } from "@/lib/p5-batch3/summary-client";
import { P5B3FunderShell } from "./components/P5B3FunderShell";
import { P5B3FunderSafeLabel } from "./components/P5B3FunderSafeLabel";
import { P5B3FunderUnavailable } from "./components/P5B3FunderUnavailable";

export default function P5Batch3FunderOpportunity() {
  const { grantId } = useParams();
  const location = useLocation();
  const passedRef = (location.state as { transaction_reference?: string } | null)?.transaction_reference ?? "";
  const [txRef, setTxRef] = useState(passedRef);
  const [data, setData] = useState<P5B3FunderSummaryResponse | null>(null);
  const [denial, setDenial] = useState<{ reason?: string; message?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (ref: string) => {
    if (!ref.trim()) return;
    setBusy(true);
    setDenial(null);
    const res = await fetchFunderSummary({ transaction_reference: ref.trim() });
    if (res.ok !== true) {
      setData(null);
      setDenial({ reason: res.denial.reason, message: res.denial.error });
    } else {
      setData(res.data);
    }
    setBusy(false);
  };

  useEffect(() => {
    if (passedRef) void load(passedRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passedRef]);

  return (
    <P5B3FunderShell
      title="Released opportunity"
      description={`Grant ${grantId ?? ""} — released for funder review only.`}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transaction reference</CardTitle>
          <CardDescription>Provided to you by Izenzo for this release.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="p5b3-funder-opp-ref">Reference</Label>
          <div className="flex gap-2">
            <Input
              id="p5b3-funder-opp-ref"
              value={txRef}
              onChange={(e) => setTxRef(e.target.value)}
            />
            <Button onClick={() => load(txRef)} disabled={busy || !txRef.trim()}>
              Load
            </Button>
          </div>
        </CardContent>
      </Card>

      {denial ? <P5B3FunderUnavailable reason={denial.reason} message={denial.message} /> : null}

      {data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Opportunity summary</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <Row label="Company / applicant" value={data.counterparty_display_name ?? "—"} />
              <Row label="Transaction reference" value={data.access_grant?.transaction_reference ?? "—"} />
              <Row label="Jurisdiction" value={data.jurisdiction_summary ?? "—"} />
              <Row label="Released evidence pack version" value={data.released_evidence_pack_version ?? "—"} />
              <Row label="Released pack SHA-256" value={data.released_pack_sha256 ?? "—"} />
              <Row
                label="Status (provider-safe)"
                valueNode={<P5B3FunderSafeLabel label={data.provider_safe_status_label} />}
              />
              <Row
                label="Access expires"
                value={
                  data.access_grant
                    ? new Date(data.access_grant.expiry_at).toLocaleString()
                    : "—"
                }
              />
              {data.transaction_summary ? (
                <div className="pt-2">
                  <div className="font-medium text-foreground">Transaction summary</div>
                  <p className="text-muted-foreground whitespace-pre-wrap">{data.transaction_summary}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Allowed actions</CardTitle>
            </CardHeader>
            <CardContent className="text-sm flex flex-wrap gap-2">
              <Link to={`/funder/p5-batch3/readiness/${grantId}`} state={{ transaction_reference: txRef }}>
                <Button variant="outline" size="sm">Readiness summary</Button>
              </Link>
              <Link to={`/funder/p5-batch3/requests/${grantId}`} state={{ transaction_reference: txRef }}>
                <Button variant="outline" size="sm">Submit a request</Button>
              </Link>
              <Link to={`/funder/p5-batch3/outcomes/${grantId}`} state={{ transaction_reference: txRef }}>
                <Button variant="outline" size="sm">Record an outcome</Button>
              </Link>
              {data.access_grant?.can_download ? (
                <Link to={`/funder/p5-batch3/downloads/${grantId}`} state={{ transaction_reference: txRef }}>
                  <Button variant="outline" size="sm">Download centre</Button>
                </Link>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}
    </P5B3FunderShell>
  );
}

function Row({ label, value, valueNode }: { label: string; value?: string; valueNode?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-muted-foreground w-56 shrink-0">{label}:</span>
      <span className="text-foreground">{valueNode ?? value}</span>
    </div>
  );
}
