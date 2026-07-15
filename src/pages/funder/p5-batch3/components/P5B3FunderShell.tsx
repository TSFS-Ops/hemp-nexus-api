/**
 * P-5 Batch 3 — Stage 5 funder shell.
 *
 * Wraps all /funder/p5-batch3/* pages with a consistent header and a
 * release-only disclaimer. Funder surfaces show only admin-released data.
 */
import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LegacyBanner } from "@/lib/funder-workspace/ui";

export function P5B3FunderShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <LegacyBanner surface="P-5 Batch 3 funder workflow" />
      <Link to="/funder/workspace" className="text-sm text-muted-foreground underline">
        ← Funder Workspace
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        ) : null}
      </div>
      <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        Released for authorised funder review only. Information shown here has been
        approved for release by Izenzo. Requests are admin-moderated. Funder decisions
        recorded here are not final and do not affect other funders.
      </div>
      {children}
    </div>
  );
}

