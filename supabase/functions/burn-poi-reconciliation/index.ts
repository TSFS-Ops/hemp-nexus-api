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
import { resolveNotificationsFor } from "../_shared/resolve-notifications.ts";

const corsHeaders = { ...webhookCorsHeaders() };

/**
 * Engagement statuses that imply a POI is expected to exist on the match.
 * Soft-route pending states (pending, notification_sent, contacted) are
 * legitimately POI-less and MUST NOT be flagged as drift.
 */
const ENGAGEMENT_STATUSES_REQUIRING_POI = new Set<string>([
  "accepted",
  "late_acceptance_pending_initiator_reconfirmation",
  "disputed_being_named",
]);

/**
 * WaD/POI consistency note:
 *
 *   wads has poi_id, buyer_org_id, seller_org_id, canonical_payload_json, status.
 *   pois has match_id, org_id, state.
 *   matches has buyer_org_id, seller_org_id.
 *
 * The schema does not currently materialise a terms-hash on pois that we can
 * compare against wads.canonical_payload_json deterministically — POI terms
 * live on matches (commodity, price, quantity, terms). For this reason the
 * WaD/POI detector below covers only the linkage-and-state drift that the
 * schema can prove:
 *   - sealed wad whose linked poi_id no longer exists
 *   - sealed wad linked to a poi in a non-terminal state (not COMPLETED/ELIGIBLE)
 *   - sealed wad whose buyer/seller_org_id disagree with the poi.match
 *     buyer/seller_org_id
 * Terms-hash drift is intentionally not asserted; it would produce false
 * positives without a canonical hash column. Documented in tests.
 */

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

