/**
 * Batch 18 — Read-only Demo Pack viewer.
 *
 * Surfaces the SSOT demo data set so reviewers can see exactly which
 * records are labelled demo/UAT. No production buttons. No raw bank
 * fields. Demo bank values referenced in notes are fake and explicitly
 * labelled.
 */
import {
  DEMO_RECORDS,
  DEMO_DATA_WARNING_COPY,
} from "@/lib/registry-release-gate-ssot";
import { BackButton } from "@/components/BackButton";

export default function DemoPackPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <BackButton />
      <h1 className="text-2xl font-semibold">Registry Demo / UAT Pack</h1>
      <div className="rounded border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2 text-sm">
        {DEMO_DATA_WARNING_COPY}
      </div>
      <div className="overflow-x-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2 text-left">Demo ID</th>
              <th className="px-3 py-2 text-left">Label</th>
              <th className="px-3 py-2 text-left">Kind</th>
              <th className="px-3 py-2 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            {DEMO_RECORDS.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                <td className="px-3 py-2">{r.label}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.kind}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
