/**
 * DATA-004 Phase 2 — Per-Org Retention Health / Evidence Panel.
 *
 * Platform-admin only, READ-ONLY. Surfaces the effective per-org
 * retention posture before any sweeper is wired to consume
 * `org_retention_policies`. The whole point of this panel is to
 * prove — visibly — that HQ can see what *would* happen if
 * enforcement were turned on, while explicitly stating that NO
 * sweeper enforcement is wired yet.
 *
 * Sources:
 *   - admin-org-retention { action: "health" }   (does NOT require AAL2)
 *
 * What it shows:
 *   - Summary tiles (orgs total, explicit policies, missing, holds,
 *     classes enforced [always 0 in Phase 2])
 *   - Per-record-class breakdown with platform floors
 *   - Per-org effective view with source classification:
 *       explicit | missing (=> falls back to platform floor)
 *     plus active org-scoped legal holds.
 *   - Last canonical policy-change audit event reference.
 *
 * What it does NOT do:
 *   - Mutate anything.
 *   - Read or call any sweeper.
 *   - Imply enforcement is on. The "Enforcement: NOT WIRED" banner is
 *     non-dismissable for Phase 2.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldAlert, Info, RefreshCw } from "lucide-react";
import { parseEdgeError } from "@/lib/edge-error";

type RecordClass =
  | "matches" | "trade_requests" | "pois" | "wads"
  | "evidence" | "audit_logs" | "email_send_log" | "governance_records";

interface ClassEntry {
  record_class: RecordClass;
  retention_days: number;
  platform_floor_days: number;
  source: "explicit" | "missing" | "fallback";
  policy_id: string | null;
  last_updated_at: string | null;
  last_updated_by: string | null;
  reason: string | null;
  enforcement_wired: boolean;
}

interface OrgEntry {
  org_id: string;
  org_name: string | null;
  active_org_legal_holds: Array<{ id: string; reason: string; applied_at: string }>;
  classes: ClassEntry[];
}

interface ClassBreakdown {
  record_class: RecordClass;
  platform_floor_days: number;
  orgs_with_explicit_policy: number;
  orgs_on_platform_floor: number;
  enforcement_wired: boolean;
}

interface LastRunEvidence {
  run_id: string;
  status: "started" | "success" | "partial" | "failed" | "skipped";
  started_at: string;
  finished_at: string | null;
  rows_seen: number;
  rows_eligible: number;
  rows_purged: number;
  rows_skipped_missing_policy: number;
  rows_skipped_disabled_policy: number;
  rows_skipped_invalid_policy: number;
  rows_skipped_legal_hold: number;
  rows_skipped_error: number;
  details: Record<string, unknown> | null;
}

interface HealthResponse {
  ok: true;
  phase: string;
  enforcement_status: string;
  /**
   * Phase 4 readiness state. One of:
   *   - "phase_4_scheduled_dry_run_active_live_purge_pending_approval"
   *   - "phase_4_dry_run_schedule_missing_check_cron"
   *   - "phase_4_unexpected_live_schedule_present"
   * Surfaced so HQ readers can never mistake the scheduled dry-run
   * for a live (deleting) schedule.
   */
  scheduling_status?: string;
  scheduling_notes?: {
    pg_cron_scheduled: boolean;
    pg_cron_mode?: "dry_run_only" | "LIVE_UNEXPECTED" | "none";
    invocation_mode: string;
    dry_run_default: boolean;
    dry_run_schedules?: Array<{
      jobid: number;
      jobname: string;
      schedule: string;
      active: boolean;
      is_dry_run: boolean;
    }>;
    live_schedules?: Array<{
      jobid: number;
      jobname: string;
      schedule: string;
      active: boolean;
      is_dry_run: boolean;
    }>;
    rollback_sql?: string;
    next_step: string;
  };

  summary: {
    orgs_total: number;
    orgs_with_explicit_policies: number;
    orgs_missing_policies: number;
    policies_below_or_at_floor_blocked_by_db: number;
    active_org_legal_holds: number;
    record_classes_total: number;
    record_classes_enforced: number;
    last_policy_change: null | {
      audit_id: string;
      action: string;
      policy_id: string | null;
      org_id: string | null;
      actor_user_id: string | null;
      created_at: string;
    };
  };
  floors: Record<RecordClass, number>;
  record_classes: RecordClass[];
  class_breakdown: ClassBreakdown[];
  orgs: OrgEntry[];
  orgs_returned: number;
  orgs_truncated: boolean;
  last_run_email_send_log?: LastRunEvidence | null;
  /**
   * DATA-004 Batch 7/9A — cold-storage-archive dry-run-only evidence path.
   * Batch 9A: scheduled dry-run is now expected; live archive scheduling
   * remains gated behind a separate approval.
   */
  cold_storage_archive?: {
    mode: string;
    scheduled: boolean;
    dry_run_default: boolean;
    deletes_source_records: boolean;
    mutates_source_records: boolean;
    consumes_org_retention_policies: boolean;
    scheduling_status?: string;
    dry_run_schedules?: Array<{ jobid: number; jobname: string; schedule: string; active: boolean; is_dry_run: boolean }>;
    live_schedules?: Array<{ jobid: number; jobname: string; schedule: string; active: boolean; is_dry_run: boolean }>;
    rollback_sql?: string;
    last_run: LastRunEvidence | null;
  };

  request_id: string;
}

