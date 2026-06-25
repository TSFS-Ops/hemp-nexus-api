/**
 * P-5 Batch 3 — Stage 5 funder dashboard.
 *
 * Lists only the funder's own active/recent grants, grouped by funder
 * status. The dashboard does not read from p5_batch3_* tables directly:
 * each row is rendered from a safe summary fetched per known transaction
 * reference. Until a backend "list my grants" surface exists, the funder
 * pastes/selects a transaction reference to open a grant. This keeps
 * Stage 5 strictly read-only over the existing Stage 3 edge function.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchFunderSummary, type P5B3FunderSummaryResponse } from "@/lib/p5-batch3/summary-client";
import { P5B3FunderShell } from "./components/P5B3FunderShell";
import { P5B3FunderSafeLabel } from "./components/P5B3FunderSafeLabel";
import { P5B3FunderUnavailable } from "./components/P5B3FunderUnavailable";

interface Row {
  grantId: string;
  transaction_reference: string;
  summary: P5B3FunderSummaryResponse;
}

const GROUPS = [
  { key: "active_opportunities", title: "Active Opportunities" },
  { key: "awaiting_review", title: "Awaiting Funder Review" },
  { key: "more_info", title: "More Information Requested" },
  { key: "interested", title: "Interested / Credit Review" },
  { key: "declined", title: "Declined / Exited" },
  { key: "completed", title: "Completed / Finality Reached" },
  { key: "expiring", title: "Access Expiring Soon" },
] as const;

function classify(row: Row): typeof GROUPS[number]["key"] {
  const g = row.summary.access_grant;
  if (!g) return "awaiting_review";
  if (g.status !== "active") return "declined";
  const expSoon =
    new Date(g.expiry_at).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000;
  if (expSoon) return "expiring";
  const s = g.funder_status;
  if (s === "declined" || s === "exited") return "declined";
  if (
    s === "interested" ||
    s === "credit_review_pending" ||
    s === "conditional_support"
  )
    return "interested";
  if (s === "funding_decision_submitted") return "completed";
  if (s === "in_progress") return "more_info";
  return "active_opportunities";
}

export default function P5Batch3FunderIndex() {
  const [txRef, setTxRef] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [denial, setDenial] = useState<{ reason?: string; message?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const k = classify(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return map;
  }, [rows]);

  const open = async () => {
    if (!txRef.trim()) return;
    setBusy(true);
    setDenial(null);
    try {
      const res = await fetchFunderSummary({ transaction_reference: txRef.trim() });
      if (!res.ok) {
        setDenial({ reason: res.denial.reason, message: res.denial.error });
        return;
      }
      const g = res.data.access_grant;
      if (!g) {
        setDenial({ reason: "no_active_grant" });
        return;
      }
      setRows((prev) => {
        const next = prev.filter((p) => p.grantId !== g.id);
        next.unshift({ grantId: g.id, transaction_reference: g.transaction_reference, summary: res.data });
        return next;
      });
      setTxRef("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <P5B3FunderShell
      title="Funder workspace"
      description="Your authorised opportunities, grouped by status. Only items Izenzo has released to your account appear here."
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open a released transaction</CardTitle>
          <CardDescription>
            Enter the transaction reference Izenzo shared with you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="p5b3-funder-txref">Transaction reference</Label>
          <div className="flex gap-2">
            <Input
              id="p5b3-funder-txref"
              value={txRef}
              onChange={(e) => setTxRef(e.target.value)}
              placeholder="e.g. IZN-2026-00042"
            />
            <Button onClick={open} disabled={busy || !txRef.trim()}>
              Open
            </Button>
          </div>
        </CardContent>
      </Card>

      {denial ? (
        <P5B3FunderUnavailable reason={denial.reason} message={denial.message} />
      ) : null}

      {GROUPS.map((g) => {
        const items = grouped.get(g.key) ?? [];
        if (items.length === 0) return null;
        return (
          <Card key={g.key}>
            <CardHeader>
              <CardTitle className="text-base">{g.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((r) => (
                <Link
                  key={r.grantId}
                  to={`/funder/p5-batch3/opportunities/${r.grantId}`}
                  state={{ transaction_reference: r.transaction_reference }}
                  className="block rounded-md border p-3 hover:border-foreground"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="font-medium">
                      {r.summary.counterparty_display_name ?? "—"}
                    </div>
                    <div className="text-muted-foreground">
                      {r.transaction_reference}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {r.summary.jurisdiction_summary ?? ""} • pack v
                    {r.summary.released_evidence_pack_version ?? "—"} • status:{" "}
                    <P5B3FunderSafeLabel label={r.summary.provider_safe_status_label} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Access expires{" "}
                    {r.summary.access_grant
                      ? new Date(r.summary.access_grant.expiry_at).toLocaleString()
                      : "—"}
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        );
      })}

      {rows.length === 0 && !denial ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground text-center">
            No opportunities open yet. Use the field above to load one Izenzo has released to you.
          </CardContent>
        </Card>
      ) : null}
    </P5B3FunderShell>
  );
}
