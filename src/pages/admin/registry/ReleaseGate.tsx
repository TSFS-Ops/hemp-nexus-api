/**
 * Batch 18 — Read-only Release Gate matrix view.
 *
 * Renders the per-module release-gate matrix from the Batch 18 SSOT.
 * - Always shows the demo/UAT warning copy.
 * - Never renders forbidden readiness wording (SSOT enforces).
 * - No production-enable buttons.
 */
import { Link } from "react-router-dom";
import {
  RELEASE_GATE_MATRIX,
  DEFAULT_FINAL_RELEASE_STATUS,
  DEMO_DATA_WARNING_COPY,
  computeFinalReleaseStatus,
} from "@/lib/registry-release-gate-ssot";
import { BackButton } from "@/components/BackButton";

export default function ReleaseGatePage() {
  const finalStatus = computeFinalReleaseStatus();
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <BackButton />
      <h1 className="text-2xl font-semibold">Registry Release Gate</h1>
      <div className="rounded border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2 text-sm">
        {DEMO_DATA_WARNING_COPY}
      </div>
      <div className="rounded border px-4 py-2 text-sm">
        Final release status:{" "}
        <span className="font-mono">{finalStatus}</span>{" "}
        <span className="text-muted-foreground">
          (default never `production_ready`; current default ={" "}
          <span className="font-mono">{DEFAULT_FINAL_RELEASE_STATUS}</span>)
        </span>
      </div>
      <div className="overflow-x-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2 text-left">Module</th>
              <th className="px-3 py-2 text-left">Batches</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Blocker</th>
              <th className="px-3 py-2 text-left">Owner</th>
              <th className="px-3 py-2 text-left">Last checked</th>
              <th className="px-3 py-2 text-left">Next action</th>
              <th className="px-3 py-2 text-left">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {RELEASE_GATE_MATRIX.map((r) => (
              <tr key={r.key} className="border-t">
                <td className="px-3 py-2 font-medium">{r.label}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.batches.join(", ")}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.status}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.blocker ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{r.owner}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.lastChecked}</td>
                <td className="px-3 py-2 text-xs">{r.nextAction}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.evidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-muted-foreground">
        See also:{" "}
        <Link className="underline" to="/admin/registry/demo-pack">
          Demo pack
        </Link>{" "}
        ·{" "}
        <Link className="underline" to="/admin/registry/uat-scenarios">
          UAT scenarios
        </Link>
      </div>
    </div>
  );
}
