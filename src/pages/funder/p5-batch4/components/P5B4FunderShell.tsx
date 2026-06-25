/**
 * P-5 Batch 4 Stage 6 — funder shell.
 *
 * Wraps every /funder/p5-batch4/* page with a consistent header and a
 * release-only disclaimer. The funder surface only ever shows
 * admin-released data scoped to the funder's organisation.
 */
import { ReactNode } from "react";
import { Link } from "react-router-dom";

export function P5B4FunderShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="p-6 space-y-4 max-w-5xl" data-testid="p5b4-funder-shell">
      <Link to="/funder/p5-batch4" className="text-sm text-muted-foreground underline">
        ← Funder workspace
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        ) : null}
      </div>
      <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        Released for authorised funder review only. Information shown here has been
        approved for release by Izenzo and is limited to your organisation. Decisions
        recorded here are not platform-final and do not affect other funders.
      </div>
      {children}
    </div>
  );
}
