/**
 * AdminNotificationPreferencesPanel
 *
 * HQ → Audit → Notification Preferences
 *
 * Compliance review surface: lists users, their per-channel notification
 * preferences, last-updated timestamp, and suppression / unsubscribe
 * status. Supports search, org filtering (platform-tier callers), channel
 * filtering, suppression filtering, and audited CSV export.
 *
 * All reads are server-side authorised via the `admin-notification-preferences`
 * edge function; org_admin callers are forcibly scoped to their org.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2, RefreshCw, Search, Shield } from "lucide-react";
import { EmptyState } from "@/components/ui/error-state";
import { toast } from "sonner";
import { format } from "date-fns";
import { auditedDownloadCSV, timestampedFilename } from "@/lib/download-utils";
import { recordExportAudit } from "@/lib/export-audit";

type PrefsRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  org_id: string | null;
  org_name: string | null;
  account_status: string | null;
  created_at: string;
  preferences: Record<string, unknown>;
  preferences_updated_at: string | null;
  suppression_reason: "unsubscribe" | "bounce" | "complaint" | null;
  suppression_at: string | null;
};

const CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "any",                   label: "Any channel" },
  { value: "email",                 label: "Email (any)" },
  { value: "in_app",                label: "In-app (any)" },
  { value: "engagement_email",      label: "Engagement · Email" },
  { value: "engagement_in_app",     label: "Engagement · In-app" },
  { value: "binding_review_email",  label: "Binding review · Email" },
  { value: "binding_review_in_app", label: "Binding review · In-app" },
  { value: "dispute_email",         label: "Dispute · Email" },
  { value: "dispute_in_app",        label: "Dispute · In-app" },
  { value: "system_email",          label: "System · Email" },
  { value: "marketing_email",       label: "Marketing · Email" },
];

const SUPPRESSION_OPTIONS = [
  { value: "any",         label: "Any status" },
  { value: "none",        label: "Receiving (no suppression)" },
  { value: "unsubscribe", label: "Unsubscribed" },
  { value: "bounce",      label: "Bounced" },
  { value: "complaint",   label: "Complaint" },
];

const PAGE_SIZE = 200;

function suppressionBadge(reason: PrefsRow["suppression_reason"]) {
  if (!reason) return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Receiving</Badge>;
  if (reason === "unsubscribe") return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Unsubscribed</Badge>;
  if (reason === "bounce")      return <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">Bounced</Badge>;
  return <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">Complaint</Badge>;
}

function disabledChannels(prefs: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(prefs ?? {})) {
    if (v === false) out.push(k);
    else if (v && typeof v === "object" && (v as { enabled?: boolean }).enabled === false) out.push(k);
  }
  return out.sort();
}

export function AdminNotificationPreferencesPanel() {
  const [search, setSearch] = useState("");
  const [orgIdFilter, setOrgIdFilter] = useState("");
  const [suppression, setSuppression] = useState<string>("any");
  const [channel, setChannel] = useState<string>("any");
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  const queryKey = ["admin-notification-preferences", search, orgIdFilter, suppression, channel, page];

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      const body: Record<string, unknown> = {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        suppression,
      };
      if (search.trim())     body.search  = search.trim();
      if (orgIdFilter.trim()) body.org_id = orgIdFilter.trim();
      if (channel !== "any") body.channel = channel;

      const { data, error } = await supabase.functions.invoke("admin-notification-preferences", { body });
      if (error) throw new Error(error.message);
      return data as { items: PrefsRow[]; totalCount: number };
    },
  });

  const rows = data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.totalCount ?? 0) / PAGE_SIZE));

  const handleExport = async () => {
    if (!rows.length) {
      toast.error("Nothing to export");
      return;
    }
    // DATA-010 Phase 1: real reason prompt.
    const { promptExportReason } = await import("@/lib/export-purpose");
    const reason = promptExportReason(
      "compliance verification or sanctions review",
      `notification preferences export (${rows.length} rows)`,
    );
    if (!reason) {
      toast.error("Export cancelled — a reason of at least 10 characters is required.");
      return;
    }
    setExporting(true);
    try {
      const audit = await recordExportAudit({
        target_type: "notification_preferences",
        format: "csv",
        row_count: rows.length,
        filters: { search, org_id: orgIdFilter, suppression, channel },
        sensitive: true,
        purpose: "compliance_verification_or_sanctions_review",
        reason,
        target_org_id: orgIdFilter || null,
        data_categories: ["notification_preferences", "email_suppression"],
      });
      if (!audit.ok && audit.aal_required) {
        toast.error("MFA required for this export. Enrol an authenticator app and retry.");
        return;
      }
      const headers = [
        "user_id", "email", "full_name", "org_id", "org_name", "account_status",
        "suppression_reason", "suppression_at", "preferences_updated_at",
        "disabled_channels", "preferences_json",
      ];
      const data = rows.map((r) => [
        r.user_id,
        r.email ?? "",
        r.full_name ?? "",
        r.org_id ?? "",
        r.org_name ?? "",
        r.account_status ?? "",
        r.suppression_reason ?? "",
        r.suppression_at ?? "",
        r.preferences_updated_at ?? "",
        disabledChannels(r.preferences).join("|"),
        JSON.stringify(r.preferences ?? {}),
      ]);
      // Batch U AUD-018: route through auditedDownloadCSV so prebuild guard
      // cannot regress. AAL2 already enforced via recordExportAudit above;
      // sensitive=false here avoids a duplicate audit row.
      await auditedDownloadCSV(headers, data, {
        reportName: "notification-preferences",
        filename: timestampedFilename("notification-preferences", "csv"),
        target_type: "notification_preferences",
        sensitive: false,
        purpose: "compliance_verification_or_sanctions_review",
        reason,
        target_org_id: orgIdFilter || null,
        data_categories: ["notification_preferences", "email_suppression"],
        filters: { search, org_id: orgIdFilter, suppression, channel, demo_excluded: true },
      });

      toast.success(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const summary = useMemo(() => {
    const total = rows.length;
    const unsubscribed = rows.filter((r) => r.suppression_reason === "unsubscribe").length;
    const bounced = rows.filter((r) => r.suppression_reason === "bounce" || r.suppression_reason === "complaint").length;
    return { total, unsubscribed, bounced };
  }, [rows]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4 text-primary" />
              Notification preferences · compliance review
            </CardTitle>
            <CardDescription>
              Server-authorised cross-user view of `public.notification_preferences` and
              `public.suppressed_emails`. org_admin callers are scoped to their organisation.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || !rows.length}>
              {exporting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
              Export CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative md:col-span-2">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search email or name…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-8"
            />
          </div>
          <Input
            placeholder="Org ID (UUID)"
            value={orgIdFilter}
            onChange={(e) => { setOrgIdFilter(e.target.value); setPage(0); }}
          />
          <div className="grid grid-cols-2 gap-2">
            <Select value={suppression} onValueChange={(v) => { setSuppression(v); setPage(0); }}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                {SUPPRESSION_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={channel} onValueChange={(v) => { setChannel(v); setPage(0); }}>
              <SelectTrigger><SelectValue placeholder="Channel" /></SelectTrigger>
              <SelectContent>
                {CHANNEL_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label} {o.value !== "any" ? "· disabled" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-3 text-xs font-mono text-muted-foreground">
          <span>page rows: {summary.total}</span>
          <span>unsubscribed: {summary.unsubscribed}</span>
          <span>bounced/complaint: {summary.bounced}</span>
          <span>total matching: {data?.totalCount ?? 0}</span>
        </div>

        <div className="rounded-md border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Organisation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Disabled channels</TableHead>
                <TableHead>Prefs updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin inline" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <EmptyState
                      title="No users match"
                      message="Adjust the filters or clear the search to broaden the result set."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const disabled = disabledChannels(r.preferences);
                  return (
                    <TableRow key={r.user_id}>
                      <TableCell>
                        <div className="font-medium text-sm">{r.full_name ?? "—"}</div>
                        <div className="font-mono text-xs text-muted-foreground">{r.email ?? "—"}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{r.org_name ?? "—"}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{r.org_id ?? ""}</div>
                      </TableCell>
                      <TableCell>{suppressionBadge(r.suppression_reason)}</TableCell>
                      <TableCell>
                        {disabled.length === 0 ? (
                          <span className="text-xs text-muted-foreground">All channels on</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {disabled.slice(0, 4).map((c) => (
                              <Badge key={c} variant="secondary" className="font-mono text-[10px]">{c}</Badge>
                            ))}
                            {disabled.length > 4 && (
                              <Badge variant="outline" className="font-mono text-[10px]">+{disabled.length - 4}</Badge>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.preferences_updated_at
                          ? format(new Date(r.preferences_updated_at), "yyyy-MM-dd HH:mm")
                          : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>page {page + 1} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
