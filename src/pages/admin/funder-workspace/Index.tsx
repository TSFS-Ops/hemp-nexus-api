/**
 * Institutional Funder Evidence Workspace — Batch 2
 * Admin landing page. Platform-admin guarded at the route layer.
 * Read-only summary cards + navigation into the console sub-pages.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  listFunderOrganisations,
  listOnboardingRequests,
  listReleases,
  listUsageEvents,
} from "@/lib/funder-workspace/admin-client";

const SECTIONS = [
  { title: "Onboarding requests", to: "/admin/funder-workspace/onboarding", description: "Review, approve or reject funder onboarding requests." },
  { title: "Funder organisations", to: "/admin/funder-workspace/organisations", description: "Approved funder organisations and their contact details." },
  { title: "Deal releases", to: "/admin/funder-workspace/releases", description: "Evidence packs released to funders, expiry and revocation." },
  { title: "New deal release", to: "/admin/funder-workspace/releases/new", description: "Release a deal / evidence pack to an approved funder organisation." },
  { title: "Audit & usage", to: "/admin/funder-workspace/audit", description: "Read-only audit trail and non-financial usage events." },
] as const;

function within(days: number, iso: string | null): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t > now && t - now < days * 24 * 60 * 60 * 1000;
}

export default function FunderWorkspaceAdminIndex() {
  const [counts, setCounts] = useState<{
    pending: number | null;
    approvedOrgs: number | null;
    activeReleases: number | null;
    expiringSoon: number | null;
    revoked: number | null;
    recentUsage: number | null;
  }>({ pending: null, approvedOrgs: null, activeReleases: null, expiringSoon: null, revoked: null, recentUsage: null });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ob, orgs, rels, usage] = await Promise.all([
          listOnboardingRequests(),
          listFunderOrganisations(),
          listReleases(),
          listUsageEvents({ limit: 100 }),
        ]);
        if (cancelled) return;
        setCounts({
          pending: ob.filter((r) => r.status === "submitted" || r.status === "under_review").length,
          approvedOrgs: orgs.filter((o) => o.approval_status === "approved" || o.approval_status === "admin_created" || o.approval_status === null).filter((o) => o.status === "active").length,
          activeReleases: rels.filter((r) => r.release_status === "active").length,
          expiringSoon: rels.filter((r) => r.release_status === "active" && within(14, r.expires_at)).length,
          revoked: rels.filter((r) => r.release_status === "revoked").length,
          recentUsage: usage.length,
        });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = [
    { label: "Pending onboarding", value: counts.pending },
    { label: "Approved organisations", value: counts.approvedOrgs },
    { label: "Active releases", value: counts.activeReleases },
    { label: "Expiring within 14 days", value: counts.expiringSoon },
    { label: "Revoked releases", value: counts.revoked },
    { label: "Recent usage events", value: counts.recentUsage },
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
