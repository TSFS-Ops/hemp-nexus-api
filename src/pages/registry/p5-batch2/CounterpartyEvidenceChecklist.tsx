/**
 * P-5 Batch 2 — Stage 5: Organisation / counterparty evidence checklist.
 *
 * Read-only checklist for the signed-in organisation user / counterparty.
 * Consumes ONLY the scoped readiness-summary edge function (via
 * `fetchP5B2ReadinessSummary`). The only permitted write is a resubmission /
 * upload, routed through `p5b2UploadEvidenceVersion` (Stage 4 RPC wrapper).
 *
 * Never reads raw p5_batch2_* tables. Never renders admin-only reviewer notes
 * or fraud / tampering details — suspected-fraud is surfaced server-side as
 * "Manual review required".
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  fetchP5B2ReadinessSummary,
  type P5B2ReadinessSummary,
  type P5B2SummaryViewer,
} from "@/lib/p5-batch2/summary-client";
import { p5b2UploadEvidenceVersion } from "@/lib/p5-batch2/rpc";
import { ProviderSafeLabel } from "@/pages/admin/p5-batch2/components/ProviderSafeLabel";
import type { P5B2ProviderStatus } from "@/lib/p5-batch2/constants";

interface RowState {
  loading: boolean;
  summary: P5B2ReadinessSummary | null;
  error: string | null;
}

export default function CounterpartyEvidenceChecklist() {
  const [params] = useSearchParams();
  // The organisation/counterparty surface receives the list of evidence_item_ids
  // it is permitted to view via a server-side route (Stage 6). For Stage 5 we
  // accept them as query parameters; the edge function enforces RLS.
  const ids = useMemo(
    () => params.getAll("item").filter(Boolean),
    [params],
  );
  const viewer: P5B2SummaryViewer = (params.get("viewer") as P5B2SummaryViewer) || "organisation_user";

  const [rows, setRows] = useState<Record<string, RowState>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const id of ids) {
        setRows((r) => ({ ...r, [id]: { loading: true, summary: null, error: null } }));
        const result = await fetchP5B2ReadinessSummary({ evidence_item_id: id, viewer });
        if (cancelled) return;
        setRows((r) => ({
          ...r,
          [id]: { loading: false, summary: result.data, error: result.error },
        }));
      }
    })();
    return () => { cancelled = true; };
  }, [ids, viewer]);

  const summaries = ids.map((id) => rows[id]?.summary).filter(Boolean) as P5B2ReadinessSummary[];
  const gaps = summaries.filter((s) => s.readiness_impact === "blocking");
  const warnings = summaries.filter((s) => s.readiness_impact === "warning" || s.expiry_warning);
  const rejected = summaries.filter((s) => s.evidence_status === "rejected");

  return (
    <main className="container mx-auto py-8 space-y-8" data-testid="counterparty-evidence-checklist">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Evidence checklist</h1>
        <p className="text-slate-600 mt-1">
          Outstanding items, upload tasks and resubmission requests for your
          organisation. Status, ratings and provider readiness are derived from
          the scoped readiness service.
        </p>
      </header>

      <section data-testid="checklist-readiness-summary" className="grid grid-cols-3 gap-3">
        <div className="border border-slate-200 rounded p-3">
          <div className="text-xs text-slate-500">Blockers</div>
          <div className="text-2xl font-semibold">{gaps.length}</div>
        </div>
        <div className="border border-slate-200 rounded p-3">
          <div className="text-xs text-slate-500">Warnings</div>
          <div className="text-2xl font-semibold">{warnings.length}</div>
        </div>
        <div className="border border-slate-200 rounded p-3">
          <div className="text-xs text-slate-500">Items tracked</div>
          <div className="text-2xl font-semibold">{summaries.length}</div>
        </div>
      </section>

      <section data-testid="checklist-missing-evidence">
        <h2 className="text-lg font-medium mb-2">Missing evidence</h2>
        {gaps.length === 0 ? (
          <p className="text-sm text-slate-500">No outstanding blockers.</p>
        ) : (
          <ul className="space-y-2">
            {gaps.map((g) => (
              <li key={g.record_id + g.evidence_status} className="border border-slate-200 rounded p-3 text-sm">
                <div>Status: {g.evidence_status}</div>
                <div>Next action: {g.next_action}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="checklist-rejected-evidence">
        <h2 className="text-lg font-medium mb-2">Rejected — please resubmit</h2>
        {rejected.length === 0 ? (
          <p className="text-sm text-slate-500">No rejected items.</p>
        ) : (
          <ul className="space-y-2">
            {rejected.map((r) => (
              <li key={"rj-" + r.record_id} className="border border-slate-200 rounded p-3 text-sm space-y-1">
                <div className="font-medium">Reason: {r.visible_reason || "Manual review required"}</div>
                <ProviderSafeLabel
                  provider_status={(r.provider_status as P5B2ProviderStatus) || null}
                  provider_live={r.provider_live}
                  viewer={viewer === "counterparty" ? "counterparty" : "organisation_user"}
                />
                <ResubmitButton evidenceItemId={r.record_id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="checklist-expiry-warnings">
        <h2 className="text-lg font-medium mb-2">Expiring soon</h2>
        {warnings.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing expiring within 30 days.</p>
        ) : (
          <ul className="space-y-2">
            {warnings.map((w) => (
              <li key={"w-" + w.record_id} className="border border-slate-200 rounded p-3 text-sm">
                Expires: {w.expires_at || "—"}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="checklist-provider-dependent" className="text-sm text-slate-600">
        External verification pending — provider may not yet be connected. We
        never describe a check as live or provider-approved until real provider
        results exist.
      </section>
    </main>
  );
}

function ResubmitButton({ evidenceItemId }: { evidenceItemId: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  return (
    <button
      type="button"
      className="text-sm rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          // In real flow, file_storage_path/hash come from an upload widget.
          const r = await p5b2UploadEvidenceVersion({
            evidence_item_id: evidenceItemId,
            file_storage_path: "",
            file_hash: "",
            replacement_reason: "correction",
          });
          setDone(r.ok ? "Submitted for review" : (r.error ?? "Failed"));
        } finally {
          setBusy(false);
        }
      }}
    >
      {done ?? (busy ? "Submitting…" : "Resubmit evidence")}
    </button>
  );
}
