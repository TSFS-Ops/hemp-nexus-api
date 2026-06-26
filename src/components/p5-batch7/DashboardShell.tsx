/**
 * P-5 Batch 7 — Phase 4
 * Shared read-only dashboard shell components.
 *
 * IMPORTANT:
 *   - All data wiring goes through the Phase 3 API v1 projection helpers
 *     (`@/lib/p5-batch7/api-v1`) or safe Batch 4/5/6 projections.
 *   - No direct UI reads from raw `p5b7_*` tables (enforced by Phase 4 guard).
 *   - No write mutations, exports or cron triggers are exposed here.
 *   - Sensitive fields are always masked unless explicitly revealed via
 *     a future Phase 5 RPC, recorded as `p5b7.sensitive_field.revealed`.
 *   - Wording is constrained by the Phase 1 approved/banned wording lists.
 */
import { ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  P5_BATCH7_DASHBOARD_DEFINITIONS,
  P5_BATCH7_STALE_THRESHOLDS,
  type P5Batch7Dashboard,
} from "@/lib/p5-batch7/registry";

// ────────────────────────────────────────────────────────────────────────────
// Shell
// ────────────────────────────────────────────────────────────────────────────

export interface P5B7DashboardShellProps {
  dashboard: P5Batch7Dashboard;
  /** Optional subtitle shown beneath the dashboard label. */
  subtitle?: string;
  /** Optional back link target. */
  backHref?: string;
  backLabel?: string;
  /** Optional disclaimer/banner content rendered above the body. */
  banner?: ReactNode;
  children: ReactNode;
}

export function P5B7DashboardShell({
  dashboard,
  subtitle,
  backHref,
  backLabel,
  banner,
  children,
}: P5B7DashboardShellProps) {
  const def = P5_BATCH7_DASHBOARD_DEFINITIONS[dashboard];
  return (
    <div className="p-6 space-y-4 max-w-6xl" data-p5b7-dashboard={dashboard}>
      {backHref ? (
        <Link to={backHref} className="text-sm text-muted-foreground underline">
          ← {backLabel ?? "Back"}
        </Link>
      ) : null}
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{def.label}</h1>
        <p className="text-sm text-muted-foreground">{subtitle ?? def.description}</p>
      </header>
      {banner}
      <div className="space-y-4">{children}</div>
      <p className="text-xs text-muted-foreground pt-4">
        Read-only view. Information shown is approved for this surface and is
        derived from the v1 API projection. Reviewer-only commentary, raw provider payloads
        and other internal artefacts are never displayed here.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Summary cards
// ────────────────────────────────────────────────────────────────────────────

export interface P5B7SummaryCard {
  label: string;
  value: string | number;
  hint?: string;
}

export function P5B7SummaryCards({ cards }: { cards: ReadonlyArray<P5B7SummaryCard> }) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {c.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{c.value}</div>
            {c.hint ? (
              <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Filter bar
// ────────────────────────────────────────────────────────────────────────────

export interface P5B7FilterBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  placeholder?: string;
  rightSlot?: ReactNode;
}

export function P5B7FilterBar({
  query,
  onQueryChange,
  placeholder,
  rightSlot,
}: P5B7FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={placeholder ?? "Filter…"}
        className="max-w-xs"
      />
      <div className="flex-1" />
      {rightSlot}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Saved-view selector (Phase 4 = read-only stub; persistence wired in Phase 5)
// ────────────────────────────────────────────────────────────────────────────

export interface P5B7SavedViewOption {
  view_id: string;
  name: string;
}

export function P5B7SavedViewSelector({
  views,
  value,
  onChange,
  disabled,
}: {
  views: ReadonlyArray<P5B7SavedViewOption>;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value ?? "__none__"}
      onValueChange={(v) => onChange(v === "__none__" ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger className="w-[220px]">
        <SelectValue placeholder="Saved views" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">No saved view</SelectItem>
        {views.map((v) => (
          <SelectItem key={v.view_id} value={v.view_id}>
            {v.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Detail-section frame
// ────────────────────────────────────────────────────────────────────────────

export function P5B7DetailSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Stale-data banner
// ────────────────────────────────────────────────────────────────────────────

export function P5B7StaleDataBanner({
  dashboard,
  asOf,
  isStale,
}: {
  dashboard: P5Batch7Dashboard;
  asOf: string | null;
  isStale: boolean;
}) {
  const threshold = useMemo(
    () => P5_BATCH7_STALE_THRESHOLDS.find((t) => t.surface === dashboard),
    [dashboard],
  );
  if (!isStale && asOf) return null;
  return (
    <div className="rounded-md border bg-amber-50 text-amber-900 px-3 py-2 text-xs">
      {asOf
        ? "Data temporarily unavailable — showing the most recent available snapshot."
        : "Awaiting provider response — no fresh data available for this surface."}
      {threshold ? (
        <span className="ml-1 text-amber-800/80">
          (warn at {threshold.warn_after_seconds}s, fail at {threshold.fail_after_seconds}s)
        </span>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Empty / loading / error states
// ────────────────────────────────────────────────────────────────────────────

export function P5B7Loading({ label }: { label?: string }) {
  return (
    <div className="rounded-md border px-3 py-6 text-sm text-muted-foreground text-center">
      {label ?? "Loading…"}
    </div>
  );
}

export function P5B7Empty({ label }: { label?: string }) {
  return (
    <div className="rounded-md border px-3 py-6 text-sm text-muted-foreground text-center">
      {label ?? "No records to show."}
    </div>
  );
}

export function P5B7ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-900">
      Data temporarily unavailable. {message}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Sensitive-field masked renderer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Renders a sensitive value as a masked placeholder. Reveal is intentionally
 * NOT exposed in Phase 4 — wiring requires a Phase 5 SECURITY DEFINER RPC
 * that records a `p5b7.sensitive_field.revealed` audit event.
 */
export function P5B7SensitiveField({
  label,
  value,
  masked = true,
}: {
  label: string;
  value: string | null | undefined;
  masked?: boolean;
}) {
  const [shown] = useState(false); // reveal not wired in Phase 4
  const display = !masked || shown ? value ?? "—" : value ? "••••••••" : "—";
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className="font-mono"
        data-p5b7-sensitive={masked ? "true" : "false"}
        aria-label={masked ? `${label} (masked)` : label}
      >
        {display}
      </span>
    </div>
  );
}
