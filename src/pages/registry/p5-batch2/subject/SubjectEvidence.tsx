/**
 * P-5 Batch 2 — Stage 5: Director / UBO / invited evidence owner surface.
 *
 * Strictly own-evidence only. The signed-in person sees only their own
 * personal evidence and own resubmission task. No broader company evidence,
 * no funder/admin/internal notes, no unrelated party data.
 *
 * Reads ONLY via fetchP5B2ReadinessSummary (Stage 3 scoped edge function).
 * The only permitted write is p5b2UploadEvidenceVersion.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  fetchP5B2ReadinessSummary,
  type P5B2ReadinessSummary,
} from "@/lib/p5-batch2/summary-client";
import { p5b2UploadEvidenceVersion } from "@/lib/p5-batch2/rpc";
import { ProviderSafeLabel } from "@/pages/admin/p5-batch2/components/ProviderSafeLabel";
import type { P5B2ProviderStatus } from "@/lib/p5-batch2/constants";

export default function SubjectEvidence() {
  const [params] = useSearchParams();
  const itemId = params.get("item") ?? "";
  const [summary, setSummary] = useState<P5B2ReadinessSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!itemId) return;
    fetchP5B2ReadinessSummary({ evidence_item_id: itemId, viewer: "organisation_user" })
      .then((r) => { setSummary(r.data); setErr(r.error); });
  }, [itemId]);

  const safeReason = useMemo(() => summary?.visible_reason || "Manual review required", [summary]);

  return (
    <main className="container mx-auto py-8 max-w-2xl space-y-6" data-testid="subject-evidence-surface">
      <header>
        <h1 className="text-2xl font-semibold">My evidence</h1>
        <p className="text-slate-600 mt-1">
          Upload and track your personal verification documents. You can see
          only the evidence we have asked you for. External verification
          pending until provider is connected.
        </p>
      </header>

      {!itemId && <p className="text-sm text-slate-500">No invited evidence request open.</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}

      {summary && (
        <section data-testid="subject-evidence-card" className="border border-slate-200 rounded p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-500">Status</div>
            <div className="font-medium">{summary.evidence_status}</div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-500">Provider</div>
            <ProviderSafeLabel
              provider_status={(summary.provider_status as P5B2ProviderStatus) || null}
              provider_live={summary.provider_live}
              viewer="organisation_user"
            />
          </div>
          {summary.evidence_status === "rejected" && (
            <div data-testid="subject-rejection-reason" className="text-sm">
              <div className="text-slate-500">Reason</div>
              <div className="font-medium">{safeReason}</div>
            </div>
          )}
          <SubjectResubmit evidenceItemId={itemId} />
        </section>
      )}
    </main>
  );
}

function SubjectResubmit({ evidenceItemId }: { evidenceItemId: string }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  return (
    <button
      type="button"
      className="text-sm rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await p5b2UploadEvidenceVersion({
            evidence_item_id: evidenceItemId,
            file_storage_path: "",
            file_hash: "",
            replacement_reason: "correction",
          });
          setOut(r.ok ? "Submitted for review" : (r.error ?? "Failed"));
        } finally {
          setBusy(false);
        }
      }}
    >
      {out ?? (busy ? "Uploading…" : "Upload / resubmit my evidence")}
    </button>
  );
}
