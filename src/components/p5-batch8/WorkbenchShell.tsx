/**
 * P-5 Batch 8 — Phase 5 UI shell components.
 *
 * Read-only presentational pieces. No data fetching here; data is loaded by
 * the page via @/lib/p5-batch8/api and passed in.
 *
 * Wording is constrained by the Phase 1 SSOT banned-wording list — only
 * the dependency-status and decision-state strings are rendered verbatim
 * from the projection; no external verdict is synthesised here.
 */
import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function P5B8PageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="p-6 space-y-6 max-w-6xl" data-p5b8-surface="workbench">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </header>
      <P5B8ProviderReadyDisclaimer />
      {children}
    </div>
  );
}

/**
 * Explicit, mandatory disclaimer rendered on every Batch 8 admin surface.
 * Locks in the "provider-ready is not provider-verified" distinction.
 */
export function P5B8ProviderReadyDisclaimer() {
  return (
    <div
      role="note"
      className="rounded-md border border-border bg-muted/40 p-3 text-sm"
      data-p5b8-disclaimer="provider-ready-vs-verified"
    >
      <strong>Provider-ready is not provider-verified.</strong>{" "}
      Izenzo has prepared data fields, screens, audit logging, decision states,
      exception handling, webhook readiness and API-safe status reporting for
      these provider categories. No live provider result is recorded until the
      dependency status reads <code>live_result_received</code> and a recorded
      decision is shown below.
    </div>
  );
}

export function P5B8SectionCard({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function P5B8Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="text-sm text-muted-foreground py-6" role="status">
      {label}
    </div>
  );
}

export function P5B8Empty({ label }: { label: string }) {
  return (
    <div className="text-sm text-muted-foreground py-6 italic">{label}</div>
  );
}

export function P5B8ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="text-sm text-destructive border border-destructive/40 rounded-md p-3 bg-destructive/5"
    >
      Unable to load: {message}
    </div>
  );
}

/** Renders a status string verbatim with a tone derived from its category. */
export function P5B8StatusBadge({ value }: { value: string }) {
  const tone = statusTone(value);
  return (
    <Badge variant="outline" className={tone}>
      {value}
    </Badge>
  );
}

function statusTone(value: string): string {
  switch (value) {
    case "live_result_received":
    case "clear":
    case "false_positive":
    case "waived":
      return "border-emerald-500/40 text-emerald-700 dark:text-emerald-300";
    case "confirmed_match":
    case "blocked":
    case "provider_failed":
      return "border-destructive/40 text-destructive";
    case "potential_match":
    case "manual_review":
    case "manual_review_required":
    case "incomplete":
      return "border-amber-500/40 text-amber-700 dark:text-amber-300";
    case "provider_ready":
    case "activation_pending":
    case "live_pending":
    case "test_mode":
      return "border-blue-500/40 text-blue-700 dark:text-blue-300";
    default:
      return "border-border text-muted-foreground";
  }
}

export function P5B8DataTable({
  columns,
  rows,
}: {
  columns: { key: string; label: string }[];
  rows: Array<Record<string, ReactNode>>;
}) {
  if (rows.length === 0) {
    return <P5B8Empty label="No records." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border text-left">
            {columns.map((c) => (
              <th key={c.key} className="py-2 pr-4 font-medium text-muted-foreground">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/40">
              {columns.map((c) => (
                <td key={c.key} className="py-2 pr-4 align-top">
                  {r[c.key] ?? <span className="text-muted-foreground">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
