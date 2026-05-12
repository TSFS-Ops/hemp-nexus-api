/**
 * AdminEngagementForensicsPanel
 * ─────────────────────────────
 * A forensic search and trace surface for ANY engagement, regardless of
 * status, queue, or pagination. Built to answer support questions like
 * "Daniel says his platinum trade acceptance didn't notify him" within
 * seconds.
 *
 * Search keys: match_id, counterparty_email, initiator_org_id, status,
 * date range. Per-engagement drawer shows the linked acceptance receipt,
 * every notification dispatch attempt, and the outreach log.
 *
 * Independent of the triage tabs in AdminPendingEngagementsPanel —
 * this panel exists exactly to find rows that triage filters hide.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Eye, ShieldCheck, Mail, Bell, AlertTriangle, Hash } from "lucide-react";
import { format } from "date-fns";

type EngagementStatus = "pending" | "notification_sent" | "contacted" | "accepted" | "declined" | "expired";

interface EngagementRow {
  id: string;
  match_id: string;
  org_id: string;
  counterparty_org_id: string | null;
  counterparty_email: string | null;
  engagement_status: EngagementStatus;
  created_at: string;
  responded_at: string | null;
  /** Phase 1 demo isolation flag. */
  is_demo?: boolean | null;
}

export function AdminEngagementForensicsPanel() {
  const [matchId, setMatchId] = useState("");
  const [email, setEmail] = useState("");
  const [orgId, setOrgId] = useState("");
  const [status, setStatus] = useState<string>("any");
  const [showDemo, setShowDemo] = useState<boolean>(false);
  const [selected, setSelected] = useState<EngagementRow | null>(null);

  const FORENSICS_LIMIT = 200;
  const { data: rows = [], isFetching, refetch } = useQuery({
    queryKey: ["admin-forensics", matchId, email, orgId, status, showDemo],
    queryFn: async () => {
      let q = supabase
        .from("poi_engagements")
        .select("id, match_id, org_id, counterparty_org_id, counterparty_email, engagement_status, created_at, responded_at, is_demo")
        .order("created_at", { ascending: false })
        .limit(FORENSICS_LIMIT);

      if (matchId.trim()) q = q.ilike("match_id", `%${matchId.trim()}%`);
      if (email.trim()) q = q.ilike("counterparty_email", `%${email.trim()}%`);
      if (orgId.trim()) q = q.or(`org_id.ilike.%${orgId.trim()}%,counterparty_org_id.ilike.%${orgId.trim()}%`);
      if (status !== "any") q = q.eq("engagement_status", status as EngagementStatus);
      // Phase 1 demo isolation: hide demo rows unless operator opts in.
      if (!showDemo) q = q.eq("is_demo", false);

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as EngagementRow[];
    },
    enabled: false,
  });
  // Surface silent truncation: a forensics search returning exactly the cap is
  // almost certainly truncated. Tell the admin to narrow filters rather than
  // silently dropping rows past row 200.
  const forensicsTruncated = rows.length >= FORENSICS_LIMIT;

  const statusVariant = (s: EngagementStatus) => {
    switch (s) {
      case "accepted": return "default";
      case "declined":
      case "expired": return "destructive";
      case "contacted":
      case "notification_sent": return "secondary";
      default: return "outline";
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label htmlFor="f-match" className="text-xs">Match ID (full or prefix)</Label>
              <Input id="f-match" value={matchId} onChange={(e) => setMatchId(e.target.value)} placeholder="2378d188…" />
            </div>
            <div>
              <Label htmlFor="f-email" className="text-xs">Counterparty email</Label>
              <Input id="f-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@domain.com" />
            </div>
            <div>
              <Label htmlFor="f-org" className="text-xs">Org ID (initiator or counterparty)</Label>
              <Input id="f-org" value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="056152e4…" />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any status</SelectItem>
                  <SelectItem value="pending">pending</SelectItem>
                  <SelectItem value="notification_sent">notification_sent</SelectItem>
                  <SelectItem value="contacted">contacted</SelectItem>
                  <SelectItem value="accepted">accepted</SelectItem>
                  <SelectItem value="declined">declined</SelectItem>
                  <SelectItem value="expired">expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={() => refetch()} disabled={isFetching}>
              <Search className="h-4 w-4 mr-2" />
              {isFetching ? "Searching…" : "Search engagements"}
            </Button>
            <button
              type="button"
              onClick={() => setShowDemo((v) => !v)}
              className={`px-3 py-1.5 text-xs rounded-sm border ${
                showDemo
                  ? "bg-amber-100 border-amber-300 text-amber-900"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
              title="Demo rows are staged Daniel-facing fixtures. Hidden by default."
              aria-pressed={showDemo}
              data-testid="forensics-show-demo-toggle"
            >
              {showDemo ? "DEMO rows visible — click to hide" : "Show DEMO rows"}
            </button>
            <span className="text-xs text-muted-foreground">
              Independent of triage tabs · returns up to 200 rows · case-insensitive prefix match
            </span>
          </div>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardContent className="pt-5 space-y-3">
            {forensicsTruncated && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                <span className="font-semibold">Results capped.</span>
                <span>
                  Showing the most recent {FORENSICS_LIMIT} engagements that match these filters. Older matches are not displayed — narrow by Match ID, email, org or status to surface them.
                </span>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Engagement</TableHead>
                  <TableHead>Match</TableHead>
                  <TableHead>Counterparty email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Responded</TableHead>
                  <TableHead className="text-right">Trace</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-is-demo={r.is_demo === true ? "true" : "false"} className={r.is_demo === true ? "bg-amber-50/40" : ""}>
                    <TableCell className="font-mono text-xs">
                      {r.is_demo === true && (
                        <Badge variant="outline" className="mr-1 text-[10px] font-bold uppercase bg-amber-100 border-amber-400 text-amber-900" data-testid="forensics-demo-badge">DEMO</Badge>
                      )}
                      {r.id.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.match_id.slice(0, 8)}…</TableCell>
                    <TableCell className="text-xs">{r.counterparty_email || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell><Badge variant={statusVariant(r.engagement_status) as never}>{r.engagement_status}</Badge></TableCell>
                    <TableCell className="text-xs">
                      {r.responded_at ? format(new Date(r.responded_at), "yyyy-MM-dd HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setSelected(r)}>
                        <Eye className="h-4 w-4 mr-1" /> Trace
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selected && <ForensicTrace engagement={selected} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ForensicTrace({ engagement }: { engagement: EngagementRow }) {
  const { data: receipt } = useQuery({
    queryKey: ["forensic-receipt", engagement.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("acceptance_receipts")
        .select("*")
        .eq("engagement_id", engagement.id)
        .maybeSingle();
      return data;
    },
  });

  const { data: dispatches = [] } = useQuery({
    queryKey: ["forensic-dispatches", engagement.id, receipt?.id],
    queryFn: async () => {
      // Surface BOTH dispatch families so support sees the complete
      // notification history, not just acceptance ones:
      //   1. reference_id = receipt.id  → acceptance dispatches
      //   2. reference_id = engagement.id → outreach / status-change dispatches
      // Without (2) the panel silently hides outreach emails and "no
      // dispatches" was previously misread as "the counterparty was never
      // contacted" when in fact the outreach email had been sent.
      const ids: string[] = [engagement.id];
      if (receipt?.id) ids.push(receipt.id);
      const { data } = await supabase
        .from("notification_dispatches")
        .select("*")
        .in("reference_id", ids)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: true,
  });

  const { data: outreach = [] } = useQuery({
    queryKey: ["forensic-outreach", engagement.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("engagement_outreach_logs")
        .select("*")
        .eq("engagement_id", engagement.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Hash className="h-4 w-4" />
          Engagement Trace
        </SheetTitle>
        <SheetDescription className="font-mono text-xs">
          {engagement.id}
        </SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-6">
        <section>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Acceptance Receipt
          </h3>
          {receipt ? (
            <div className="rounded-sm border border-border p-3 text-xs space-y-1">
              {(receipt as { metadata?: { backfill?: boolean; backfill_reason?: string } }).metadata?.backfill && (
                <div className="rounded-sm bg-muted/40 border border-muted px-2 py-1 mb-1 flex items-start gap-2">
                  <Badge variant="outline" className="shrink-0">Backfilled</Badge>
                  <span className="text-muted-foreground">
                    {(receipt as { metadata?: { backfill_reason?: string } }).metadata?.backfill_reason ||
                      "Legacy seed receipt — predates the dispatch system; no notification was expected."}
                  </span>
                </div>
              )}
              <p><span className="text-muted-foreground">Receipt ID:</span> <span className="font-mono">{receipt.id}</span></p>
              <p><span className="text-muted-foreground">Accepted at:</span> {format(new Date(receipt.accepted_at), "yyyy-MM-dd HH:mm:ss")}</p>
              <p><span className="text-muted-foreground">Signature:</span> <span className="font-mono break-all">{receipt.signature_hash}</span></p>
              <p><span className="text-muted-foreground">Attestation:</span> <span className="font-mono">{receipt.attestation_id || "—"}</span></p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No receipt — engagement not yet accepted.</p>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            Notification dispatches ({dispatches.length})
          </h3>
          {dispatches.length === 0 ? (
            (receipt as { metadata?: { backfill?: boolean } } | null)?.metadata?.backfill ? (
              <p className="text-xs text-muted-foreground italic">
                No dispatches expected — this is a backfilled receipt from before the dispatch system existed.
              </p>
            ) : (
              <div className="rounded-sm border border-destructive/30 bg-destructive/5 p-3 text-xs flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <span>No dispatch records found for this engagement (neither outreach nor acceptance notifications).</span>
              </div>
            )
          ) : (
            <div className="space-y-2">
              {dispatches.map((d: any) => (
                <div key={d.id} className="rounded-sm border border-border p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="capitalize">{d.channel}</Badge>
                    <Badge variant={d.status === "delivered" ? "default" : d.status === "failed" ? "destructive" : "secondary"}>
                      {d.status}
                    </Badge>
                  </div>
                  {d.recipient_address && <p><span className="text-muted-foreground">To:</span> {d.recipient_address}</p>}
                  {d.template_name && <p><span className="text-muted-foreground">Template:</span> {d.template_name}</p>}
                  {d.message_id && <p><span className="text-muted-foreground">Provider msg ID:</span> <span className="font-mono">{d.message_id}</span></p>}
                  {d.dispatched_at && <p><span className="text-muted-foreground">Dispatched:</span> {format(new Date(d.dispatched_at), "yyyy-MM-dd HH:mm:ss")}</p>}
                  {d.delivered_at && <p><span className="text-muted-foreground">Delivered:</span> {format(new Date(d.delivered_at), "yyyy-MM-dd HH:mm:ss")}</p>}
                  {d.error_message && <p className="text-destructive">Error: {d.error_message}</p>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            Outreach log ({outreach.length})
          </h3>
          {outreach.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No outreach entries.</p>
          ) : (
            <div className="space-y-2">
              {outreach.map((o: any) => (
                <div key={o.id} className="rounded-sm border border-border p-3 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{o.previous_status} → {o.new_status}</span>
                    <span className="text-muted-foreground">{format(new Date(o.created_at), "yyyy-MM-dd HH:mm")}</span>
                  </div>
                  <p className="text-muted-foreground">
                    Actor: {o.actor_type}{o.admin_email ? ` · ${o.admin_email}` : ""}
                  </p>
                  {o.notes && <p className="mt-1 italic">{o.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
