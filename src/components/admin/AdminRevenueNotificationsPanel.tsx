/**
 * AdminRevenueNotificationsPanel
 * ─────────────────────────────────────────────────────────────────────
 * Admin/auditor-only view of `public.revenue_notification_audit` - the
 * append-only log of every revenue email attempt fired to support@izenzo.co.za
 * by the poi-mint, credits-purchased, and wad-sealed hooks.
 *
 * Filters: event type (poi_minted | credits_purchased | wad_sealed), status
 * (sent | failed | skipped), free-text search on reference ID / org name /
 * idempotency key, and time window (24h / 7d / 30d / all).
 *
 * RLS already restricts SELECT to platform_admin or auditor, so the table
 * cannot leak to non-admin users even if the route guard is bypassed.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/error-state";
import { Loader2, RefreshCw, Search, AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";
import { format, formatDistanceToNow, subDays } from "date-fns";

type EventType = "poi_minted" | "credits_purchased" | "wad_sealed";
type StatusType = "sent" | "failed" | "skipped";

interface RevenueAuditRow {
  id: string;
  event_type: string;
  reference_id: string | null;
  idempotency_key: string;
  recipient_email: string;
  org_id: string | null;
  org_name: string | null;
  status: StatusType;
  error_message: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

const EVENT_LABELS: Record<EventType, string> = {
  poi_minted: "POI minted",
  credits_purchased: "Credits purchased",
  wad_sealed: "WaD sealed",
};

const PAGE_SIZE = 100;

const TIME_WINDOWS = [
  { value: "24h", label: "Last 24 hours", days: 1 },
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "all", label: "All time", days: 0 },
] as const;

type TimeWindowValue = typeof TIME_WINDOWS[number]["value"];

export function AdminRevenueNotificationsPanel() {
  const [eventFilter, setEventFilter] = useState<"all" | EventType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | StatusType>("all");
  const [search, setSearch] = useState("");
  const [timeWindow, setTimeWindow] = useState<TimeWindowValue>("7d");
  const [selected, setSelected] = useState<RevenueAuditRow | null>(null);

  const sinceIso = useMemo(() => {
    const win = TIME_WINDOWS.find((w) => w.value === timeWindow);
    if (!win || win.days === 0) return null;
    return subDays(new Date(), win.days).toISOString();
  }, [timeWindow]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin-revenue-notifications", eventFilter, statusFilter, search, timeWindow],
    queryFn: async () => {
      let query = supabase
        .from("revenue_notification_audit")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);

      if (eventFilter !== "all") query = query.eq("event_type", eventFilter);
      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (sinceIso) query = query.gte("created_at", sinceIso);
      if (search.trim()) {
        const term = `%${search.trim()}%`;
        query = query.or(
          `reference_id.ilike.${term},idempotency_key.ilike.${term},org_name.ilike.${term}`,
        );
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data || []) as RevenueAuditRow[], total: count ?? 0 };
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  // Summary tally for the filtered window
  const summary = useMemo(() => {
    const out = { sent: 0, failed: 0, skipped: 0 };
    for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
    return out;
  }, [rows]);

  const renderStatus = (s: StatusType) => {
    if (s === "sent") {
      return (
        <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400 gap-1">
          <CheckCircle2 className="h-3 w-3" /> Sent
        </Badge>
      );
    }
    if (s === "failed") {
      return (
        <Badge variant="outline" className="border-destructive/50 text-destructive gap-1">
          <AlertTriangle className="h-3 w-3" /> Failed
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <MinusCircle className="h-3 w-3" /> Skipped
      </Badge>
    );
  };

  const renderEventBadge = (eventType: string) => {
    const label = EVENT_LABELS[eventType as EventType] ?? eventType;
    return (
      <Badge variant="secondary" className="font-mono text-[11px]">
        {label}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Revenue notifications</CardTitle>
          <CardDescription>
            Every email attempt fired to support@izenzo.co.za when revenue is
            recognised - POI mint, credit purchase, or trade certification.
            Investigate failures here when the support inbox looks quiet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryStat label="Total in window" value={String(total)} />
            <SummaryStat label="Sent" value={String(summary.sent)} tone="success" />
            <SummaryStat label="Failed" value={String(summary.failed)} tone="danger" />
            <SummaryStat label="Skipped" value={String(summary.skipped)} tone="muted" />
          </div>

          {/* Filters */}
          <div className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-4 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search reference, org, or idempotency key…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="md:col-span-3">
              <Select value={eventFilter} onValueChange={(v) => setEventFilter(v as typeof eventFilter)}>
                <SelectTrigger>
                  <SelectValue placeholder="Event type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All event types</SelectItem>
                  <SelectItem value="poi_minted">POI minted</SelectItem>
                  <SelectItem value="credits_purchased">Credits purchased</SelectItem>
                  <SelectItem value="wad_sealed">WaD sealed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Select value={timeWindow} onValueChange={(v) => setTimeWindow(v as TimeWindowValue)}>
                <SelectTrigger>
                  <SelectValue placeholder="Window" />
                </SelectTrigger>
                <SelectContent>
                  {TIME_WINDOWS.map((w) => (
                    <SelectItem key={w.value} value={w.value}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetch()}
                disabled={isFetching}
                aria-label="Refresh"
                className="w-full"
              >
                {isFetching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No revenue notifications match these filters"
              message="Adjust the time window, event type, or search term to see more rows."
            />
          ) : (
            <div className="border border-border rounded-sm overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setSelected(r)}
                    >
                      <TableCell className="whitespace-nowrap text-xs">
                        <div>{format(new Date(r.created_at), "yyyy-MM-dd HH:mm:ss")}</div>
                        <div className="text-muted-foreground">
                          {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                        </div>
                      </TableCell>
                      <TableCell>{renderEventBadge(r.event_type)}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[200px] truncate">
                        {r.reference_id || "-"}
                      </TableCell>
                      <TableCell className="text-sm max-w-[180px] truncate">
                        {r.org_name || (r.org_id ? r.org_id.slice(0, 8) + "…" : "-")}
                      </TableCell>
                      <TableCell>{renderStatus(r.status)}</TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-destructive max-w-[280px] truncate">
                        {r.error_message || ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {total > rows.length && (
            <p className="text-xs text-muted-foreground">
              Showing {rows.length} of {total} matching rows. Narrow the filters to see more.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Notification detail</DialogTitle>
            <DialogDescription>
              {selected
                ? `${EVENT_LABELS[selected.event_type as EventType] ?? selected.event_type} · ${format(new Date(selected.created_at), "PPpp")}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <DetailRow label="Status">{renderStatus(selected.status)}</DetailRow>
              <DetailRow label="Recipient">
                <span className="font-mono text-xs">{selected.recipient_email}</span>
              </DetailRow>
              <DetailRow label="Reference ID">
                <span className="font-mono text-xs break-all">{selected.reference_id || "-"}</span>
              </DetailRow>
              <DetailRow label="Idempotency key">
                <span className="font-mono text-xs break-all">{selected.idempotency_key}</span>
              </DetailRow>
              <DetailRow label="Organisation">
                <div>
                  <div>{selected.org_name || "-"}</div>
                  {selected.org_id && (
                    <div className="font-mono text-[11px] text-muted-foreground">{selected.org_id}</div>
                  )}
                </div>
              </DetailRow>
              {selected.error_message && (
                <DetailRow label="Error">
                  <pre className="whitespace-pre-wrap break-all text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-sm p-2">
                    {selected.error_message}
                  </pre>
                </DetailRow>
              )}
              {selected.details && Object.keys(selected.details).length > 0 && (
                <DetailRow label="Details">
                  <pre className="whitespace-pre-wrap break-all text-xs bg-muted rounded-sm p-2">
                    {JSON.stringify(selected.details, null, 2)}
                  </pre>
                </DetailRow>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "danger"
        ? "text-destructive"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="border border-border rounded-sm p-3 bg-card">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value}</div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 items-start">
      <div className="text-xs uppercase tracking-wide text-muted-foreground pt-1">{label}</div>
      <div className="col-span-2">{children}</div>
    </div>
  );
}