function sourceBadge(source: ClassEntry["source"], hasHold: boolean) {
  if (hasHold) {
    return <Badge variant="destructive">legal hold (org)</Badge>;
  }
  if (source === "explicit") {
    return <Badge variant="default">explicit</Badge>;
  }
  return <Badge variant="secondary">missing → platform floor</Badge>;
}

export function OrgRetentionHealthPanel() {
  const { toast } = useToast();
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke(
        "admin-org-retention",
        { body: { action: "health", limit_orgs: 200 } },
      );
      if (error) {
        const parsed = await parseEdgeError(error);
        toast({
          title: "Could not load retention health",
          description: parsed.message,
          variant: "destructive",
        });
        return;
      }
      setData(res as HealthResponse);
    } catch (e) {
      const parsed = await parseEdgeError(e);
      toast({
        title: "Could not load retention health",
        description: parsed.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <Alert variant="default" className="border-amber-500/40">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>
          Enforcement status: PARTIAL — only email_send_log is wired ·
          Scheduling: scheduled dry-run ACTIVE · live purge is NOT scheduled
        </AlertTitle>
        <AlertDescription>
          DATA-004 Phase 4 — <strong>scheduled dry-run only</strong>.{" "}
          <code>purge-email-send-log-daily</code> runs daily under pg_cron in{" "}
          <code>dry_run=true</code> mode; it counts and evidences but{" "}
          <strong>cannot delete</strong>. <code>storage-retention-cleanup</code>,{" "}
          <code>account-deletion-sweeper</code>, <code>cold-storage-archive</code>,{" "}
          and every other retention/archival path still do NOT consume{" "}
          <code>org_retention_policies</code>. Missing, disabled, or invalid org
          policies fail closed: rows are retained. Active legal holds block
          purge. <strong>Live purge is NOT scheduled</strong> — moving to a
          live scheduled purge requires a separate approval after dry-run
          evidence review. Rollback at any time:{" "}
          <code>SELECT cron.unschedule('purge-email-send-log-daily-dryrun');</code>
          {data?.scheduling_notes?.pg_cron_mode === "LIVE_UNEXPECTED" && (
            <>
              {" "}
              <strong className="text-destructive">
                ALERT: unexpected LIVE schedule detected — investigate
                immediately and unschedule.
              </strong>
            </>
          )}
          {data?.scheduling_status && (
            <>
              {" "}
              <span className="font-mono text-[11px]">
                scheduling_status=<code>{data.scheduling_status}</code>
              </span>
            </>
          )}
          {(data?.scheduling_notes?.dry_run_schedules?.length ?? 0) > 0 && (
            <>
              {" "}
              <span className="font-mono text-[11px]">
                · dry-run schedules:{" "}
                {data!.scheduling_notes!.dry_run_schedules!
                  .map((j) => `${j.jobname}@${j.schedule}`)
                  .join(", ")}
              </span>
            </>
          )}
        </AlertDescription>
      </Alert>



      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {data ? (
            <>Last loaded {new Date().toLocaleString()} · request_id <code>{data.request_id}</code></>
          ) : (
            "Loading…"
          )}
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          Refresh
        </Button>
      </div>

      {data && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Orgs total" value={data.summary.orgs_total} />
            <Tile label="Explicit policies" value={data.summary.orgs_with_explicit_policies} />
            <Tile label="Missing policies" value={data.summary.orgs_missing_policies} tone="warn" />
            <Tile label="Active org legal holds" value={data.summary.active_org_legal_holds} tone={data.summary.active_org_legal_holds > 0 ? "warn" : "ok"} />
            <Tile label="Record classes" value={data.summary.record_classes_total} />
            <Tile label="Classes enforced" value={data.summary.record_classes_enforced} tone="warn" />
            <Tile
              label="Below-floor (DB-blocked)"
              value={data.summary.policies_below_or_at_floor_blocked_by_db}
              tone="ok"
            />
            <Tile
              label="Last policy change"
              value={
                data.summary.last_policy_change
                  ? new Date(data.summary.last_policy_change.created_at).toLocaleDateString()
                  : "—"
              }
              hint={data.summary.last_policy_change?.action ?? undefined}
            />
          </div>

          {/* Per-class breakdown */}
          <section className="rounded-sm border border-border bg-card">
            <header className="px-4 py-2 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
              Per-class breakdown
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Record class</th>
                    <th className="text-right px-4 py-2">Platform floor (days)</th>
                    <th className="text-right px-4 py-2">Orgs w/ explicit policy</th>
                    <th className="text-right px-4 py-2">Orgs on floor</th>
                    <th className="text-right px-4 py-2">Enforcement</th>
                  </tr>
                </thead>
                <tbody>
                  {data.class_breakdown.map((c) => (
                    <tr key={c.record_class} className="border-t border-border">
                      <td className="px-4 py-2 font-mono text-xs">{c.record_class}</td>
                      <td className="px-4 py-2 text-right">{c.platform_floor_days.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right">{c.orgs_with_explicit_policy}</td>
                      <td className="px-4 py-2 text-right">{c.orgs_on_platform_floor}</td>
                      <td className="px-4 py-2 text-right">
                        {c.enforcement_wired ? (
                          <Badge variant="default">enforced</Badge>
                        ) : (
                          <Badge variant="secondary">not wired</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Phase 3.1 — Latest email_send_log purge run evidence */}
          {data.last_run_email_send_log && (
            <section className="rounded-sm border border-border bg-card">
              <header className="px-4 py-2 border-b border-border text-xs uppercase tracking-wider text-muted-foreground flex justify-between">
                <span>Latest email_send_log purge run (canonical lifecycle = retention_run_evidence)</span>
                <Badge
                  variant={
                    data.last_run_email_send_log.status === "success"
                      ? "default"
                      : data.last_run_email_send_log.status === "failed"
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {data.last_run_email_send_log.status}
                </Badge>
              </header>
              <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <Tile label="Rows seen" value={data.last_run_email_send_log.rows_seen} />
                <Tile label="Rows eligible" value={data.last_run_email_send_log.rows_eligible} />
                <Tile label="Rows purged" value={data.last_run_email_send_log.rows_purged} tone={data.last_run_email_send_log.rows_purged > 0 ? "warn" : "ok"} />
                <Tile label="Missing-policy skips" value={data.last_run_email_send_log.rows_skipped_missing_policy} tone="warn" />
                <Tile label="Disabled-policy skips" value={data.last_run_email_send_log.rows_skipped_disabled_policy} tone="warn" />
                <Tile label="Invalid-policy skips" value={data.last_run_email_send_log.rows_skipped_invalid_policy} tone="warn" />
                <Tile label="Legal-hold skips" value={data.last_run_email_send_log.rows_skipped_legal_hold} tone="warn" />
                <Tile label="Error skips" value={data.last_run_email_send_log.rows_skipped_error} tone={data.last_run_email_send_log.rows_skipped_error > 0 ? "warn" : "ok"} />
              </div>
              <div className="px-4 pb-3 text-[11px] text-muted-foreground space-y-1">
                <div>
                  run_id <code>{data.last_run_email_send_log.run_id}</code> · started{" "}
                  {new Date(data.last_run_email_send_log.started_at).toLocaleString()}
                  {data.last_run_email_send_log.finished_at
                    ? ` · finished ${new Date(data.last_run_email_send_log.finished_at).toLocaleString()}`
                    : ""}
                </div>
                {(() => {
                  const d = data.last_run_email_send_log!.details ?? {};
                  const awf = (d as any).audit_write_failures as Array<unknown> | undefined;
                  const ewf = (d as any).evidence_write_failures as Array<unknown> | undefined;
                  const warn = (awf?.length ?? 0) + (ewf?.length ?? 0);
                  return warn > 0 ? (
                    <div className="text-destructive">
                      ⚠ {awf?.length ?? 0} audit-write failure(s), {ewf?.length ?? 0} evidence-write failure(s) surfaced on this run.
                    </div>
                  ) : (
                    <div>No audit/evidence write failures on this run.</div>
                  );
                })()}
                <div>
                  Per-org <code>skipped</code> rows are mirrored to <code>audit_logs</code>{" "}
                  with real <code>org_id</code>; lifecycle events are evidence-only.
                </div>
              </div>
            </section>
          )}
          {/* Batch 7/9A — cold-storage-archive dry-run-only evidence path */}
          {data.cold_storage_archive && (
            <section className="rounded-sm border border-border bg-card">
              <header className="px-4 py-2 border-b border-border text-xs uppercase tracking-wider text-muted-foreground flex justify-between">
                <span>Cold storage archive — dry-run-only evidence path (Batch 7 / 9A)</span>
                <Badge variant={data.cold_storage_archive.live_schedules && data.cold_storage_archive.live_schedules.length > 0 ? "destructive" : "secondary"}>
                  {data.cold_storage_archive.mode}
                </Badge>
              </header>
              <div className="px-4 py-3 text-xs text-muted-foreground space-y-1">
                <div>
                  Scheduled: <strong>{data.cold_storage_archive.scheduled ? "yes (dry-run)" : "no"}</strong> ·
                  dry-run default: <strong>{String(data.cold_storage_archive.dry_run_default)}</strong> ·
                  deletes source: <strong>{String(data.cold_storage_archive.deletes_source_records)}</strong> ·
                  mutates source: <strong>{String(data.cold_storage_archive.mutates_source_records)}</strong> ·
                  consumes org_retention_policies: <strong>{String(data.cold_storage_archive.consumes_org_retention_policies)}</strong>
                </div>
                <div>
                  Batch 9A schedules exactly one weekly dry-run
                  (<code>cold-storage-archive-dryrun</code>). Live archive scheduling
                  remains gated behind a separate, second approval. Bucket writes,
                  legal-hold, duplicate, missing-source, and lookup-error skips are
                  all written to <code>retention_run_evidence</code>.
                </div>
                {(data.cold_storage_archive.dry_run_schedules ?? []).length > 0 && (
                  <div>
                    Active dry-run schedule(s):{" "}
                    {(data.cold_storage_archive.dry_run_schedules ?? []).map((s) => (
                      <code key={s.jobid} className="mr-2">{s.jobname} ({s.schedule})</code>
                    ))}
                  </div>
                )}
                {(data.cold_storage_archive.live_schedules ?? []).length > 0 && (
                  <div className="text-destructive">
                    ⚠ Unexpected LIVE schedule(s) present:{" "}
                    {(data.cold_storage_archive.live_schedules ?? []).map((s) => (
                      <code key={s.jobid} className="mr-2">{s.jobname} ({s.schedule})</code>
                    ))}
                  </div>
                )}
                {data.cold_storage_archive.rollback_sql && (
                  <div>
                    Rollback: <code>{data.cold_storage_archive.rollback_sql}</code>
                  </div>
                )}
                {data.cold_storage_archive.last_run ? (
                  <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Tile label="Status" value={data.cold_storage_archive.last_run.status} />
                    <Tile label="Rows seen" value={data.cold_storage_archive.last_run.rows_seen} />
                    <Tile label="Eligible (would export)" value={data.cold_storage_archive.last_run.rows_eligible} />
                    <Tile label="Purged" value={data.cold_storage_archive.last_run.rows_purged} tone="ok" />
                    <Tile label="Legal-hold skips" value={data.cold_storage_archive.last_run.rows_skipped_legal_hold} tone="warn" />
                    <Tile label="Error skips" value={data.cold_storage_archive.last_run.rows_skipped_error} tone={data.cold_storage_archive.last_run.rows_skipped_error > 0 ? "warn" : "ok"} />
                  </div>
                ) : (
                  <div className="italic">No cold-storage-archive run evidence yet (first scheduled tick pending).</div>
                )}
              </div>
            </section>
          )}



          {/* Per-org effective view */}
          <section className="rounded-sm border border-border bg-card">
            <header className="px-4 py-2 border-b border-border text-xs uppercase tracking-wider text-muted-foreground flex justify-between">
              <span>Per-org effective posture (explicit policy or active org-hold)</span>
              <span>
                {data.orgs_returned} org(s){data.orgs_truncated ? " · truncated" : ""}
              </span>
            </header>
            {data.orgs.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground flex items-center gap-2">
                <Info className="h-4 w-4" />
                No orgs have explicit retention policies or active org-scoped legal holds.
                All orgs currently fall back to platform floors.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {data.orgs.map((o) => (
                  <li key={o.org_id} className="px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{o.org_name ?? "(unnamed org)"}</div>
                        <div className="text-xs text-muted-foreground font-mono">{o.org_id}</div>
                      </div>
                      {o.active_org_legal_holds.length > 0 && (
                        <Badge variant="destructive">
                          {o.active_org_legal_holds.length} active org-hold
                          {o.active_org_legal_holds.length === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="text-left py-1 pr-3">Class</th>
                            <th className="text-right py-1 pr-3">Effective (days)</th>
                            <th className="text-right py-1 pr-3">Floor</th>
                            <th className="text-left py-1 pr-3">Source</th>
                            <th className="text-left py-1 pr-3">Last updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {o.classes.map((c) => (
                            <tr key={c.record_class} className="border-t border-border/60">
                              <td className="py-1 pr-3 font-mono">{c.record_class}</td>
                              <td className="py-1 pr-3 text-right">{c.retention_days.toLocaleString()}</td>
                              <td className="py-1 pr-3 text-right text-muted-foreground">
                                {c.platform_floor_days.toLocaleString()}
                              </td>
                              <td className="py-1 pr-3">
                                {sourceBadge(c.source, o.active_org_legal_holds.length > 0)}
                              </td>
                              <td className="py-1 pr-3 text-muted-foreground">
                                {c.last_updated_at
                                  ? new Date(c.last_updated_at).toLocaleDateString()
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.summary.last_policy_change && (
            <section className="rounded-sm border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
              <span className="uppercase tracking-wider mr-2">Last policy change:</span>
              <code>{data.summary.last_policy_change.action}</code> ·{" "}
              audit_id <code>{data.summary.last_policy_change.audit_id}</code> ·{" "}
              {new Date(data.summary.last_policy_change.created_at).toLocaleString()}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Tile({
  label, value, tone, hint,
}: { label: string; value: string | number; tone?: "ok" | "warn"; hint?: string }) {
  const toneCls =
    tone === "warn" ? "border-amber-500/40" : tone === "ok" ? "border-emerald-500/40" : "border-border";
  return (
    <div className={`rounded-sm border ${toneCls} bg-card px-4 py-3`}>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1 font-mono">{value}</div>
      {hint && <div className="text-[10px] mt-1 text-muted-foreground font-mono">{hint}</div>}
    </div>
  );
}
