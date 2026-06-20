/**
 * Batch 1 — Admin registry area shell. Tabs: Readiness (M019), Decisions (M018).
 */
import { Link, useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";

export default function AdminRegistryIndex() {
  const loc = useLocation();
  const tabClass = (active: boolean) =>
    `px-3 py-2 text-sm border-b-2 ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`;

  return (
    <main className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Registry administration</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M015" />
      <div className="flex gap-2 border-b border-border mb-4">
        <Link to="/admin/registry/readiness" className={tabClass(loc.pathname.includes("readiness"))}>
          Readiness
        </Link>
        <Link to="/admin/registry/decisions" className={tabClass(loc.pathname.includes("decisions"))}>
          Decisions
        </Link>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Other tabs</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Import batches, country coverage, company claims, authority reviews,
            bank-detail submissions, provider readiness, API usage, outreach queue,
            disputes and stale records will appear in later batches.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
