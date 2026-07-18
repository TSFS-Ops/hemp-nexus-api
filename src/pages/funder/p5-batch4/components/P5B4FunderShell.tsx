/**
 * P-5 Batch 4 Stage 6 — funder shell.
 *
 * Content-level wrapper used inside the persona-scoped FunderShell. Provides
 * only the batch-specific title, description and release disclaimer; the app
 * chrome is supplied by FunderShell so funders navigate every batch in one
 * consistent shell.
 */
import { ReactNode } from "react";
import { LegacyBanner } from "@/lib/funder-workspace/ui";

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
      <LegacyBanner surface="P-5 Batch 4 execution" />
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        ) : null}
      </div>
      <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        Released for authorised funder review only. Information shown here has
        been approved for release by Izenzo and is limited to your organisation.
        Decisions recorded here are not platform-final and do not affect other
        funders.
      </div>
      {children}
    </div>
  );
}
