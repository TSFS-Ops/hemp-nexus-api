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
    <div className="max-w-6xl mx-auto p-6 space-y-4" data-testid="fw-funder-shell">
      <div className="rounded-md border border-border bg-card px-4 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Funder organisation
          </div>
          <div className="text-sm font-semibold text-foreground truncate">
            {ctx.organisation.name}
          </div>
        </div>
        <div className="text-xs text-muted-foreground text-right shrink-0">
          <div className="truncate max-w-[220px]">{ctx.email}</div>
          <div>{funderRoleLabel(ctx.role)}</div>
        </div>
      </div>
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
    </div>
  );
}
