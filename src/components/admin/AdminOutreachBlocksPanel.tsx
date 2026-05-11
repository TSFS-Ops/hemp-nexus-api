/**
 * AdminOutreachBlocksPanel — Batch G observability surface
 * ────────────────────────────────────────────────────────
 * Read-only admin view that counts and lists the three canonical
 * Batch E outreach-blocked audit events:
 *
 *   • outreach.blocked.contact_incomplete
 *   • outreach.blocked.binding_review_pending
 *   • outreach.blocked.disputed_being_named
 *
 * Answers, in plain English:
 *   • How many times was outreach blocked because contact details
 *     were incomplete / binding review was pending / the engagement
 *     was disputed?
 *   • Which organisation was affected?
 *   • Which engagement was affected?
 *   • When did it happen?
 *   • Which surface triggered it (preview-outreach or send-outreach)?
 *
 * SAFETY (Batch G contract — enforced by tests):
 *   This panel ONLY surfaces a tight allowlist of safe fields:
 *     org_id, entity_id (engagement id), action, surface, created_at.
 *   It MUST NEVER read or display:
 *     counterparty_email, counterparty_name, counterparty_org_id,
 *     binding_candidates, dispute_reason, dispute_source,
 *     disputed_by_token_hash, commodity, price_amount,
 *     quantity_amount, admin_notes, support_notes.
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

const ROW_LIMIT = 200;

/**
 * Whitelist of metadata fields the panel may read. Anything else is
 * dropped before render. This is enforced by Batch G tests.
 */
const SAFE_METADATA_FIELDS = ["surface"] as const;

interface SafeRow {
  id: string;
  action: OutreachBlockedAction;
  org_id: string | null;
  entity_id: string | null;
  surface: string | null;
  created_at: string;
}

function pickSafeMetadata(meta: unknown): { surface: string | null } {
  if (!meta || typeof meta !== "object") return { surface: null };
  const m = meta as Record<string, unknown>;
  const surfaceRaw = m[SAFE_METADATA_FIELDS[0]];
  const surface =
    typeof surfaceRaw === "string" && surfaceRaw.length > 0
      ? surfaceRaw
      : null;
  return { surface };
}

export function AdminOutreachBlocksPanel() {
  const [actionFilter, setActionFilter] = useState<
    OutreachBlockedAction | "all"
  >("all");

  const query = useQuery({
    queryKey: ["admin-outreach-blocks", actionFilter],
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

      const { data, error } = await q;
      if (error) throw error;

      return (data ?? []).map((r): SafeRow => {
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

  return (
    <div className="space-y-4">
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
                in last {ROW_LIMIT} events
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {rows.length} outreach-blocked event(s)
          {actionFilter !== "all" ? ` · filtered to ${ACTION_LABEL[actionFilter]}` : ""}
        </p>
        <div className="flex gap-2">
          {actionFilter !== "all" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActionFilter("all")}
            >
              Clear filter
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${query.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
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
