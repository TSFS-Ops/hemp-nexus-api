/**
 * AdminVerificationQueuePanel — central queue for the optional verification clip-on.
 *
 * Closes the gap flagged in the strict-verification pass:
 *   • No central list of operator_verification_requests across matches
 *   • No way to set status → completed and record outcome from the UI
 *
 * RLS on operator_verification_requests already restricts SELECT/INSERT/UPDATE
 * to platform_admin, so this panel is gated by the existing /hq access control
 * and additionally re-checks the role client-side for an explicit empty-state.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldAlert, ExternalLink, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VerificationWalkthroughCard } from "./VerificationWalkthroughCard";
import { ClipOnBillingFailuresPanel } from "./ClipOnBillingFailuresPanel";
import { OpenGovernanceRecordLink } from "@/components/admin/governance/OpenGovernanceRecordLink";

type Kind = "idv" | "org" | "both";
type Status = "pending" | "in_progress" | "completed" | "cancelled";
type Outcome = "verified" | "rejected" | "inconclusive";

interface VerificationRow {
  id: string;
  match_id: string | null;
  org_id: string | null;
  subject_org_id: string | null;
  subject_name: string;
  kind: Kind;
  status: Status;
  outcome: Outcome | null;
  reason: string | null;
  reviewer_notes: string | null;
  raised_by: string;
  assigned_to: string | null;
  completed_at: string | null;
  created_at: string;
  priced_total_zar: number | null;
  clip_on_billed_at: string | null;
}

const KIND_LABELS: Record<Kind, string> = {
  idv: "Identity (IDV)",
  org: "Organisation (KYB)",
  both: "Identity + Organisation",
};

const STATUS_VARIANT: Record<Status, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  in_progress: "secondary",
  completed: "default",
  cancelled: "destructive",
};

const STATUS_FILTERS: Array<{ value: "open" | Status | "all"; label: string }> = [
  { value: "open", label: "Open (pending + in progress)" },
  { value: "pending", label: "Pending only" },
  { value: "in_progress", label: "In progress only" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
];

export function AdminVerificationQueuePanel() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<"open" | Status | "all">("open");

  // Action dialog state
  const [acting, setActing] = useState<VerificationRow | null>(null);
  const [actionStatus, setActionStatus] = useState<Status>("completed");
  const [actionOutcome, setActionOutcome] = useState<Outcome | "">("");
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id)
        .eq("role", "platform_admin")
        .maybeSingle();
      if (cancelled) return;
      setIsAdmin(!error && !!data);
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const { data: rows = [], isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin-verification-queue", filter],
    enabled: isAdmin === true,
    queryFn: async () => {
      let q = supabase
        .from("operator_verification_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      if (filter === "open") q = q.in("status", ["pending", "in_progress"]);
      else if (filter !== "all") q = q.eq("status", filter);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as VerificationRow[];
    },
    refetchInterval: 30_000,
  });

  // Truncation guard: surface explicitly when we hit the 500-row cap so an
  // admin doesn't think there are no more open requests.
  const truncated = rows.length === 500;

  // Distinct counterparty orgs across the open queue — we only fetch
  // balances for orgs that have an unbilled, actionable request, so the
  // pickup decision is informed by the live wallet position.
  const openOrgIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (
        r.org_id &&
        !r.clip_on_billed_at &&
        (r.status === "pending" || r.status === "in_progress")
      ) {
        set.add(r.org_id);
      }
    }
    return Array.from(set).sort();
  }, [rows]);

  const { data: balanceMap = new Map<string, number>() } = useQuery({
    queryKey: ["admin-verification-queue-org-balances", openOrgIds.join(",")],
    enabled: isAdmin === true && openOrgIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("token_balances")
        .select("org_id, balance")
        .in("org_id", openOrgIds);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const r of (data ?? []) as Array<{ org_id: string; balance: number }>) {
        m.set(r.org_id, r.balance ?? 0);
      }
      return m;
    },
    staleTime: 30 * 1000,
  });

  // Mirror the DB-side credit calculation in bill_clip_on_request:
  //   credits_required = max(1, ceil(priced_total_zar / 10))
  // Used both for the inline warning badge and to disable pickup when
  // we already know the burn would fail.
  const creditsRequiredFor = (r: VerificationRow): number => {
    const total = Number(r.priced_total_zar ?? 0);
    return Math.max(1, Math.ceil(total / 10));
  };
  const insufficientFor = (r: VerificationRow): { required: number; balance: number } | null => {
    if (!r.org_id || r.clip_on_billed_at) return null;
    if (r.status !== "pending" && r.status !== "in_progress") return null;
    const required = creditsRequiredFor(r);
    const balance = balanceMap.get(r.org_id);
    if (balance === undefined) return null; // not loaded yet
    if (balance < required) return { required, balance };
    return null;
  };

  const counts = useMemo(() => {
    const c = { open: 0, pending: 0, in_progress: 0, completed: 0, cancelled: 0 } as Record<string, number>;
    for (const r of rows) {
      c[r.status] = (c[r.status] ?? 0) + 1;
      if (r.status === "pending" || r.status === "in_progress") c.open += 1;
    }
    return c;
  }, [rows]);

  const openActionDialog = (row: VerificationRow) => {
    setActing(row);
    setActionStatus(row.status === "pending" ? "in_progress" : "completed");
    setActionOutcome(row.outcome ?? "");
    setReviewerNotes(row.reviewer_notes ?? "");
  };

  const handleSubmit = async () => {
    if (!acting || !session) return;
    // Outcome is required only for completed.
    if (actionStatus === "completed" && !actionOutcome) {
      toast.error("Choose an outcome before completing.");
      return;
    }
    setSubmitting(true);
    try {
      const patch: Record<string, unknown> = {
        status: actionStatus,
        reviewer_notes: reviewerNotes.trim() || null,
        assigned_to: session.user.id,
        outcome:
          actionStatus === "completed"
            ? actionOutcome || null
            : actionStatus === "cancelled"
              ? null
              : acting.outcome,
        completed_at:
          actionStatus === "completed" || actionStatus === "cancelled"
            ? new Date().toISOString()
            : null,
      };
      const { error } = await supabase
        .from("operator_verification_requests")
        .update(patch)
        .eq("id", acting.id);
      if (error) {
        // Detect billing rejection raised by bill_clip_on_request /
        // tg_clip_on_block_unbilled_revert. The DB raises P0541
        // (CLIP_ON_INSUFFICIENT_CREDITS) or P0542 (status revert blocked)
        // and PostgREST surfaces the message verbatim. Capture the
        // failure durably via the service-role edge function so the
        // attempt is auditable, then show the operator a precise toast
        // and abort — the request stays in its prior status (atomic
        // rollback already handled by Postgres).
        const msg = String(error.message || "");
        const code = (error as any).code as string | undefined;
        const isInsufficient =
          code === "P0541" || /CLIP_ON_INSUFFICIENT_CREDITS/i.test(msg);
        const isRevertBlocked =
          code === "P0542" || /CLIP_ON_BILLED_NO_REVERT/i.test(msg);

        if (isInsufficient || isRevertBlocked) {
          // Best-effort durable capture. We do not throw on failure of
          // the recorder — the primary signal (rolled-back update) is
          // already correct; the recorder is for the audit ledger.
          try {
            const { error: recErr } = await supabase.functions.invoke(
              "clip-on-record-billing-failure",
              {
                body: {
                  request_id: acting.id,
                  reason: {
                    code: isInsufficient
                      ? "CLIP_ON_INSUFFICIENT_CREDITS"
                      : "CLIP_ON_BILLED_NO_REVERT",
                    message: msg,
                    pg_code: code ?? null,
                    attempted_status: actionStatus,
                    subject_name: acting.subject_name,
                    kind: acting.kind,
                  },
                },
              },
            );
            if (recErr) {
              console.warn(
                "[verification-queue] failure-recorder errored",
                recErr,
              );
            }
          } catch (recCatch) {
            console.warn(
              "[verification-queue] failure-recorder threw",
              recCatch,
            );
          }

          toast.error(
            isInsufficient
              ? "Cannot pick up — counterparty has insufficient credits. The attempt has been logged for billing follow-up."
              : "Cannot revert — request is already billed. Issue a refund first.",
          );
          // Refresh so the status reverts to its true (rolled-back) value
          // in the UI and counters re-derive.
          queryClient.invalidateQueries({ queryKey: ["admin-verification-queue"] });
          refetch();
          return;
        }

        throw error;
      }

      // Audit trail entry so a closed verification is visible in the
      // immutable audit log surface that compliance reviewers already use.
      // org_id is non-null on audit_logs — fall back to the acting admin's
      // own org if the request was not bound to one (admin-raised cross-org).
      const auditOrg =
        acting.org_id
          ?? acting.subject_org_id
          ?? (await supabase
                .from("profiles")
                .select("org_id")
                .eq("id", session.user.id)
                .maybeSingle()).data?.org_id;

      if (auditOrg) {
        const { error: auditErr } = await supabase.from("audit_logs").insert([{
          org_id: auditOrg,
          actor_user_id: session.user.id,
          action: `verification.${actionStatus}`,
          entity_type: "operator_verification_request",
          entity_id: acting.id,
          metadata: {
            subject_name: acting.subject_name,
            kind: acting.kind,
            outcome: (patch.outcome as string | null) ?? null,
            reviewer_notes_len: (reviewerNotes.trim() || "").length,
          },
        }]);
        if (auditErr) console.warn("[verification-queue] audit insert failed", auditErr);
      } else {
        console.warn("[verification-queue] no org context — skipping audit insert");
      }

      toast.success(`Request marked ${actionStatus.replace("_", " ")}`);
      setActing(null);
      queryClient.invalidateQueries({ queryKey: ["admin-verification-queue"] });
      queryClient.invalidateQueries({ queryKey: ["operator-verification-requests"] });
      refetch();
    } catch (e: any) {
      toast.error(`Could not update: ${e.message ?? "unknown error"}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (isAdmin === false) {
    return (
      <div className="text-sm text-muted-foreground">
        Platform admin role required to view the verification queue.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <VerificationWalkthroughCard />
      <ClipOnBillingFailuresPanel />
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px]">Open: {counts.open}</Badge>
          <Badge variant="secondary" className="text-[10px]">In progress: {counts.in_progress ?? 0}</Badge>
          <Badge variant="default" className="text-[10px]">Completed (loaded): {counts.completed ?? 0}</Badge>
        </div>
        <div className="flex items-end gap-3">
          {/* Batch T — UI-012: visible last-updated chip + manual refresh
              so a stale tab cannot read as live. */}
          <div className="flex items-center gap-2">
            <p
              className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground"
              data-testid="verification-queue-last-updated"
            >
              Last updated{" "}
              {dataUpdatedAt
                ? formatDistanceToNow(new Date(dataUpdatedAt), { addSuffix: true })
                : "—"}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          <div className="min-w-[260px]">
            <Label className="text-xs text-muted-foreground">Filter</Label>
            <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
              <SelectTrigger className="h-9 mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {truncated && (
        <div className="rounded-sm border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Showing the most recent 500 requests for this filter. Narrow the filter to see older entries.
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading queue…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">No verification requests for this filter.</div>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2">Raised</th>
                <th className="px-3 py-2">Match</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const insuf = insufficientFor(r);
                return (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.subject_name}</div>
                    {r.reason && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{r.reason}</div>}
                    {insuf && (
                      <div
                        role="status"
                        aria-label={`Blocked: counterparty out of credits (${insuf.balance} of ${insuf.required})`}
                        data-testid={`row-blocked-reason-${r.id}`}
                        className="mt-1 inline-flex items-center gap-1 rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive"
                      >
                        <ShieldAlert className="h-3 w-3" />
                        Blocked: counterparty out of credits ({insuf.balance}/{insuf.required})
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Badge variant="secondary" className="text-[10px]">{KIND_LABELS[r.kind]}</Badge>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Badge variant={STATUS_VARIANT[r.status]} className="text-[10px] capitalize">
                      {r.status.replace("_", " ")}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.outcome ? (
                      <Badge variant="outline" className="text-[10px] capitalize">{r.outcome}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.match_id ? (
                      <Link
                        to={`/dashboard/matches/${r.match_id}`}
                        className="text-xs underline inline-flex items-center gap-1"
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    {r.status === "completed" || r.status === "cancelled" ? (
                      <span className="text-xs text-muted-foreground">Closed</span>
                    ) : insuf ? (
                      <div
                        data-testid={`row-action-blocked-${r.id}`}
                        className="inline-flex flex-col items-end gap-1"
                      >
                        <span
                          role="status"
                          className="inline-flex items-center gap-1 rounded-sm border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive"
                        >
                          <ShieldAlert className="h-3 w-3" />
                          Blocked — top-up required
                        </span>
                        {r.org_id && (
                          <Link
                            to={`/hq?org=${r.org_id}`}
                            className="text-[11px] underline text-muted-foreground hover:text-foreground"
                          >
                            View counterparty wallet
                          </Link>
                        )}
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`row-action-button-${r.id}`}
                        onClick={() => openActionDialog(r)}
                      >
                        <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                        Action
                      </Button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!acting} onOpenChange={(o) => !o && setActing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Action verification request</DialogTitle>
          </DialogHeader>
          {acting && (
            <div className="space-y-3">
              <div className="text-sm">
                <div className="font-medium">{acting.subject_name}</div>
                <div className="text-xs text-muted-foreground">
                  {KIND_LABELS[acting.kind]} • Raised {new Date(acting.created_at).toLocaleString()}
                </div>
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={actionStatus} onValueChange={(v) => setActionStatus(v as Status)}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {actionStatus === "completed" && (
                <div>
                  <Label className="text-xs">Outcome (required)</Label>
                  <Select value={actionOutcome} onValueChange={(v) => setActionOutcome(v as Outcome)}>
                    <SelectTrigger className="h-9 mt-1"><SelectValue placeholder="Choose an outcome" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="verified">Verified</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="inconclusive">Inconclusive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label className="text-xs">Reviewer notes</Label>
                <Textarea
                  value={reviewerNotes}
                  onChange={(e) => setReviewerNotes(e.target.value)}
                  placeholder="What did you check? What evidence did you rely on?"
                  rows={3}
                  className="mt-1 text-sm"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Closing this request writes an immutable entry to the audit log.
                A “rejected” outcome does not currently auto-block POI mint —
                the WaD 9-gate engine remains the enforcement boundary.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setActing(null)} disabled={submitting}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
