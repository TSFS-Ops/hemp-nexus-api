/**
 * Batch 3 — Funder workspace shell.
 * Loads the current funder context once and exposes it to child pages
 * via render prop. Shows an unavailable state when the current user is
 * not a funder-org member.
 */
import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import {
  getCurrentFunderContext,
  type CurrentFunderContext,
} from "@/lib/funder-workspace/funder-client";
import { funderRoleLabel } from "@/lib/funder-workspace/funder-permissions";

interface Props {
  title: string;
  description?: string;
  children: (ctx: CurrentFunderContext) => ReactNode;
}

const NAV: Array<{ href: string; label: string }> = [
  { href: "/funder/workspace", label: "Dashboard" },
  { href: "/funder/workspace/deals", label: "Deals" },
  { href: "/funder/workspace/activity", label: "Activity" },
  { href: "/funder/workspace/profile", label: "Profile" },
];

export function FunderWorkspaceShell({ title, description, children }: Props) {
  const [ctx, setCtx] = useState<CurrentFunderContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    getCurrentFunderContext()
      .then((c) => alive && setCtx(c))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <FullPageLoader />;

  if (error || !ctx) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardContent className="pt-6 space-y-2">
            <h1 className="text-xl font-semibold">Funder workspace unavailable</h1>
            <p className="text-sm text-muted-foreground">
              Your account is not associated with an approved funder organisation.
              If you believe this is incorrect, please contact Izenzo support.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="fw-funder-shell">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">
              Funder workspace
            </div>
            <div className="text-lg font-semibold">{ctx.organisation.name}</div>
          </div>
          <div className="text-xs text-muted-foreground text-right">
            <div>{ctx.email}</div>
            <div>{funderRoleLabel(ctx.role)}</div>
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-6 flex gap-4 text-sm">
          {NAV.map((n) => {
            const active = location.pathname === n.href ||
              (n.href !== "/funder/workspace" && location.pathname.startsWith(n.href));
            return (
              <Link
                key={n.href}
                to={n.href}
                className={
                  "py-3 border-b-2 " +
                  (active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground")
                }
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="max-w-6xl mx-auto p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          Released for authorised funder review only. Information shown here has
          been approved for release by Izenzo. Decisions recorded elsewhere do not
          affect other funders.
        </div>
        {children(ctx)}
      </main>
    </div>
  );
}
