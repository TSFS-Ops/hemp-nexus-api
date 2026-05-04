/**
 * burn-poi-reconciliation — read-only P0 reconciliation report.
 *
 * Purpose
 * ───────
 * Detects two integrity drift conditions between POI minting and the
 * token ledger:
 *
 *   1. BURN_WITHOUT_POI — token_ledger has a burn row referencing a
 *      match_id but no POI exists for that match in the same window.
 *      Indicates either (a) a burn that the POI mint failed to settle
 *      against (paperclip error), or (b) an admin-driven burn outside
 *      the canonical atomic_generate_poi_v2 path.
 *
 *   2. POI_WITHOUT_BURN — pois table has a row in PENDING_APPROVAL,
 *      ELIGIBLE, COMPLETION_REQUESTED or COMPLETED whose org has no
 *      corresponding `action:declare_intent` burn AND no `exempt_burn`
 *      audit row referencing the match. Indicates a POI that was minted
 *      without consuming credits (founder-exemption or a bug in the
 *      atomic burn-then-mint path).
 *
 * Output
 * ──────
 *   {
 *     run_id, started_at, finished_at,
 *     window_days,
 *     burns_without_poi: { count, samples: [...] },
 *     pois_without_burn: { count, samples: [...] },
 *     opened_risk_items: <n>
 *   }
 *
 * Side effects (bounded)
 * ──────────────────────
 *   - One `admin_audit_logs` row per run (`reconciliation.burn_poi.*`)
 *   - One `admin_risk_items` row per *new* drift case (idempotent on
 *     `external_ref` so daily runs don't spam).
 *
 * No data is mutated, no balances are altered. This is a *report*.
 *
 * Auth
 * ────
 *   - `x-internal-key: <INTERNAL_CRON_KEY>` (cron path), OR
 *   - service_role bearer (manual ops).
 *   - Optional: platform_admin bearer for one-off manual runs from the
 *     admin UI (validated via has_role).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { webhookCorsHeaders } from "../_shared/cors.ts";

const corsHeaders = { ...webhookCorsHeaders() };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Default reconciliation window — 7 days. Capped at 30.
const DEFAULT_WINDOW_DAYS = 7;
const HARD_MAX_WINDOW_DAYS = 30;
// Sample cap per drift category for the response payload.
const SAMPLE_CAP = 25;
// Per-row cap to bound query cost.
const ROW_LIMIT = 1000;

interface SweepBody {
  window_days?: number;
  open_risk_items?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const INTERNAL_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

  const internalHeader = req.headers.get("x-internal-key");
  const authHeader = req.headers.get("authorization") ?? "";
  const isInternalCron = !!INTERNAL_KEY && internalHeader === INTERNAL_KEY;
  const isServiceRole =
    SERVICE_ROLE.length > 0 && authHeader === `Bearer ${SERVICE_ROLE}`;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Allow platform_admin bearer too (manual ops button).
  let isPlatformAdmin = false;
  if (!isInternalCron && !isServiceRole && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const { data: userRes } = await admin.auth.getUser(token);
    if (userRes?.user) {
      const { data: hasAdmin } = await admin.rpc("has_role", {
        _user_id: userRes.user.id,
        _role: "platform_admin",
      });
      isPlatformAdmin = !!hasAdmin;
    }
  }

  if (!isInternalCron && !isServiceRole && !isPlatformAdmin) {
    return json(401, { error: "UNAUTHORIZED" });
  }

  let body: SweepBody = {};
  try {
    const txt = await req.text();
    if (txt.trim().length > 0) body = JSON.parse(txt) as SweepBody;
  } catch {
    return json(400, { error: "INVALID_JSON" });
  }

  const windowDays = Math.min(
    HARD_MAX_WINDOW_DAYS,
    Math.max(1, Number.isFinite(body.window_days) ? Number(body.window_days) : DEFAULT_WINDOW_DAYS),
  );
  // Default true for cron, false for ad-hoc inspection if explicitly set.
  const openRiskItems = body.open_risk_items !== false;

  const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  // ── 1. BURN_WITHOUT_POI ────────────────────────────────────────────
  // Pull burn rows tagged `action:declare_intent` in window.
  // request_id holds the match_id (per atomic_generate_poi_v2 contract).
  const { data: burnRows, error: burnErr } = await admin
    .from("token_ledger")
    .select("id, org_id, request_id, tokens_burned, action_type, endpoint, created_at, metadata")
    .eq("action_type", "burn")
    .ilike("endpoint", "action:declare_intent%")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);

  if (burnErr) {
    console.error("[burn-poi-reconciliation] burn fetch failed:", burnErr);
    return json(500, { error: "BURN_FETCH_FAILED", detail: burnErr.message });
  }

  const burnsWithoutPoi: Array<Record<string, unknown>> = [];
  const burnMatchIdSet = new Set<string>();
  for (const row of burnRows ?? []) {
    const matchId = (row.request_id ?? "").toString().trim();
    if (matchId.length === 0) continue;
    burnMatchIdSet.add(matchId);
  }

  if (burnMatchIdSet.size > 0) {
    const matchIds = Array.from(burnMatchIdSet);
    const { data: poiHits, error: poiHitErr } = await admin
      .from("pois")
      .select("match_id")
      .in("match_id", matchIds);

    if (poiHitErr) {
      console.error("[burn-poi-reconciliation] poi-by-match fetch failed:", poiHitErr);
      return json(500, { error: "POI_LOOKUP_FAILED", detail: poiHitErr.message });
    }
    const poiMatchIdSet = new Set(
      (poiHits ?? []).map((p) => (p as { match_id: string }).match_id),
    );

    for (const row of burnRows ?? []) {
      const matchId = (row.request_id ?? "").toString().trim();
      if (matchId.length === 0) continue;
      if (poiMatchIdSet.has(matchId)) continue;
      burnsWithoutPoi.push({
        ledger_id: row.id,
        org_id: row.org_id,
        match_id: matchId,
        tokens_burned: row.tokens_burned,
        endpoint: row.endpoint,
        created_at: row.created_at,
      });
    }
  }

  // ── 2. POI_WITHOUT_BURN ────────────────────────────────────────────
  // Pull pois minted in window in any state where credits should have
  // been spent (founder-exemption is captured by audit_logs.action='exempt_burn').
  const { data: poiRows, error: poiErr } = await admin
    .from("pois")
    .select("id, match_id, org_id, state, created_at")
    .in("state", ["PENDING_APPROVAL", "ELIGIBLE", "COMPLETION_REQUESTED", "COMPLETED"])
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);

  if (poiErr) {
    console.error("[burn-poi-reconciliation] poi fetch failed:", poiErr);
    return json(500, { error: "POI_FETCH_FAILED", detail: poiErr.message });
  }

  const poisWithoutBurn: Array<Record<string, unknown>> = [];
  const poiMatchIds = (poiRows ?? []).map((p) => (p as { match_id: string }).match_id).filter(Boolean);

  let burnHits = new Set<string>();
  let exemptHits = new Set<string>();

  if (poiMatchIds.length > 0) {
    const [{ data: burnLookup }, { data: exemptLookup }] = await Promise.all([
      admin
        .from("token_ledger")
        .select("request_id")
        .eq("action_type", "burn")
        .ilike("endpoint", "action:declare_intent%")
        .in("request_id", poiMatchIds),
      admin
        .from("audit_logs")
        .select("metadata")
        .eq("action", "exempt_burn")
        .gte("created_at", sinceIso)
        .limit(ROW_LIMIT),
    ]);
    burnHits = new Set(
      (burnLookup ?? [])
        .map((r) => (r as { request_id: string | null }).request_id ?? "")
        .filter(Boolean),
    );
    exemptHits = new Set(
      (exemptLookup ?? [])
        .map((r) => (r as { metadata: Record<string, unknown> | null }).metadata?.match_id)
        .filter((v): v is string => typeof v === "string"),
    );

    for (const p of poiRows ?? []) {
      const row = p as { id: string; match_id: string; org_id: string; state: string; created_at: string };
      if (!row.match_id) continue;
      if (burnHits.has(row.match_id) || exemptHits.has(row.match_id)) continue;
      poisWithoutBurn.push({
        poi_id: row.id,
        match_id: row.match_id,
        org_id: row.org_id,
        state: row.state,
        created_at: row.created_at,
      });
    }
  }

  // ── 3. Optional: open admin_risk_items per drift case (idempotent) ─
  let openedRiskItems = 0;
  if (openRiskItems) {
    for (const drift of burnsWithoutPoi) {
      const externalRef = `recon:burn_without_poi:${drift.ledger_id}`;
      try {
        const { error: insErr } = await admin.from("admin_risk_items").insert({
          title: `Reconciliation: burn without POI (${(drift.match_id as string).slice(0, 8)}…)`,
          description: `token_ledger row ${drift.ledger_id} burned ${drift.tokens_burned} credits for org ${drift.org_id} against match ${drift.match_id} but no POI exists. Manual investigation required.`,
          severity: "high",
          status: "open",
          external_ref: externalRef,
        });
        if (!insErr) openedRiskItems++;
      } catch (e) {
        console.error("[burn-poi-reconciliation] risk insert failed:", e);
      }
    }
    for (const drift of poisWithoutBurn) {
      const externalRef = `recon:poi_without_burn:${drift.poi_id}`;
      try {
        const { error: insErr } = await admin.from("admin_risk_items").insert({
          title: `Reconciliation: POI without burn (${(drift.match_id as string).slice(0, 8)}…)`,
          description: `POI ${drift.poi_id} (state=${drift.state}) for org ${drift.org_id} on match ${drift.match_id} has no matching burn or exemption. Manual investigation required.`,
          severity: "high",
          status: "open",
          external_ref: externalRef,
        });
        if (!insErr) openedRiskItems++;
      } catch (e) {
        console.error("[burn-poi-reconciliation] risk insert failed:", e);
      }
    }
  }

  // ── 4. Audit row ───────────────────────────────────────────────────
  try {
    await admin.from("admin_audit_logs").insert({
      admin_user_id: null,
      action: "reconciliation.burn_poi.run",
      target_type: "system",
      target_id: null,
      details: {
        run_id: runId,
        window_days: windowDays,
        burns_without_poi: burnsWithoutPoi.length,
        pois_without_burn: poisWithoutBurn.length,
        opened_risk_items: openedRiskItems,
        source: "burn-poi-reconciliation",
      },
    });
  } catch (e) {
    console.error("[burn-poi-reconciliation] audit insert failed:", e);
  }

  return json(200, {
    run_id: runId,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    window_days: windowDays,
    burns_without_poi: {
      count: burnsWithoutPoi.length,
      samples: burnsWithoutPoi.slice(0, SAMPLE_CAP),
    },
    pois_without_burn: {
      count: poisWithoutBurn.length,
      samples: poisWithoutBurn.slice(0, SAMPLE_CAP),
    },
    opened_risk_items: openedRiskItems,
  });
});
