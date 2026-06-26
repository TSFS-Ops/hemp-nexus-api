/**
 * P-5 Screening — Phase 5 admin review queue / readiness workbench.
 *
 * Read-only admin tool: operators paste a subject_id and a gate to view the
 * Phase 4 API-safe projection. No direct table access; no write controls in
 * this phase. SSOT allowed wording only. Mandatory provider-ready disclaimer
 * rendered on every load.
 */
import { useState } from "react";
import {
  p5scrFetchGateReadiness,
  p5scrFetchSubjectStatus,
  type P5ScrGateReadiness,
  type P5ScrSubjectStatus,
} from "@/lib/p5-screening/api";

const GATES = [
  "poi_create",
  "poi_accept",
  "wad_create",
  "wad_seal",
  "trade_approval",
  "funder_visibility",
  "funder_ready",
  "finality",
  "api_ready_true",
] as const;

const DISCLAIMER =
  "Provider-ready is not provider-verified. No live provider calls have been made; status reflects internal screening state only.";

export default function P5ScreeningWorkbench() {
  const [subjectId, setSubjectId] = useState("");
  const [gate, setGate] = useState<(typeof GATES)[number]>("wad_seal");
  const [subjectStatus, setSubjectStatus] = useState<P5ScrSubjectStatus | null>(null);
  const [gateReadiness, setGateReadiness] = useState<P5ScrGateReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLoad() {
    setLoading(true);
    setError(null);
    setSubjectStatus(null);
    setGateReadiness(null);
    try {
      const [status, readiness] = await Promise.all([
        p5scrFetchSubjectStatus(subjectId),
        p5scrFetchGateReadiness(subjectId, gate),
      ]);
      setSubjectStatus(status);
      setGateReadiness(readiness);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container mx-auto py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Screening &amp; IDV Workbench</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Internal admin review queue for the provider-ready screening &amp; IDV flow.
        </p>
      </header>

      <section
        role="alert"
        className="rounded-md border border-border bg-muted/50 p-4 text-sm"
      >
        <strong>Notice:</strong> {DISCLAIMER}
      </section>

      <section className="rounded-md border border-border bg-card p-4 space-y-3">
        <label className="block text-sm font-medium" htmlFor="p5scr-subject">
          Subject ID
        </label>
        <input
          id="p5scr-subject"
          type="text"
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
        />
        <label className="block text-sm font-medium" htmlFor="p5scr-gate">
          Gate
        </label>
        <select
          id="p5scr-gate"
          value={gate}
          onChange={(e) => setGate(e.target.value as (typeof GATES)[number])}
          className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
        >
          {GATES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleLoad}
          disabled={!subjectId || loading}
          className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load readiness"}
        </button>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {subjectStatus ? (
        <section className="rounded-md border border-border bg-card p-4 space-y-2">
          <h2 className="text-lg font-medium">Subject status</h2>
          <ul className="text-sm space-y-1">
            <li>ready: {String(subjectStatus.ready)}</li>
            <li>admin_review_required: {String(subjectStatus.admin_review_required)}</li>
            <li>provider_pending: {String(subjectStatus.provider_pending)}</li>
            <li>retry_pending: {String(subjectStatus.retry_pending)}</li>
          </ul>
          <h3 className="text-sm font-medium mt-3">Blockers</h3>
          <ul className="text-sm space-y-1">
            {subjectStatus.blockers.length === 0 ? (
              <li className="text-muted-foreground">None</li>
            ) : (
              subjectStatus.blockers.map((b, i) => (
                <li key={i}>
                  <span className="font-mono">{b.affected_check}</span>
                  {b.readiness_status ? ` — ${b.readiness_status}` : null}
                </li>
              ))
            )}
          </ul>
        </section>
      ) : null}

      {gateReadiness ? (
        <section className="rounded-md border border-border bg-card p-4 space-y-2">
          <h2 className="text-lg font-medium">Gate readiness — {gate}</h2>
          <p className="text-sm">ready: {String(gateReadiness.ready)}</p>
          {gateReadiness.readiness_status ? (
            <p className="text-sm">status: {gateReadiness.readiness_status}</p>
          ) : null}
          <ul className="text-sm space-y-1">
            {gateReadiness.blockers.map((b, i) => (
              <li key={i}>
                <span className="font-mono">{b.affected_check}</span>
                {b.readiness_status ? ` — ${b.readiness_status}` : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
