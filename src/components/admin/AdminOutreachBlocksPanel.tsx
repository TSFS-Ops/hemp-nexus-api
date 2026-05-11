/**
 * AdminOutreachBlocksPanel — Batch G + Batch I observability surface
 * ──────────────────────────────────────────────────────────────────
 * Read-only admin view that counts and lists the three canonical
 * Batch E outreach-blocked audit events:
 *
 *   • outreach.blocked.contact_incomplete
 *   • outreach.blocked.binding_review_pending
 *   • outreach.blocked.disputed_being_named
 *
 * Batch I additions (internal-only operational visibility):
 *   • Surface filter (preview-outreach / send-outreach / all)
 *   • Time-window filter (24h / 7d / 30d / all)
 *   • Reason filter via the existing summary cards
 *   • "Top organisations blocked" rollup so admins can see which
 *     organisations are repeatedly hitting outreach blocks and why.
 *
 * SAFETY (Batch G + Batch I contract — enforced by tests):
 *   This panel ONLY surfaces a tight allowlist of safe fields:
 *     id, action, org_id, entity_id, surface, created_at.
 *   It MUST NEVER read or display:
 *     counterparty_email, counterparty_name, counterparty_org_id,
 *     binding_candidates, dispute_reason, dispute_source,
 *     disputed_by_token_hash, commodity, price_amount,
 *     quantity_amount, admin_notes, support_notes.
 *
 *   The panel is strictly read-only:
 *     • No resolve / send / retry / notify / email actions.
 *     • No mutations, no edge-function calls, no dispatcher hooks.
 *     • No counterparty-facing surface of any kind.
 *
 *   Wording rule: no blame / fault / guilt / fraud / breach /
 *   liability / finality language. This is observability, not a
 *   determination.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw } from "lucide-react";
import { format } from "date-fns";

// Canonical actions — must match the three Batch E catalogue entries.
export const OUTREACH_BLOCKED_ACTIONS = [
  "outreach.blocked.contact_incomplete",
  "outreach.blocked.binding_review_pending",
  "outreach.blocked.disputed_being_named",
] as const;

type OutreachBlockedAction = (typeof OUTREACH_BLOCKED_ACTIONS)[number];

// Plain-English label per action. Deliberately neutral wording — no
// blame, fault, guilt, fraud, breach, liability or finality language.
const ACTION_LABEL: Record<OutreachBlockedAction, string> = {
  "outreach.blocked.contact_incomplete":
    "Contact details incomplete",
  "outreach.blocked.binding_review_pending":
    "Binding review pending",
  "outreach.blocked.disputed_being_named":
    "Engagement under dispute",
};

const ROW_LIMIT = 500;

// Safe surface allowlist — must match the two real call sites in
// supabase/functions/poi-engagements/index.ts.
const SAFE_SURFACES = ["preview-outreach", "send-outreach"] as const;
type SafeSurface = (typeof SAFE_SURFACES)[number];

// Time-window options. "all" sends no created_at filter.
const WINDOW_OPTIONS = [
  { id: "24h", label: "Last 24 hours", hours: 24 },
  { id: "7d", label: "Last 7 days", hours: 24 * 7 },
  { id: "30d", label: "Last 30 days", hours: 24 * 30 },
  { id: "all", label: "All time", hours: null },
] as const;
type WindowId = (typeof WINDOW_OPTIONS)[number]["id"];

/**
 * Whitelist of metadata fields the panel may read. Anything else is
 * dropped before render. This is enforced by Batch G/I tests.
 */
const SAFE_METADATA_FIELDS = ["surface"] as const;

interface SafeRow {
  id: string;
  action: OutreachBlockedAction;
  org_id: string | null;
  entity_id: string | null;
  surface: SafeSurface | null;
  created_at: string;
}

function pickSafeMetadata(meta: unknown): { surface: SafeSurface | null } {
  if (!meta || typeof meta !== "object") return { surface: null };
  const m = meta as Record<string, unknown>;
  const surfaceRaw = m[SAFE_METADATA_FIELDS[0]];
  if (typeof surfaceRaw !== "string") return { surface: null };
  if ((SAFE_SURFACES as readonly string[]).includes(surfaceRaw)) {
    return { surface: surfaceRaw as SafeSurface };
  }
  return { surface: null };
}

