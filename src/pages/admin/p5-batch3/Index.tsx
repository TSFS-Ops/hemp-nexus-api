/**
 * P-5 Batch 3 — Stage 4 admin landing page.
 *
 * Navigation hub for funder-workflow admin surfaces. All linked pages are
 * platform-admin guarded at the route layer.
 */
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SECTIONS = [
  {
    title: "Funder Organisations",
    to: "/admin/p5-batch3/organisations",
    description: "Manage funder organisations and their named users.",
  },
  {
    title: "Funder Users",
    to: "/admin/p5-batch3/organisations",
    description: "Invite, assign roles, activate or deactivate named funder users.",
  },
  {
    title: "Release to Funder",
    to: "/admin/p5-batch3/release",
    description: "Grant a named user access to a specific evidence pack version with expiry.",
  },
  {
    title: "Funder Requests",
    to: "/admin/p5-batch3/requests",
    description: "Triage funder requests; edit external wording; approve, reject, assign or close.",
  },
  {
    title: "Funder Outcomes",
    to: "/admin/p5-batch3/requests",
    description: "Review funder-submitted outcomes before any finality impact is considered.",
  },
  {
    title: "Multi-Funder Overview",
    to: "/admin/p5-batch3/requests",
    description: "See per-funder status side by side. One funder's view does not affect another.",
  },
  {
    title: "Audit & Downloads",
    to: "/admin/p5-batch3/audit",
    description: "Read-only audit trail and document download history.",
  },
] as const;

export default function P5Batch3AdminIndex() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Funder Workflow — Admin</h1>
        <p className="text-sm text-muted-foreground">
          Funder access is manual and granted only by platform admin. Funder roles do not
          inherit any internal admin, operator or compliance permissions.
        </p>
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
