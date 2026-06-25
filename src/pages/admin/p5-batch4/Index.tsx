/**
 * P-5 Batch 4 Stage 4 — admin landing page.
 *
 * Navigation hub for the execution-engine admin surfaces. All linked
 * pages are platform-admin guarded at the route layer.
 */
import { Link } from "react-router-dom";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SECTIONS = [
  {
    title: "Execution Cases",
    to: "/admin/p5-batch4/cases",
    description: "List, open and triage onboarding / transaction / project / funder-release cases.",
  },
  {
    title: "Audit Trail",
    to: "/admin/p5-batch4/audit",
    description: "Read-only append-only audit events across Batch 4 cases.",
  },
] as const;

export default function P5Batch4AdminIndex() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Execution Engine — Admin</h1>
        <p className="text-sm text-muted-foreground">
          Platform-admin-only execution control plane. All mutations are reasoned and audited.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((s) => (
          <Link to={s.to} key={s.title} className="block">
            <Card className="h-full transition-colors hover:border-foreground">
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
