/**
 * Institutional Funder Evidence Workspace — Batch 2
 * Admin landing page. Platform-admin guarded at the route layer.
 * Read-only summary cards + navigation into the console sub-pages.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchAdminCounters,
  type FunderWorkspaceAdminCounters,
} from "@/lib/funder-workspace/admin-client";

const SECTIONS = [
  { title: "Onboarding requests", to: "/admin/funder-workspace/onboarding", description: "Review, approve or reject funder onboarding requests." },
  { title: "Funder organisations", to: "/admin/funder-workspace/organisations", description: "Approved funder organisations and their contact details." },
  { title: "Deal releases", to: "/admin/funder-workspace/releases", description: "Evidence packs released to funders, expiry and revocation." },
  { title: "New deal release", to: "/admin/funder-workspace/releases/new", description: "Release a deal / evidence pack to an approved funder organisation." },
  { title: "Audit & usage", to: "/admin/funder-workspace/audit", description: "Read-only audit trail and non-financial usage events." },
  { title: "Controlled pilot console", to: "/admin/funder-workspace/pilot", description: "Prepare fake pilot logins and step-by-step guide for a non-technical manual test." },
] as const;

export default function FunderWorkspaceAdminIndex() {
  const [counts, setCounts] = useState<FunderWorkspaceAdminCounters | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAdminCounters()
      .then((c) => {
        if (!cancelled) setCounts(c);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = [
    { label: "Pending onboarding", value: counts?.pending_onboarding },
    { label: "Approved organisations", value: counts?.approved_orgs },
    { label: "Active releases", value: counts?.active_releases },
    { label: "Expiring within 14 days", value: counts?.expiring_soon },
    { label: "Revoked releases", value: counts?.revoked_releases },
    { label: "Sealed packs generated", value: counts?.packs_generated },
    { label: "Pack downloads", value: counts?.pack_downloads },
    { label: "Open RFIs", value: counts?.open_rfis },
    { label: "Decisions recorded", value: counts?.decisions_recorded },
  ];


  return (
    <div className="p-6 space-y-6" data-testid="fw-admin-index">
      <div>
        <h1 className="text-2xl font-semibold">Institutional Funder Evidence Workspace</h1>
        <p className="text-sm text-muted-foreground">
          Funder Workspace V1 — admin console. All actions here are recorded to the funder audit ledger and non-financial usage log.
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">Failed to load summary: {error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardDescription>{c.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{c.value ?? "—"}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {SECTIONS.map((s) => (
          <Link to={s.to} key={s.title} className="block">
            <Card className="h-full hover:border-foreground transition-colors">
              <CardHeader>
                <CardTitle className="text-base">{s.title}</CardTitle>
                <CardDescription>{s.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
