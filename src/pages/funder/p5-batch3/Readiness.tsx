/**
 * P-5 Batch 3 — Stage 5 funder readiness summary.
 *
 * Renders readiness-related safe fields only. Provider wording is guarded.
 */
import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchFunderSummary, type P5B3FunderSummaryResponse } from "@/lib/p5-batch3/summary-client";
import { P5B3FunderShell } from "./components/P5B3FunderShell";
import { P5B3FunderSafeLabel } from "./components/P5B3FunderSafeLabel";
import { P5B3FunderUnavailable } from "./components/P5B3FunderUnavailable";

export default function P5Batch3FunderReadiness() {
  const { grantId } = useParams();
  const location = useLocation();
  const passedRef = (location.state as { transaction_reference?: string } | null)?.transaction_reference ?? "";
  const [txRef, setTxRef] = useState(passedRef);
  const [data, setData] = useState<P5B3FunderSummaryResponse | null>(null);
  const [denial, setDenial] = useState<{ reason?: string; message?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (ref: string) => {
    setBusy(true);
    setDenial(null);
    const res = await fetchFunderSummary({ transaction_reference: ref.trim() });
    if (res.ok !== true) {
      setData(null);
      setDenial({ reason: res.denial.reason, message: res.denial.error });
    } else setData(res.data);
    setBusy(false);
  };

  useEffect(() => {
    if (passedRef) void load(passedRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passedRef]);

  return (
    <P5B3FunderShell
      title="Readiness summary"
      description={`Grant ${grantId ?? ""} — released readiness view.`}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transaction reference</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="p5b3-readiness-ref">Reference</Label>
            <Input
              id="p5b3-readiness-ref"
              value={txRef}
              onChange={(e) => setTxRef(e.target.value)}
            />
          </div>
          <Button className="self-end" onClick={() => load(txRef)} disabled={busy || !txRef.trim()}>
            Load
          </Button>
        </CardContent>
      </Card>

      {denial ? <P5B3FunderUnavailable reason={denial.reason} message={denial.message} /> : null}

      {data ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Released readiness state</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <Row
              label="Readiness status (provider-safe)"
              valueNode={<P5B3FunderSafeLabel label={data.provider_safe_status_label} />}
            />
            <Row
              label="Evidence pack"
              value={`v${data.released_evidence_pack_version ?? "—"}${
                data.released_pack_sha256 ? ` (sha256 ${data.released_pack_sha256.slice(0, 12)}…)` : ""
              }`}
            />
            <Row
              label="Provider dependency"
              valueNode={<P5B3FunderSafeLabel label="External Provider Result Pending" />}
            />
            <Row
              label="Finality summary"
              value={
                data.access_grant?.funder_status === "funding_decision_submitted"
                  ? "Awaiting Izenzo admin review — funder decision is not final."
                  : "Not yet at finality."
              }
            />
            <p className="text-xs text-muted-foreground pt-2">
              Funder decisions recorded in this workspace are not, by themselves, a final
              outcome. Finality requires Izenzo admin review.
            </p>
          </CardContent>
        </Card>
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