// AUD-003 Fix 2: idempotent self-incident writer for reconciliation failures.
async function recordSelfIncident(
  admin: ReturnType<typeof createClient>,
  runId: string,
  err: unknown,
) {
  const title = "Reconciliation: burn-poi-reconciliation run failed";
  const message = err instanceof Error ? err.message : String(err);
  const description =
    `burn-poi-reconciliation failed at ${new Date().toISOString()}. ` +
    `run_id=${runId} error=${message}. The drift safety net did not complete; manual investigation required.`;
  try {
    const { data: existing } = await admin
      .from("admin_risk_items")
      .select("id")
      .eq("title", title)
      .eq("status", "open")
      .limit(1)
      .maybeSingle();
    if (existing) return;
    await admin.from("admin_risk_items").insert({
      title,
      description,
      severity: "high",
      status: "open",
    });
  } catch (e) {
    console.error("[burn-poi-reconciliation] self-incident insert failed:", e);
  }
  try {
    await admin.from("admin_audit_logs").insert({
      admin_user_id: null,
      action: "reconciliation.burn_poi.failed",
      target_type: "system",
      target_id: null,
      details: { run_id: runId, error: message, source: "burn-poi-reconciliation" },
    });
  } catch (e) {
    console.error("[burn-poi-reconciliation] failure-audit insert failed:", e);
  }
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

  try {

  // ── 1. BURN_WITHOUT_POI ────────────────────────────────────────────
  // Pull burn rows tagged `action:declare_intent` in window.
  // request_id holds the match_id (per atomic_generate_poi_v2 contract).
  const { data: burnRows, error: burnErr } = await admin
    .from("token_ledger")
    .select("id, org_id, request_id, tokens_burned, action_type, endpoint, created_at, metadata")
    .eq("action_type", "declare_intent")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);

  if (burnErr) {
    console.error("[burn-poi-reconciliation] burn fetch failed:", burnErr);
    throw new Error(`BURN_FETCH_FAILED: ${burnErr.message}`);
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
      throw new Error(`POI_LOOKUP_FAILED: ${poiHitErr.message}`);
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
    throw new Error(`POI_FETCH_FAILED: ${poiErr.message}`);
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
        .eq("action_type", "declare_intent")
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

  // ── 3. STATE_WITHOUT_LEDGER (POI-012) ──────────────────────────────
  // Detect matches whose state says POI was minted but for which no
  // ledger_events.poi.minted row exists. This is *state-vs-ledger drift*
  // and is distinct from BURN_WITHOUT_POI / POI_WITHOUT_BURN above.
  const { data: mintedMatches, error: mintedErr } = await admin
    .from("matches")
    .select("id, org_id, state, status, updated_at, created_at")
    .in("state", ["intent_declared", "counterparty_sighted", "committed", "completed"])
    .gte("updated_at", sinceIso)
    .order("updated_at", { ascending: false })
    .limit(ROW_LIMIT);

  if (mintedErr) {
    console.error("[burn-poi-reconciliation] minted-matches fetch failed:", mintedErr);
    throw new Error(`MINTED_MATCH_FETCH_FAILED: ${mintedErr.message}`);
  }

  const stateWithoutLedger: Array<Record<string, unknown>> = [];
  const mintedMatchIds = (mintedMatches ?? []).map((m) => (m as { id: string }).id).filter(Boolean);

  if (mintedMatchIds.length > 0) {
    const { data: mintedLedgerRows, error: mintedLedgerErr } = await admin
      .from("ledger_events")
      .select("match_id")
      .eq("event_type", "poi.minted")
      .in("match_id", mintedMatchIds);

    if (mintedLedgerErr) {
      console.error("[burn-poi-reconciliation] minted-ledger fetch failed:", mintedLedgerErr);
      throw new Error(`MINTED_LEDGER_FETCH_FAILED: ${mintedLedgerErr.message}`);
    }

    const ledgerMatchIds = new Set(
      (mintedLedgerRows ?? []).map((r) => (r as { match_id: string | null }).match_id).filter(Boolean),
    );

    for (const m of mintedMatches ?? []) {
      const row = m as { id: string; org_id: string; state: string; status: string; updated_at: string; created_at: string };
      if (ledgerMatchIds.has(row.id)) continue;
      stateWithoutLedger.push({
        match_id: row.id,
        org_id: row.org_id,
        state: row.state,
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    }
  }

  // ── 4. MINTED_WITHOUT_ENGAGEMENT (AUD-003 Fix 3) ───────────────────
  // A minted match (state in minted set OR with a declare_intent burn in window)
  // must have at least one current poi_engagements row. Engagement self-heal
  // happens opportunistically on user action; this probe is the after-the-fact
  // safety net so admin sees orphans even if the user never returns.
  const mintedWithoutEngagement: Array<Record<string, unknown>> = [];
  // Union the minted match ids with any match ids referenced by a burn in window
  // (covers cases where state didn't move but a burn happened, e.g. partial mint).
  const candidateMatchIds = new Set<string>(mintedMatchIds);
  for (const id of burnMatchIdSet) candidateMatchIds.add(id);

  if (candidateMatchIds.size > 0) {
    const ids = Array.from(candidateMatchIds);
    const { data: engagementHits, error: engErr } = await admin
      .from("poi_engagements")
      .select("match_id, engagement_status")
      .in("match_id", ids);

    if (engErr) {
      console.error("[burn-poi-reconciliation] engagement fetch failed:", engErr);
      throw new Error(`ENGAGEMENT_FETCH_FAILED: ${engErr.message}`);
    }

    const matchesWithCurrentEng = new Set<string>();
    for (const e of engagementHits ?? []) {
      const row = e as { match_id: string | null; engagement_status: string | null };
      if (!row.match_id) continue;
      const s = (row.engagement_status ?? "").toString();
      if (s === "expired" || s === "declined" || s === "cancelled_email_change") continue;
      matchesWithCurrentEng.add(row.match_id);
    }

    // Build a quick lookup for match metadata (org_id, state) using whichever
    // source we already have in memory.
    const metaByMatchId = new Map<string, { org_id?: string | null; state?: string | null }>();
    for (const m of mintedMatches ?? []) {
      const row = m as { id: string; org_id: string; state: string };
      metaByMatchId.set(row.id, { org_id: row.org_id, state: row.state });
    }
    for (const b of burnRows ?? []) {
      const row = b as { request_id: string | null; org_id: string };
      const id = (row.request_id ?? "").toString().trim();
      if (id && !metaByMatchId.has(id)) metaByMatchId.set(id, { org_id: row.org_id, state: null });
    }

    for (const id of ids) {
      if (matchesWithCurrentEng.has(id)) continue;
      const meta = metaByMatchId.get(id) ?? {};
      mintedWithoutEngagement.push({
        match_id: id,
        org_id: meta.org_id ?? null,
        state: meta.state ?? null,
      });
    }
  }

  // ── 4a. ENGAGEMENT_WITHOUT_POI (Batch V REC-002, reverse direction) ─
  // For every poi_engagement whose status implies a POI must exist on the
  // match (accepted / late-acceptance / disputed), assert that a pois row
  // exists for that match_id. Soft-route pending statuses (pending,
  // notification_sent, contacted) are excluded.
  const engagementWithoutPoi: Array<Record<string, unknown>> = [];
  {
    const { data: activeEngagements, error: aeErr } = await admin
      .from("poi_engagements")
      .select("id, match_id, org_id, engagement_status, created_at")
      .in("engagement_status", Array.from(ENGAGEMENT_STATUSES_REQUIRING_POI))
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT);
    if (aeErr) {
      console.error("[burn-poi-reconciliation] active engagement fetch failed:", aeErr);
      throw new Error(`ACTIVE_ENGAGEMENT_FETCH_FAILED: ${aeErr.message}`);
    }
    const activeMatchIds = Array.from(
      new Set(
        (activeEngagements ?? [])
          .map((e) => (e as { match_id: string | null }).match_id)
          .filter((v): v is string => !!v),
      ),
    );
    let poiCoverage = new Set<string>();
    if (activeMatchIds.length > 0) {
      const { data: poiHits, error: poiCovErr } = await admin
        .from("pois")
        .select("match_id")
        .in("match_id", activeMatchIds);
      if (poiCovErr) {
        console.error("[burn-poi-reconciliation] poi coverage fetch failed:", poiCovErr);
        throw new Error(`POI_COVERAGE_FETCH_FAILED: ${poiCovErr.message}`);
      }
      poiCoverage = new Set((poiHits ?? []).map((p) => (p as { match_id: string }).match_id));
    }
    for (const e of activeEngagements ?? []) {
      const row = e as { id: string; match_id: string | null; org_id: string | null; engagement_status: string; created_at: string };
      if (!row.match_id) continue;
      if (poiCoverage.has(row.match_id)) continue;
      engagementWithoutPoi.push({
        engagement_id: row.id,
        match_id: row.match_id,
        org_id: row.org_id,
        engagement_status: row.engagement_status,
        created_at: row.created_at,
      });
    }
  }

  // ── 4b. WAD_POI_DRIFT (Batch V REC-003 hardening) ──────────────────
  // Detect sealed WaDs whose linked POI is missing or whose buyer/seller
  // org linkage disagrees with the underlying match. Terms-hash drift is
  // intentionally out of scope (no canonical hash column on pois).
  const wadPoiDrift: Array<Record<string, unknown>> = [];
  {
    const { data: sealedWads, error: wadErr } = await admin
      .from("wads")
      .select("id, poi_id, buyer_org_id, seller_org_id, status, sealed_at")
      .eq("status", "sealed")
      .gte("sealed_at", sinceIso)
      .order("sealed_at", { ascending: false })
      .limit(ROW_LIMIT);
    if (wadErr) {
      console.error("[burn-poi-reconciliation] wad fetch failed:", wadErr);
      throw new Error(`WAD_FETCH_FAILED: ${wadErr.message}`);
    }
    const wads = (sealedWads ?? []) as Array<{
      id: string; poi_id: string | null; buyer_org_id: string | null;
      seller_org_id: string | null; status: string; sealed_at: string | null;
    }>;
    const poiIds = Array.from(new Set(wads.map((w) => w.poi_id).filter((v): v is string => !!v)));
    const poiById = new Map<string, { id: string; match_id: string | null; state: string | null }>();
    const matchById = new Map<string, { id: string; buyer_org_id: string | null; seller_org_id: string | null }>();
    if (poiIds.length > 0) {
      const { data: poiRows2, error: pErr } = await admin
        .from("pois")
        .select("id, match_id, state")
        .in("id", poiIds);
      if (pErr) throw new Error(`WAD_POI_LOOKUP_FAILED: ${pErr.message}`);
      for (const p of (poiRows2 ?? []) as Array<{ id: string; match_id: string | null; state: string | null }>) {
        poiById.set(p.id, p);
      }
      const matchIds2 = Array.from(new Set(
        Array.from(poiById.values()).map((p) => p.match_id).filter((v): v is string => !!v),
      ));
      if (matchIds2.length > 0) {
        const { data: matchRows, error: mErr } = await admin
          .from("matches")
          .select("id, buyer_org_id, seller_org_id")
          .in("id", matchIds2);
        if (mErr) throw new Error(`WAD_MATCH_LOOKUP_FAILED: ${mErr.message}`);
        for (const m of (matchRows ?? []) as Array<{ id: string; buyer_org_id: string | null; seller_org_id: string | null }>) {
          matchById.set(m.id, m);
        }
      }
    }
    for (const w of wads) {
      if (!w.poi_id) {
        wadPoiDrift.push({ wad_id: w.id, kind: "missing_poi_link", detail: "sealed wad has null poi_id" });
        continue;
      }
      const poi = poiById.get(w.poi_id);
      if (!poi) {
        wadPoiDrift.push({ wad_id: w.id, poi_id: w.poi_id, kind: "poi_not_found", detail: "linked POI does not exist" });
        continue;
      }
      if (poi.state && !["ELIGIBLE", "COMPLETION_REQUESTED", "COMPLETED"].includes(poi.state)) {
        wadPoiDrift.push({
          wad_id: w.id, poi_id: w.poi_id, kind: "poi_state_incompatible",
          detail: `sealed wad linked to POI in non-terminal state ${poi.state}`,
        });
      }
      if (poi.match_id) {
        const match = matchById.get(poi.match_id);
        if (match) {
          if (w.buyer_org_id && match.buyer_org_id && w.buyer_org_id !== match.buyer_org_id) {
            wadPoiDrift.push({
              wad_id: w.id, poi_id: w.poi_id, match_id: poi.match_id, kind: "buyer_org_mismatch",
              detail: `wad.buyer_org_id ${w.buyer_org_id} ≠ match.buyer_org_id ${match.buyer_org_id}`,
            });
          }
          if (w.seller_org_id && match.seller_org_id && w.seller_org_id !== match.seller_org_id) {
            wadPoiDrift.push({
              wad_id: w.id, poi_id: w.poi_id, match_id: poi.match_id, kind: "seller_org_mismatch",
              detail: `wad.seller_org_id ${w.seller_org_id} ≠ match.seller_org_id ${match.seller_org_id}`,
            });
          }
        }
      }
    }
  }

  // ── 5. Optional: open admin_risk_items per drift case (idempotent via title) ─
  // admin_risk_items has no external_ref column, so we use a stable title
  // prefix and skip insertion when an open row with the same title exists.
  let openedRiskItems = 0;
  if (openRiskItems) {
    const buildAndInsert = async (title: string, description: string) => {
      const { data: existing } = await admin
        .from("admin_risk_items")
        .select("id")
        .eq("title", title)
        .eq("status", "open")
        .limit(1)
        .maybeSingle();
      if (existing) return;
      const { error: insErr } = await admin.from("admin_risk_items").insert({
        title,
        description,
        severity: "high",
        status: "open",
      });
      if (!insErr) openedRiskItems++;
    };

    for (const drift of burnsWithoutPoi) {
      const title = `Reconciliation: burn without POI [ledger ${String(drift.ledger_id).slice(0, 8)}]`;
      const description = `token_ledger row ${drift.ledger_id} burned ${drift.tokens_burned} credits for org ${drift.org_id} against match ${drift.match_id} but no POI exists. Manual investigation required.`;
      try { await buildAndInsert(title, description); } catch (e) { console.error("[burn-poi-reconciliation] risk insert failed:", e); }
    }
    for (const drift of poisWithoutBurn) {
      const title = `Reconciliation: POI without burn [poi ${String(drift.poi_id).slice(0, 8)}]`;
      const description = `POI ${drift.poi_id} (state=${drift.state}) for org ${drift.org_id} on match ${drift.match_id} has no matching burn or exemption. Manual investigation required.`;
      try { await buildAndInsert(title, description); } catch (e) { console.error("[burn-poi-reconciliation] risk insert failed:", e); }
    }
    for (const drift of stateWithoutLedger) {
      const title = `Reconciliation: minted state without ledger event [match ${String(drift.match_id).slice(0, 8)}]`;
      const description = `Match ${drift.match_id} (state=${drift.state}, status=${drift.status}) for org ${drift.org_id} is in a minted state but has no ledger_events.poi.minted row. State-vs-ledger drift; manual investigation required. No silent repair performed.`;
      try { await buildAndInsert(title, description); } catch (e) { console.error("[burn-poi-reconciliation] risk insert failed:", e); }
    }
    for (const drift of mintedWithoutEngagement) {
      const title = `Reconciliation: minted match without engagement [match ${String(drift.match_id).slice(0, 8)}]`;
      const description = `Match ${drift.match_id} (state=${drift.state ?? 'unknown'}) for org ${drift.org_id ?? 'unknown'} has been minted/burned but has no current poi_engagements row. Engagement self-heal did not run; manual investigation required. No silent repair performed.`;
      try { await buildAndInsert(title, description); } catch (e) { console.error("[burn-poi-reconciliation] risk insert failed:", e); }
    for (const drift of engagementWithoutPoi) {
      const title = `Reconciliation: engagement without POI [match ${String(drift.match_id).slice(0, 8)}]`;
      const description = `Engagement ${drift.engagement_id} (status=${drift.engagement_status}) for org ${drift.org_id ?? 'unknown'} on match ${drift.match_id} has no POI row. Soft-route pending statuses are excluded; this is real drift. No auto-repair.`;
      try { await buildAndInsert(title, description); } catch (e) { console.error("[burn-poi-reconciliation] risk insert failed:", e); }
    }
    for (const drift of wadPoiDrift) {
      const title = `Reconciliation: wad-poi ${drift.kind} [wad ${String(drift.wad_id).slice(0, 8)}]`;
      const description = `Sealed WaD ${drift.wad_id} drift kind=${drift.kind}. ${drift.detail ?? ''} No auto-repair.`;
      try { await buildAndInsert(title, description); } catch (e) { console.error("[burn-poi-reconciliation] risk insert failed:", e); }
    }
  }

  // ── 5b. Stale-risk auto-close (Batch V REC-005) ────────────────────
  // For deterministic, machine-created kinds whose source condition is no
  // longer present this run, auto-resolve and audit. Only for our own
  // title-prefix patterns; manual/support-created items are untouched.
  let autoClosed = 0;
  try {
    const stillBurnLedger = new Set(burnsWithoutPoi.map((d) => String(d.ledger_id).slice(0, 8)));
    const stillPoi = new Set(poisWithoutBurn.map((d) => String(d.poi_id).slice(0, 8)));
    const stillState = new Set(stateWithoutLedger.map((d) => String(d.match_id).slice(0, 8)));
    const stillMintedNoEng = new Set(mintedWithoutEngagement.map((d) => String(d.match_id).slice(0, 8)));
    const stillEngNoPoi = new Set(engagementWithoutPoi.map((d) => String(d.match_id).slice(0, 8)));
    const stillWadPoi = new Set(wadPoiDrift.map((d) => `${d.kind}:${String(d.wad_id).slice(0, 8)}`));
    const prefixes: Array<{ prefix: string; stillSet: Set<string>; keyAfter: (t: string) => string | null }> = [
      { prefix: "Reconciliation: burn without POI [ledger ", stillSet: stillBurnLedger, keyAfter: (t) => t.match(/\[ledger ([0-9a-f]+)\]/)?.[1] ?? null },
      { prefix: "Reconciliation: POI without burn [poi ", stillSet: stillPoi, keyAfter: (t) => t.match(/\[poi ([0-9a-f]+)\]/)?.[1] ?? null },
      { prefix: "Reconciliation: minted state without ledger event [match ", stillSet: stillState, keyAfter: (t) => t.match(/\[match ([0-9a-f]+)\]/)?.[1] ?? null },
      { prefix: "Reconciliation: minted match without engagement [match ", stillSet: stillMintedNoEng, keyAfter: (t) => t.match(/\[match ([0-9a-f]+)\]/)?.[1] ?? null },
      { prefix: "Reconciliation: engagement without POI [match ", stillSet: stillEngNoPoi, keyAfter: (t) => t.match(/\[match ([0-9a-f]+)\]/)?.[1] ?? null },
    ];
    for (const { prefix, stillSet, keyAfter } of prefixes) {
      const { data: openItems } = await admin
        .from("admin_risk_items")
        .select("id, title")
        .eq("status", "open")
        .like("title", `${prefix}%`)
        .limit(500);
      for (const it of (openItems ?? []) as Array<{ id: string; title: string }>) {
        const key = keyAfter(it.title);
        if (!key || stillSet.has(key)) continue;
        const { error: updErr } = await admin
          .from("admin_risk_items")
          .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: null })
          .eq("id", it.id)
          .eq("status", "open");
        if (updErr) continue;
        autoClosed++;
        await admin.from("admin_audit_logs").insert({
          admin_user_id: null,
          action: "risk_item.auto_resolved",
          target_type: "admin_risk_item",
          target_id: it.id,
          details: { source: "burn-poi-reconciliation", reason: "reconciliation_auto_close", run_id: runId },
        });
        await resolveNotificationsFor(admin as any, "admin_risk_item", it.id, {
          requestId: runId, source: "burn-poi-reconciliation",
        });
      }
    }
    // wad-poi has compound key (kind+id); separate pass.
    const { data: openWad } = await admin
      .from("admin_risk_items")
      .select("id, title")
      .eq("status", "open")
      .like("title", "Reconciliation: wad-poi %")
      .limit(500);
    for (const it of (openWad ?? []) as Array<{ id: string; title: string }>) {
      const m = it.title.match(/wad-poi (\S+) \[wad ([0-9a-f]+)\]/);
      if (!m) continue;
      const key = `${m[1]}:${m[2]}`;
      if (stillWadPoi.has(key)) continue;
      const { error: updErr } = await admin
        .from("admin_risk_items")
        .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: null })
        .eq("id", it.id).eq("status", "open");
      if (updErr) continue;
      autoClosed++;
      await admin.from("admin_audit_logs").insert({
        admin_user_id: null, action: "risk_item.auto_resolved",
        target_type: "admin_risk_item", target_id: it.id,
        details: { source: "burn-poi-reconciliation", reason: "reconciliation_auto_close", run_id: runId },
      });
      await resolveNotificationsFor(admin as any, "admin_risk_item", it.id, { requestId: runId, source: "burn-poi-reconciliation" });
    }
  } catch (e) {
    console.error("[burn-poi-reconciliation] stale auto-close failed:", e);
  }

  // ── 6. Audit row ───────────────────────────────────────────────────
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
        state_without_ledger: stateWithoutLedger.length,
        minted_without_engagement: mintedWithoutEngagement.length,
        engagement_without_poi: engagementWithoutPoi.length,
        wad_poi_drift: wadPoiDrift.length,
        opened_risk_items: openedRiskItems,
        auto_closed: autoClosed,
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
    burns_without_poi: { count: burnsWithoutPoi.length, samples: burnsWithoutPoi.slice(0, SAMPLE_CAP) },
    pois_without_burn: { count: poisWithoutBurn.length, samples: poisWithoutBurn.slice(0, SAMPLE_CAP) },
    state_without_ledger: { count: stateWithoutLedger.length, samples: stateWithoutLedger.slice(0, SAMPLE_CAP) },
    minted_without_engagement: { count: mintedWithoutEngagement.length, samples: mintedWithoutEngagement.slice(0, SAMPLE_CAP) },
    engagement_without_poi: { count: engagementWithoutPoi.length, samples: engagementWithoutPoi.slice(0, SAMPLE_CAP) },
    wad_poi_drift: { count: wadPoiDrift.length, samples: wadPoiDrift.slice(0, SAMPLE_CAP) },
    opened_risk_items: openedRiskItems,
    auto_closed: autoClosed,
  });
  } catch (err) {
    // AUD-003 Fix 2: outer catch — surface reconciliation failure to admin.
    console.error("[burn-poi-reconciliation] run failed:", err);
    await recordSelfIncident(admin, runId, err);
    return json(500, {
      error: "RECONCILIATION_FAILED",
      run_id: runId,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});
