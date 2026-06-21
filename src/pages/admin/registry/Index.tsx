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
      <div className="flex gap-2 border-b border-border mb-4 flex-wrap">
        <Link to="/admin/registry/readiness" className={tabClass(loc.pathname.includes("readiness"))}>
          Readiness
        </Link>
        <Link to="/admin/registry/decisions" className={tabClass(loc.pathname.includes("decisions"))}>
          Decisions
        </Link>
        <Link to="/admin/registry/provenance" className={tabClass(loc.pathname.includes("provenance"))}>
          Provenance
        </Link>
        <Link to="/admin/registry/coverage" className={tabClass(loc.pathname.includes("coverage"))}>
          Country coverage
        </Link>
        <Link to="/admin/registry/imports" className={tabClass(loc.pathname.includes("imports"))}>
          Import batches
        </Link>
        <Link to="/admin/registry/claims" className={tabClass(loc.pathname.includes("claims"))}>
          Claims
        </Link>
        <Link to="/admin/registry/authority" className={tabClass(loc.pathname.includes("authority"))}>
          Authority
        </Link>
        <Link to="/admin/registry/bank-details" className={tabClass(loc.pathname.includes("bank-details"))}>
          Bank details
        </Link>
        <Link to="/admin/registry/api" className={tabClass(loc.pathname.includes("/api"))}>
          API management
        </Link>
        <Link to="/admin/registry/operations" className={tabClass(loc.pathname.includes("operations"))}>
          Operations
        </Link>
        <Link to="/admin/registry/outreach-drafts" className={tabClass(loc.pathname.includes("outreach-drafts"))}>
          Outreach drafts
        </Link>
        <Link to="/admin/registry/outreach-approvals" className={tabClass(loc.pathname.includes("outreach-approvals"))}>
          Outreach approvals
        </Link>
        <Link to="/admin/registry/do-not-contact" className={tabClass(loc.pathname.includes("do-not-contact"))}>
          Do not contact
        </Link>
        <Link to="/admin/registry/new-company-requests" className={tabClass(loc.pathname.includes("new-company-requests"))}>
          New-company requests
        </Link>
        <Link to="/admin/registry/correction-requests" className={tabClass(loc.pathname.includes("correction-requests"))}>
          Correction requests
        </Link>
        <Link to="/admin/registry/claim-conflicts" className={tabClass(loc.pathname.includes("claim-conflicts"))}>
          Claim conflicts
        </Link>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Other tabs</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Company claims, authority reviews, bank-detail submissions,
            provider readiness, API usage, outreach queue, disputes and stale
            records will appear in later batches.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
