/**
 * P-5 Batch 8 — Phase 5
 * Admin / compliance provider-dependency workbench.
 *
 * Reads exclusively via Phase 4 `p5b8_read_*` projections (through
 * @/lib/p5-batch8/api). Phase 3 write RPCs are only invoked through the
 * same wrapper module. No direct table access. No raw payloads rendered.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  P5B8DataTable,
  P5B8Empty,
  P5B8ErrorState,
  P5B8Loading,
  P5B8PageShell,
  P5B8SectionCard,
  P5B8StatusBadge,
} from "@/components/p5-batch8/WorkbenchShell";
import {
  readAuditSummary,
  readDecisionSummary,
  readDependencyStatusSummary,
  readLinkSummary,
  readProviderConfigSummary,
  readQueueSummary,
  readRequestSummary,
  readResultSummary,
  readRetrySummary,
  readWebhookSummary,
  type P5B8AuditSummary,
  type P5B8DecisionSummary,
  type P5B8DependencyStatusSummary,
  type P5B8LinkSummary,
  type P5B8ProviderConfigSummary,
  type P5B8QueueSummary,
  type P5B8RequestSummary,
  type P5B8ResultSummary,
  type P5B8RetrySummary,
  type P5B8WebhookSummary,
} from "@/lib/p5-batch8/api";

function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fn();
      setData(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}

function renderDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return s;
  }
}

function Pane<T>({
  loading,
  error,
  data,
  emptyLabel,
  children,
}: {
  loading: boolean;
  error: string | null;
  data: T[] | null;
  emptyLabel: string;
  children: (rows: T[]) => JSX.Element;
}) {
  if (loading) return <P5B8Loading />;
  if (error) return <P5B8ErrorState message={error} />;
  if (!data || data.length === 0) return <P5B8Empty label={emptyLabel} />;
  return children(data);
}

// ── Tabs ────────────────────────────────────────────────────────────────────

function QueueTab() {
  const q = useAsync<P5B8QueueSummary[]>(() => readQueueSummary(), []);
  const c = useAsync<P5B8ProviderConfigSummary[]>(() => readProviderConfigSummary(), []);
  return (
    <div className="space-y-4">
      <P5B8SectionCard
        title="Dashboard / queue summary"
        description="Counts per provider category and dependency state. Counts only — no raw payloads."
      >
        <Pane
          loading={q.loading}
          error={q.error}
          data={q.data}
          emptyLabel="No dependency status rows recorded yet."
        >
          {(rows) => (
            <P5B8DataTable
              columns={[
                { key: "provider_category", label: "Provider category" },
                { key: "provider_dependency_status", label: "Dependency status" },
                { key: "count", label: "Count" },
              ]}
              rows={rows.map((r) => ({
                provider_category: <code>{r.provider_category}</code>,
                provider_dependency_status: <P5B8StatusBadge value={r.provider_dependency_status} />,
                count: r.count,
              }))}
            />
          )}
        </Pane>
      </P5B8SectionCard>

      <P5B8SectionCard
        title="Provider configuration summary"
        description="Live status reflects activation sign-off only. Credentials are never displayed."
      >
        <Pane
          loading={c.loading}
          error={c.error}
          data={c.data}
          emptyLabel="No provider configurations recorded yet."
        >
          {(rows) => (
            <P5B8DataTable
              columns={[
                { key: "provider_category", label: "Category" },
                { key: "live_now", label: "Live now" },
                { key: "hidden_until_live", label: "Hidden until live" },
                { key: "commercial_owner", label: "Commercial owner" },
                { key: "approval_owner", label: "Approval owner" },
                { key: "activation_signoff_owner", label: "Sign-off owner" },
                { key: "activation_signed_off_at", label: "Signed off at" },
                { key: "updated_at", label: "Updated" },
              ]}
              rows={rows.map((r) => ({
                provider_category: <code>{r.provider_category}</code>,
                live_now: r.live_now ? "yes" : "no",
                hidden_until_live: r.hidden_until_live ? "yes" : "no",
                commercial_owner: r.commercial_owner,
                approval_owner: r.approval_owner,
                activation_signoff_owner: r.activation_signoff_owner,
                activation_signed_off_at: renderDateTime(r.activation_signed_off_at),
                updated_at: renderDateTime(r.updated_at),
              }))}
            />
          )}
        </Pane>
      </P5B8SectionCard>
    </div>
  );
}

function DependencyTab() {
  const d = useAsync<P5B8DependencyStatusSummary[]>(() => readDependencyStatusSummary(), []);
  return (
    <P5B8SectionCard
      title="Provider dependency status summary"
      description="Per-subject / per-case dependency state. Distinct from provider-verified."
    >
      <Pane loading={d.loading} error={d.error} data={d.data} emptyLabel="No dependency rows.">
        {(rows) => (
          <P5B8DataTable
            columns={[
              { key: "provider_category", label: "Category" },
              { key: "subject_id", label: "Subject" },
              { key: "case_id", label: "Case" },
              { key: "provider_dependency_status", label: "Dependency status" },
              { key: "provider_environment", label: "Env" },
              { key: "is_stale", label: "Stale" },
              { key: "stale_as_of", label: "Stale as of" },
              { key: "updated_at", label: "Updated" },
            ]}
            rows={rows.map((r) => ({
              provider_category: <code>{r.provider_category}</code>,
              subject_id: r.subject_id ?? "—",
              case_id: r.case_id ?? "—",
              provider_dependency_status: <P5B8StatusBadge value={r.provider_dependency_status} />,
              provider_environment: r.provider_environment,
              is_stale: r.is_stale ? "yes" : "no",
              stale_as_of: renderDateTime(r.stale_as_of),
              updated_at: renderDateTime(r.updated_at),
            }))}
          />
        )}
      </Pane>
    </P5B8SectionCard>
  );
}

function RequestsResultsTab() {
  const req = useAsync<P5B8RequestSummary[]>(() => readRequestSummary(), []);
  const res = useAsync<P5B8ResultSummary[]>(() => readResultSummary(), []);
  const dec = useAsync<P5B8DecisionSummary[]>(() => readDecisionSummary(), []);
  return (
    <div className="space-y-4">
      <P5B8SectionCard
        title="Provider request summary"
        description="Request reference, environment and lifecycle status. No raw payloads."
      >
        <Pane loading={req.loading} error={req.error} data={req.data} emptyLabel="No provider requests recorded.">
          {(rows) => (
            <P5B8DataTable
              columns={[
                { key: "provider_category", label: "Category" },
                { key: "provider_environment", label: "Env" },
                { key: "request_reference", label: "Reference" },
                { key: "status", label: "Status" },
                { key: "case_id", label: "Case" },
                { key: "requested_at", label: "Requested" },
              ]}
              rows={rows.map((r) => ({
                provider_category: <code>{r.provider_category}</code>,
                provider_environment: r.provider_environment,
                request_reference: <code>{r.request_reference}</code>,
                status: <P5B8StatusBadge value={r.status} />,
                case_id: r.case_id ?? "—",
                requested_at: renderDateTime(r.requested_at),
              }))}
            />
          )}
        </Pane>
      </P5B8SectionCard>

      <P5B8SectionCard
        title="Provider result summary"
        description="Result status and summary text only. Raw provider payloads are never displayed."
      >
        <Pane loading={res.loading} error={res.error} data={res.data} emptyLabel="No provider results received.">
          {(rows) => (
            <P5B8DataTable
              columns={[
                { key: "provider_category", label: "Category" },
                { key: "provider_environment", label: "Env" },
                { key: "provider_reference", label: "Provider ref" },
                { key: "result_status", label: "Result status" },
                { key: "result_summary", label: "Result summary" },
                { key: "received_at", label: "Received" },
              ]}
              rows={rows.map((r) => ({
                provider_category: <code>{r.provider_category}</code>,
                provider_environment: r.provider_environment,
                provider_reference: r.provider_reference ?? "—",
                result_status: <P5B8StatusBadge value={r.result_status} />,
                result_summary: r.result_summary ?? "—",
                received_at: renderDateTime(r.received_at),
              }))}
            />
          )}
        </Pane>
      </P5B8SectionCard>

      <P5B8SectionCard
        title="Provider decision summary"
        description="Recorded decision states with reason / evidence reference. Fallback decisions are flagged."
      >
        <Pane loading={dec.loading} error={dec.error} data={dec.data} emptyLabel="No decisions recorded.">
          {(rows) => (
            <P5B8DataTable
              columns={[
                { key: "provider_category", label: "Category" },
                { key: "provider_decision_state", label: "Decision state" },
                { key: "is_fallback", label: "Fallback" },
                { key: "is_final", label: "Final" },
                { key: "reason", label: "Reason" },
                { key: "evidence_reference", label: "Evidence ref" },
                { key: "set_by_role", label: "Set-by role" },
                { key: "created_at", label: "Recorded" },
              ]}
              rows={rows.map((r) => ({
                provider_category: <code>{r.provider_category}</code>,
                provider_decision_state: <P5B8StatusBadge value={r.provider_decision_state} />,
                is_fallback: r.is_fallback ? "manual fallback decision" : "no",
                is_final: r.is_final ? "yes" : "no",
                reason: r.reason ?? "—",
                evidence_reference: r.evidence_reference ?? "—",
                set_by_role: r.set_by_role ?? "—",
                created_at: renderDateTime(r.created_at),
              }))}
            />
          )}
        </Pane>
      </P5B8SectionCard>
    </div>
  );
}

function WebhookAuditTab() {
  const w = useAsync<P5B8WebhookSummary[]>(() => readWebhookSummary(), []);
  const a = useAsync<P5B8AuditSummary[]>(() => readAuditSummary(), []);
  return (
    <div className="space-y-4">
      <P5B8SectionCard
        title="Webhook ledger summary"
        description="Event metadata only. Raw webhook payloads and signature secrets are never displayed."
      >
        <Pane loading={w.loading} error={w.error} data={w.data} emptyLabel="No webhook events recorded.">
          {(rows) => (
            <P5B8DataTable
              columns={[
                { key: "provider_category", label: "Category" },
                { key: "webhook_event", label: "Event" },
                { key: "provider_environment", label: "Env" },
                { key: "signature_status", label: "Signature" },
                { key: "received_at", label: "Received" },
              ]}
              rows={rows.map((r) => ({
                provider_category: <code>{r.provider_category}</code>,
                webhook_event: <code>{r.webhook_event}</code>,
                provider_environment: r.provider_environment,
                signature_status: <P5B8StatusBadge value={r.signature_status} />,
                received_at: renderDateTime(r.received_at),
              }))}
            />
          )}
        </Pane>
      </P5B8SectionCard>

      <P5B8SectionCard
        title="Audit timeline summary"
        description="p5b8.* events only. Internal details JSON is intentionally omitted from this surface."
      >
        <Pane loading={a.loading} error={a.error} data={a.data} emptyLabel="No audit events recorded.">
          {(rows) => (
            <P5B8DataTable
              columns={[
                { key: "event_code", label: "Event" },
                { key: "provider_category", label: "Category" },
                { key: "case_id", label: "Case" },
                { key: "actor_role", label: "Actor role" },
                { key: "created_at", label: "When" },
              ]}
              rows={rows.map((r) => ({
                event_code: <code>{r.event_code}</code>,
                provider_category: r.provider_category ? <code>{r.provider_category}</code> : "—",
                case_id: r.case_id ?? "—",
                actor_role: r.actor_role ?? "—",
                created_at: renderDateTime(r.created_at),
              }))}
            />
          )}
        </Pane>
      </P5B8SectionCard>
    </div>
  );
}

function RetryLinksTab() {
  const r = useAsync<P5B8RetrySummary[]>(() => readRetrySummary(), []);
  const l = useAsync<P5B8LinkSummary[]>(() => readLinkSummary(), []);
  return (
    <div className="space-y-4">
      <P5B8SectionCard
        title="Retry / failure / fallback summary"
        description="Operational retry posture per request. No raw technical errors are exposed."
      >
        <Pane loading={r.loading} error={r.error} data={r.data} emptyLabel="No retry state recorded.">
          {(rows) => (
            <P5B8DataTable
              columns={[
                { key: "provider_category", label: "Category" },
                { key: "attempt_count", label: "Attempts" },
                { key: "last_error_class", label: "Last error class" },
                { key: "fallback_status", label: "Fallback route" },
                { key: "next_retry_at", label: "Next retry" },
                { key: "updated_at", label: "Updated" },
              ]}
              rows={rows.map((row) => ({
                provider_category: <code>{row.provider_category}</code>,
                attempt_count: row.attempt_count,
                last_error_class: row.last_error_class ?? "—",
                fallback_status: row.fallback_status ?? "—",
                next_retry_at: renderDateTime(row.next_retry_at),
                updated_at: renderDateTime(row.updated_at),
              }))}
            />
          )}
        </Pane>
      </P5B8SectionCard>

      <P5B8SectionCard
        title="Memory / finality link summary"
        description="Reference IDs only. Batch 5 Memory and Batch 4 Finality tables are never mutated or read here."
      >
        <Pane loading={l.loading} error={l.error} data={l.data} emptyLabel="No Memory / finality links recorded.">
          {(rows) => (
            <P5B8DataTable
              columns={[
                { key: "link_type", label: "Link type" },
                { key: "provider_decision_id", label: "Decision" },
                { key: "memory_record_id", label: "Memory ref" },
                { key: "finality_record_id", label: "Finality ref" },
                { key: "created_at", label: "When" },
              ]}
              rows={rows.map((row) => ({
                link_type: <P5B8StatusBadge value={row.link_type} />,
                provider_decision_id: row.provider_decision_id,
                memory_record_id: row.memory_record_id ?? "—",
                finality_record_id: row.finality_record_id ?? "—",
                created_at: renderDateTime(row.created_at),
              }))}
            />
          )}
        </Pane>
      </P5B8SectionCard>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function P5Batch8Workbench() {
  const tabs = useMemo(
    () => [
      { value: "queue", label: "Queue & configs", Component: QueueTab },
      { value: "dependency", label: "Dependency status", Component: DependencyTab },
      { value: "requests", label: "Requests / results / decisions", Component: RequestsResultsTab },
      { value: "webhook", label: "Webhook & audit", Component: WebhookAuditTab },
      { value: "retry", label: "Retry & links", Component: RetryLinksTab },
    ],
    [],
  );

  return (
    <P5B8PageShell
      title="Provider dependency workbench"
      subtitle="P-5 Batch 8 — Provider-Ready Structures & External Dependency Labelling (Phase 5 admin surface, read-only over Phase 4 projections)."
    >
      <Tabs defaultValue="queue" className="w-full">
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map(({ value, Component }) => (
          <TabsContent key={value} value={value} className="mt-4">
            <Component />
          </TabsContent>
        ))}
      </Tabs>
    </P5B8PageShell>
  );
}
