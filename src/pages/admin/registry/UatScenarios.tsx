/**
 * Batch 18 — Read-only UAT scenarios viewer.
 *
 * Renders the SSOT end-to-end scenario pack so platform admins can walk
 * through each step without external notifications or production
 * provider integrations being triggered.
 */
import { UAT_SCENARIOS, DEMO_DATA_WARNING_COPY } from "@/lib/registry-release-gate-ssot";
import { BackButton } from "@/components/BackButton";

export default function UatScenariosPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <BackButton />
      <h1 className="text-2xl font-semibold">Registry UAT Scenarios</h1>
      <div className="rounded border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2 text-sm">
        {DEMO_DATA_WARNING_COPY}
      </div>
      <ol className="space-y-3">
        {UAT_SCENARIOS.map((s, i) => (
          <li key={s.id} className="border rounded p-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <div className="font-medium">
                {i + 1}. {s.title}
              </div>
              <div className="font-mono text-xs text-muted-foreground">{s.id}</div>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-2 text-xs">
              <div><span className="text-muted-foreground">Role:</span> {s.role}</div>
              <div><span className="text-muted-foreground">Route/function:</span> <span className="font-mono">{s.routeOrFunction}</span></div>
              <div><span className="text-muted-foreground">Starting state:</span> {s.startingState}</div>
              <div><span className="text-muted-foreground">Expected:</span> {s.expected}</div>
              <div className="sm:col-span-2"><span className="text-muted-foreground">Steps:</span> {s.steps.join(" → ")}</div>
              <div className="sm:col-span-2"><span className="text-muted-foreground">Safety rules:</span> {s.safetyRules.join(", ")}</div>
              <div className="sm:col-span-2"><span className="text-muted-foreground">Evidence:</span> <span className="font-mono">{s.evidenceRef}</span></div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
