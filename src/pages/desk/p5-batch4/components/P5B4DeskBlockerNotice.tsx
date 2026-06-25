/**
 * P-5 Batch 4 Stage 5 — blocker notice for the org-user surface.
 *
 * Renders the **external-safe** blocker label only. Internal detail
 * and the raw blocker_key / blocker_type are admin-only and are never
 * received by this surface (the edge function strips them).
 */
import { P5B4DeskStatusBadge } from "./P5B4DeskStatusBadge";
import { scanForbidden, P5B4_PROVIDER_DEPENDENT_SAFE_LABEL } from "@/lib/p5-batch4/wording-guard";
import type { P5B4OrgUserBlockerNotice } from "@/lib/p5-batch4/org-user-client";

export interface P5B4DeskBlockerNoticeProps {
  blockers: P5B4OrgUserBlockerNotice[];
}

function safe(label: string): string {
  return scanForbidden(label).ok ? label : P5B4_PROVIDER_DEPENDENT_SAFE_LABEL;
}

export function P5B4DeskBlockerNotice({ blockers }: P5B4DeskBlockerNoticeProps) {
  if (blockers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="p5b4-desk-blockers-empty">
        No active items requiring your attention.
      </p>
    );
  }
  const active = blockers.filter(
    (b) => b.blocker_status === "open" || b.blocker_status === "escalated",
  );
  if (active.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="p5b4-desk-blockers-empty">
        All previously raised items are now resolved.
      </p>
    );
  }
  return (
    <ul
      className="divide-y divide-border rounded-md border border-border bg-card"
      data-testid="p5b4-desk-blockers"
    >
      {active.map((b) => (
        <li
          key={b.id}
          className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
          data-testid="p5b4-desk-blocker-row"
        >
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">{safe(b.blocker_name)}</span>
            <span className="text-xs text-muted-foreground">
              {safe(b.external_safe_label)}
            </span>
          </div>
          <P5B4DeskStatusBadge kind="blocker" value={b.blocker_status} />
        </li>
      ))}
    </ul>
  );
}