export function AdminOutreachBlocksPanel() {
  const [actionFilter, setActionFilter] = useState<
    OutreachBlockedAction | "all"
  >("all");
  const [surfaceFilter, setSurfaceFilter] = useState<SafeSurface | "all">("all");
  const [windowFilter, setWindowFilter] = useState<WindowId>("7d");

  const query = useQuery({
    queryKey: ["admin-outreach-blocks", actionFilter, surfaceFilter, windowFilter],
    queryFn: async (): Promise<SafeRow[]> => {
      // Read only the columns we are allowed to surface. We deliberately
      // do NOT select(*) — that would pull metadata fields we must not
      // read (counterparty identity, dispute text, candidate lists,
      // commercial terms, admin/support notes).
      let q = supabase
        .from("audit_logs")
        .select("id, action, org_id, entity_id, metadata, created_at")
        .in("action", OUTREACH_BLOCKED_ACTIONS as unknown as string[])
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT);

      if (actionFilter !== "all") {
        q = q.eq("action", actionFilter);
      }

      const win = WINDOW_OPTIONS.find((w) => w.id === windowFilter);
      if (win && win.hours != null) {
        const since = new Date(Date.now() - win.hours * 60 * 60 * 1000).toISOString();
        q = q.gte("created_at", since);
      }

      const { data, error } = await q;
      if (error) throw error;

      const mapped: SafeRow[] = (data ?? []).map((r): SafeRow => {
        const safe = pickSafeMetadata(r.metadata);
        return {
          id: r.id as string,
          action: r.action as OutreachBlockedAction,
          org_id: (r.org_id as string | null) ?? null,
          entity_id: (r.entity_id as string | null) ?? null,
          surface: safe.surface,
          created_at: r.created_at as string,
        };
      });

      // Surface filter is applied client-side because `surface` lives
      // inside the metadata jsonb column; the explicit allowlist in
      // pickSafeMetadata guarantees no other metadata field leaks.
      if (surfaceFilter !== "all") {
        return mapped.filter((r) => r.surface === surfaceFilter);
      }
      return mapped;
    },
  });

  const rows = query.data ?? [];

  const counts = useMemo(() => {
    const c: Record<OutreachBlockedAction, number> = {
      "outreach.blocked.contact_incomplete": 0,
      "outreach.blocked.binding_review_pending": 0,
      "outreach.blocked.disputed_being_named": 0,
    };
    for (const r of rows) c[r.action] += 1;
    return c;
  }, [rows]);

  // Per-organisation rollup — uses ONLY the safe org_id field.
  // No org name lookup, no joins; that would require additional safe-
  // field guarantees outside this batch's scope.
  const orgRollup = useMemo(() => {
    const m = new Map<string, { org_id: string; total: number; byAction: Record<OutreachBlockedAction, number> }>();
    for (const r of rows) {
      if (!r.org_id) continue;
      const existing = m.get(r.org_id) ?? {
        org_id: r.org_id,
        total: 0,
        byAction: {
          "outreach.blocked.contact_incomplete": 0,
          "outreach.blocked.binding_review_pending": 0,
          "outreach.blocked.disputed_being_named": 0,
        },
      };
      existing.total += 1;
      existing.byAction[r.action] += 1;
      m.set(r.org_id, existing);
    }
    return Array.from(m.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [rows]);

  const windowLabel =
    WINDOW_OPTIONS.find((w) => w.id === windowFilter)?.label ?? "Last 7 days";

  return (
    <div className="space-y-4">
      {/* Filters row — read-only operational scoping */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Time window</label>
          <Select value={windowFilter} onValueChange={(v) => setWindowFilter(v as WindowId)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOW_OPTIONS.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Surface</label>
          <Select
            value={surfaceFilter}
            onValueChange={(v) => setSurfaceFilter(v as SafeSurface | "all")}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All surfaces</SelectItem>
              {SAFE_SURFACES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Reason</label>
          <Select
            value={actionFilter}
            onValueChange={(v) => setActionFilter(v as OutreachBlockedAction | "all")}
          >
            <SelectTrigger className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reasons</SelectItem>
              {OUTREACH_BLOCKED_ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>{ACTION_LABEL[a]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${query.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Reason summary cards — clickable to toggle the reason filter */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {OUTREACH_BLOCKED_ACTIONS.map((a) => (
          <Card
            key={a}
            className={`cursor-pointer transition-colors ${
              actionFilter === a ? "border-primary" : ""
            }`}
            onClick={() =>
              setActionFilter(actionFilter === a ? "all" : a)
            }
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {ACTION_LABEL[a]}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-mono">{counts[a]}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {windowLabel.toLowerCase()} · in last {ROW_LIMIT} events
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-organisation rollup — safe org_id only, no joins */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Organisations most often blocked
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organisation</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Contact incomplete</TableHead>
                <TableHead className="text-right">Binding review</TableHead>
                <TableHead className="text-right">Under dispute</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgRollup.map((o) => (
                <TableRow key={o.org_id}>
                  <TableCell className="font-mono text-xs">
                    {o.org_id.substring(0, 12)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{o.total}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {o.byAction["outreach.blocked.contact_incomplete"]}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {o.byAction["outreach.blocked.binding_review_pending"]}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {o.byAction["outreach.blocked.disputed_being_named"]}
                  </TableCell>
                </TableRow>
              ))}
              {orgRollup.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground py-6"
                  >
                    No organisations to summarise in the selected window.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {rows.length} outreach-blocked event(s)
          {actionFilter !== "all" ? ` · filtered to ${ACTION_LABEL[actionFilter]}` : ""}
          {surfaceFilter !== "all" ? ` · surface: ${surfaceFilter}` : ""}
          {` · ${windowLabel.toLowerCase()}`}
        </p>
        {(actionFilter !== "all" || surfaceFilter !== "all") && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setActionFilter("all");
              setSurfaceFilter("all");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {query.isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Engagement</TableHead>
                  <TableHead>Surface</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {ACTION_LABEL[r.action]}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.org_id ? r.org_id.substring(0, 12) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.entity_id ? r.entity_id.substring(0, 12) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.surface ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {format(new Date(r.created_at), "yyyy-MM-dd HH:mm")}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-muted-foreground py-8"
                    >
                      No outreach-blocked events recorded.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
