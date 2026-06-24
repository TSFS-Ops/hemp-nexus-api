/**
 * CasesDashboard — Stage 4
 *
 * Admin landing for P-5 cases. List view with filters wired to the
 * `p5_governance_readiness_cases` table. Read-only here; mutating actions
 * live on the detail page.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { P5StatusBadge } from "./components/P5StatusBadge";
import { useP5Permissions } from "@/hooks/useP5Permissions";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";

type Case = Database["public"]["Tables"]["p5_governance_readiness_cases"]["Row"];

type FilterKey =
  | "all"
  | "blockers"
  | "warnings"
  | "provider_dependent"
  | "on_hold"
  | "escalated"
  | "overdue"
  | "ready_to_proceed"
  | "more_information_required"
  | "assigned_to_me"
  | "unassigned"
  | "provider_failed"
  | "provider_credentials_pending";

const FILTER_LABELS: Record<FilterKey, string> = {
  all: "All",
  blockers: "Blockers",
  warnings: "Warnings",
  provider_dependent: "Provider-dependent",
  on_hold: "On hold",
  escalated: "Escalated",
  overdue: "Overdue",
  ready_to_proceed: "Ready to proceed",
  more_information_required: "More information required",
  assigned_to_me: "Assigned to me",
  unassigned: "Unassigned",
  provider_failed: "Provider failed",
  provider_credentials_pending: "Credentials pending",
};

function matchesFilter(c: Case, f: FilterKey, currentUserId: string | null): boolean {
  const now = Date.now();
  switch (f) {
    case "all":
      return true;
    case "blockers":
      return (c.blocker_count ?? 0) > 0 || c.readiness_status === "blocked";
    case "warnings":
      return (c.warning_count ?? 0) > 0;
    case "provider_dependent":
      return c.provider_dependency === true;
    case "on_hold":
      return c.is_on_hold === true || c.readiness_status === "on_hold";
    case "escalated":
      return c.is_escalated === true || c.readiness_status === "escalated";
    case "overdue":
      return Boolean(c.sla_due_at && new Date(c.sla_due_at).getTime() < now);
    case "ready_to_proceed":
      return c.readiness_status === "ready_to_proceed";
    case "more_information_required":
      return c.readiness_status === "more_information_required";
    case "assigned_to_me":
      return Boolean(currentUserId) && c.assigned_reviewer_id === currentUserId;
    case "unassigned":
      return !c.assigned_reviewer_id;
    case "provider_failed":
      return c.provider_status === "failed";
    case "provider_credentials_pending":
      return c.provider_status === "credentials_pending";
  }
}

export default function CasesDashboard() {
  const { user } = useAuth();
  const permissions = useP5Permissions();
  const [cases, setCases] = useState<Case[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("p5_governance_readiness_cases")
          .select("*")
          .order("last_updated_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        if (!cancelled) setCases((data ?? []) as Case[]);
      } catch (err) {
        toast.error(
          `Failed to load P-5 cases: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () => cases.filter((c) => matchesFilter(c, filter, user?.id ?? null)),
    [cases, filter, user?.id],
  );

  if (!permissions.canViewAdmin) {
    return (
      <main className="max-w-5xl mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            P-5 Governance is restricted to authorised internal roles.
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto p-6 space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">P-5 Governance</h1>
          <p className="text-sm text-muted-foreground">
            Governance, Compliance and Readiness — internal admin surface.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-2" data-testid="p5-filters">
        {(Object.keys(FILTER_LABELS) as FilterKey[]).map((k) => (
          <Button
            key={k}
            size="sm"
            variant={filter === k ? "default" : "outline"}
            onClick={() => setFilter(k)}
            data-filter={k}
          >
            {FILTER_LABELS[k]}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Cases ({filtered.length}
            {filtered.length !== cases.length ? ` of ${cases.length}` : ""})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cases match the current filter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Governance</TableHead>
                  <TableHead>Compliance</TableHead>
                  <TableHead>Readiness</TableHead>
                  <TableHead className="text-right">Blockers</TableHead>
                  <TableHead className="text-right">Warnings</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Reviewer</TableHead>
                  <TableHead>SLA due</TableHead>
                  <TableHead>Next action</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody data-testid="p5-cases-tbody">
                {filtered.map((c) => (
                  <TableRow key={c.id} data-testid={`p5-case-row-${c.id}`}>
                    <TableCell className="font-mono text-xs">
                      {c.id.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.entity_id?.slice(0, 8) ??
                        c.match_id?.slice(0, 8) ??
                        c.trade_request_id?.slice(0, 8) ??
                        c.counterparty_id?.slice(0, 8) ??
                        c.organization_id?.slice(0, 8) ??
                        "—"}
                    </TableCell>
                    <TableCell>
                      <P5StatusBadge status={c.governance_status} />
                    </TableCell>
                    <TableCell>
                      <P5StatusBadge status={c.compliance_status} />
                    </TableCell>
                    <TableCell>
                      <P5StatusBadge status={c.readiness_status} />
                    </TableCell>
                    <TableCell className="text-right">{c.blocker_count}</TableCell>
                    <TableCell className="text-right">{c.warning_count}</TableCell>
                    <TableCell className="text-xs">
                      {c.provider_dependency ? c.provider_status ?? "pending" : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.owner_user_id?.slice(0, 8) ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.assigned_reviewer_id?.slice(0, 8) ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.sla_due_at ? new Date(c.sla_due_at).toISOString().slice(0, 10) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">{c.next_action ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/admin/p5-governance/${c.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
