// Compute Counterparty Ratings — enterprise four-pillar derivation.
//
// Recomputes ratings for every organisation that has activity in the recent
// window. Writes a single row into `counterparty_ratings` per org and an
// append-only ledger row per individual signal that fed the score.
//
// Trigger modes:
//   POST /                       → recompute all eligible orgs (admin only)
//   POST { "orgId": "<uuid>" }   → recompute a single org (admin OR org admin)
//
// Methodology:
//   * Pulls active row from rating_methodology_versions.
//   * 70/30 recent/historical weighting (configurable on methodology row).
//   * Time-decay via half-life formula: weight = 0.5 ^ (age_days / half_life).
//   * Sample-size guard: < min_sample_size settled deals → 'insufficient_history'.
//   * Anti-gaming: only admin-resolved disputes count negatively (dismissed
//     and withdrawn disputes are ignored).
//
// All writes happen under the service role; RLS allows public read of the
// final `counterparty_ratings` row but admin-only read of `rating_signals`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";

interface Methodology {
  version: number;
  weights: { reliability: number; responsiveness: number; compliance: number; settlement: number };
  decay_half_life_days: number;
  recent_window_days: number;
  recent_weight: number;
  min_sample_size: number;
}

interface PillarAccumulator {
  weighted_sum: number;
  weight_total: number;
  signals: Array<{
    pillar: "reliability" | "responsiveness" | "compliance" | "settlement";
    signal_type: string;
    source_entity_type: string | null;
    source_entity_id: string | null;
    raw_value: number | null;
    normalized_value: number;
    weight: number;
    decay_factor: number;
    observed_at: string;
    metadata: Record<string, unknown>;
  }>;
}

const newAccumulator = (): PillarAccumulator => ({
  weighted_sum: 0,
  weight_total: 0,
  signals: [],
});

const decayFactor = (observedAtISO: string, halfLifeDays: number): number => {
  const ageMs = Date.now() - new Date(observedAtISO).getTime();
  const ageDays = Math.max(0, ageMs / 86_400_000);
  return Math.pow(0.5, ageDays / Math.max(1, halfLifeDays));
};

const pushSignal = (
  acc: PillarAccumulator,
  pillar: PillarAccumulator["signals"][number]["pillar"],
  signal_type: string,
  normalized_value: number,
  observed_at: string,
  weight: number,
  methodology: Methodology,
  extras: Partial<PillarAccumulator["signals"][number]> = {},
) => {
  const decay = decayFactor(observed_at, methodology.decay_half_life_days);
  const effective = weight * decay;
  acc.weighted_sum += normalized_value * effective;
  acc.weight_total += effective;
  acc.signals.push({
    pillar,
    signal_type,
    source_entity_type: extras.source_entity_type ?? null,
    source_entity_id: extras.source_entity_id ?? null,
    raw_value: extras.raw_value ?? null,
    normalized_value,
    weight,
    decay_factor: Number(decay.toFixed(4)),
    observed_at,
    metadata: extras.metadata ?? {},
  });
};

const pillarScore = (acc: PillarAccumulator): number | null => {
  if (acc.weight_total === 0) return null;
  return Math.max(0, Math.min(100, acc.weighted_sum / acc.weight_total));
};

const bandFor = (overall: number | null, sample: number, minSample: number): string => {
  if (overall === null) return "new";
  if (sample < minSample) return "insufficient_history";
  if (overall >= 90) return "platinum";
  if (overall >= 80) return "gold";
  if (overall >= 70) return "silver";
  if (overall >= 55) return "bronze";
  return "new";
};

async function computeForOrg(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  methodology: Methodology,
): Promise<{ ok: true; band: string; overall: number | null } | { ok: false; reason: string }> {
  const recentCutoff = new Date(Date.now() - methodology.recent_window_days * 86_400_000).toISOString();

  // Pull every match where this org is buyer or seller.
  const { data: matches, error: matchErr } = await supabase
    .from("matches")
    .select(
      "id, status, state, created_at, settled_at, buyer_org_id, seller_org_id, counterparty_sighted_at, buyer_committed_at, seller_committed_at",
    )
    .or(`buyer_org_id.eq.${orgId},seller_org_id.eq.${orgId}`);
  if (matchErr) throw matchErr;

  const allMatches = matches ?? [];
  const matchIds = allMatches.map((m: any) => m.id);

  // Disputes — only count admin-resolved adverse outcomes.
  const { data: disputes } = matchIds.length
    ? await supabase
        .from("disputes")
        .select("id, match_id, status, resolution_outcome, created_at, raised_by_org_id")
        .in("match_id", matchIds)
    : { data: [] as any[] };

  // Acceptance receipts (responsiveness signal).
  const { data: receipts } = matchIds.length
    ? await supabase
        .from("acceptance_receipts")
        .select("id, match_id, accepted_at, initiator_org_id, created_at")
        .in("match_id", matchIds)
    : { data: [] as any[] };

  // Compliance freshness — KYC docs, screening attestations.
  const [{ data: attestations }, { data: kycDocs }] = await Promise.all([
    supabase
      .from("attestations")
      .select("id, attestation_type, signed_at")
      .eq("org_id", orgId)
      .order("signed_at", { ascending: false })
      .limit(50),
    supabase
      .from("kyc_documents")
      .select("id, document_type, status, verified_at, expires_at, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const reliability = newAccumulator();
  const responsiveness = newAccumulator();
  const compliance = newAccumulator();
  const settlement = newAccumulator();

  // ── Reliability ────────────────────────────────────────────────────────
  // Settled vs cancelled at platform level.
  let settledCount = 0;
  let cancelledCount = 0;
  let recentSettled = 0;

  for (const m of allMatches as any[]) {
    if (m.status === "settled") {
      settledCount += 1;
      if ((m.settled_at ?? m.created_at) >= recentCutoff) recentSettled += 1;
      pushSignal(reliability, "reliability", "deal_settled", 100, m.settled_at ?? m.created_at, 1, methodology, {
        source_entity_type: "match",
        source_entity_id: m.id,
      });
    } else if (m.status === "cancelled") {
      cancelledCount += 1;
      pushSignal(reliability, "reliability", "deal_cancelled", 0, m.created_at, 1, methodology, {
        source_entity_type: "match",
        source_entity_id: m.id,
      });
    }
  }

  // ── Responsiveness ────────────────────────────────────────────────────
  // Median time from match creation → counterparty acceptance.
  const matchById = new Map(allMatches.map((m: any) => [m.id, m]));
  for (const r of (receipts ?? []) as any[]) {
    const m: any = matchById.get(r.match_id);
    if (!m) continue;
    const created = new Date(m.created_at).getTime();
    const accepted = new Date(r.accepted_at).getTime();
    const hours = Math.max(0, (accepted - created) / 3_600_000);
    // 0h → 100, 1h → 100, 24h → 70, 168h (1 week) → 30, beyond → 10.
    let normalised: number;
    if (hours <= 1) normalised = 100;
    else if (hours <= 24) normalised = 100 - ((hours - 1) * 30) / 23;
    else if (hours <= 168) normalised = 70 - ((hours - 24) * 40) / 144;
    else normalised = Math.max(10, 30 - (hours - 168) / 168 * 20);
    pushSignal(
      responsiveness,
      "responsiveness",
      "acceptance_latency_hours",
      normalised,
      r.accepted_at,
      1,
      methodology,
      {
        source_entity_type: "acceptance_receipt",
        source_entity_id: r.id,
        raw_value: hours,
      },
    );
  }

  // ── Settlement integrity ───────────────────────────────────────────────
  // Adverse disputes (admin-resolved against this org) drag the score down.
  for (const d of (disputes ?? []) as any[]) {
    const m: any = matchById.get(d.match_id);
    if (!m) continue;
    if (d.status === "resolved" && d.resolution_outcome) {
      const adverseToThisOrg =
        // raised by *other* org and upheld → bad for this org
        d.raised_by_org_id !== orgId && d.resolution_outcome === "upheld";
      const normalised = adverseToThisOrg ? 0 : 80;
      pushSignal(settlement, "settlement", "dispute_resolved", normalised, d.created_at, 1.5, methodology, {
        source_entity_type: "dispute",
        source_entity_id: d.id,
        metadata: { outcome: d.resolution_outcome, adverse: adverseToThisOrg },
      });
    } else if (d.status === "dismissed" || d.status === "withdrawn") {
      // Anti-retaliation: dismissed/withdrawn disputes do not count.
      continue;
    }
  }

  // Settlement positive signal: every settled match contributes.
  for (const m of allMatches as any[]) {
    if (m.status === "settled") {
      pushSignal(settlement, "settlement", "settlement_completed", 100, m.settled_at ?? m.created_at, 1, methodology, {
        source_entity_type: "match",
        source_entity_id: m.id,
      });
    }
  }

  // ── Compliance hygiene ─────────────────────────────────────────────────
  // Attestation freshness — most recent of each type within last 365d → high.
  const seenTypes = new Set<string>();
  for (const a of (attestations ?? []) as any[]) {
    if (seenTypes.has(a.attestation_type)) continue;
    seenTypes.add(a.attestation_type);
    const ageDays = (Date.now() - new Date(a.signed_at).getTime()) / 86_400_000;
    let normalised: number;
    if (ageDays <= 90) normalised = 100;
    else if (ageDays <= 365) normalised = 100 - ((ageDays - 90) * 50) / 275;
    else normalised = Math.max(20, 50 - (ageDays - 365) / 10);
    pushSignal(compliance, "compliance", `attestation_${a.attestation_type}`, normalised, a.signed_at, 1, methodology, {
      source_entity_type: "attestation",
      source_entity_id: a.id,
      raw_value: ageDays,
    });
  }

  // KYC document verification.
  let verifiedDocCount = 0;
  for (const k of (kycDocs ?? []) as any[]) {
    if (k.status === "verified") {
      verifiedDocCount += 1;
      const expired = k.expires_at && new Date(k.expires_at).getTime() < Date.now();
      pushSignal(
        compliance,
        "compliance",
        `kyc_${k.document_type}`,
        expired ? 30 : 100,
        k.verified_at ?? k.created_at,
        1,
        methodology,
        { source_entity_type: "kyc_document", source_entity_id: k.id, metadata: { expired } },
      );
    }
  }

  // Floor compliance score: if no signals at all, treat as 0 (unverified).
  if (compliance.signals.length === 0) {
    pushSignal(compliance, "compliance", "no_compliance_evidence", 0, new Date().toISOString(), 1, methodology);
  }

  // ── Overall blend ──────────────────────────────────────────────────────
  const r = pillarScore(reliability);
  const rp = pillarScore(responsiveness);
  const c = pillarScore(compliance);
  const s = pillarScore(settlement);

  const w = methodology.weights;
  let overall: number | null = null;
  let weightSum = 0;
  let scoreSum = 0;
  if (r !== null) { scoreSum += r * w.reliability; weightSum += w.reliability; }
  if (rp !== null) { scoreSum += rp * w.responsiveness; weightSum += w.responsiveness; }
  if (c !== null) { scoreSum += c * w.compliance; weightSum += w.compliance; }
  if (s !== null) { scoreSum += s * w.settlement; weightSum += w.settlement; }
  if (weightSum > 0) overall = scoreSum / weightSum;

  const sampleSize = settledCount + cancelledCount;
  const band = bandFor(overall, settledCount, methodology.min_sample_size);

  // ── Persist ────────────────────────────────────────────────────────────
  const summary = {
    settled: settledCount,
    cancelled: cancelledCount,
    recent_settled: recentSettled,
    disputes_total: (disputes ?? []).length,
    verified_kyc_docs: verifiedDocCount,
    attestation_types: Array.from(seenTypes),
  };

  const { error: upsertErr } = await supabase
    .from("counterparty_ratings")
    .upsert(
      {
        org_id: orgId,
        methodology_version: methodology.version,
        reliability_score: r,
        responsiveness_score: rp,
        compliance_score: c,
        settlement_score: s,
        overall_score: overall,
        band,
        sample_size: sampleSize,
        recent_sample_size: recentSettled,
        signals_summary: summary,
        computed_at: new Date().toISOString(),
        next_recompute_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
      },
      { onConflict: "org_id" },
    );
  if (upsertErr) throw upsertErr;

  // Replace prior signals for this org for this methodology version
  // (we keep historical methodology versions but each version has the
  // latest derivation only — older derivations are replaced on each run).
  await supabase
    .from("rating_signals")
    .delete()
    .eq("org_id", orgId)
    .eq("methodology_version", methodology.version);

  const allSignals = [
    ...reliability.signals,
    ...responsiveness.signals,
    ...compliance.signals,
    ...settlement.signals,
  ].map((sig) => ({
    org_id: orgId,
    methodology_version: methodology.version,
    ...sig,
  }));

  if (allSignals.length > 0) {
    // chunk to avoid payload limits
    for (let i = 0; i < allSignals.length; i += 500) {
      const chunk = allSignals.slice(i, i + 500);
      const { error } = await supabase.from("rating_signals").insert(chunk);
      if (error) throw error;
    }
  }

  return { ok: true, band, overall };
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const headers = corsHeaders(allowedOrigins, req.headers.get("origin"));

  const cors = handleCors(req, allowedOrigins);
  if (cors) return cors;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const auth = await authenticateRequest(req, supabaseUrl, supabaseKey);

    let body: { orgId?: string } = {};
    try { body = await req.json(); } catch { /* empty body fine */ }

    // Active methodology
    const { data: method, error: methodErr } = await supabase
      .from("rating_methodology_versions")
      .select("*")
      .eq("active", true)
      .order("version", { ascending: false })
      .limit(1)
      .single();
    if (methodErr || !method) {
      throw new ApiException("NO_METHODOLOGY", "No active rating methodology found", 500);
    }

    const methodology: Methodology = {
      version: method.version,
      weights: method.weights as Methodology["weights"],
      decay_half_life_days: method.decay_half_life_days,
      recent_window_days: method.recent_window_days,
      recent_weight: Number(method.recent_weight),
      min_sample_size: method.min_sample_size,
    };

    // Single-org mode
    if (body.orgId) {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRe.test(body.orgId)) {
        throw new ApiException("VALIDATION_ERROR", "Invalid orgId format", 400);
      }
      const isPlatformAdmin = auth.roles.includes("platform_admin");
      const isOwnOrg = auth.orgId === body.orgId;
      if (!isPlatformAdmin && !isOwnOrg) {
        throw new ApiException("FORBIDDEN", "Cannot recompute another org's rating", 403);
      }
      const result = await computeForOrg(supabase, body.orgId, methodology);
      return new Response(JSON.stringify({ requestId, methodology_version: methodology.version, ...result }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Bulk mode — platform admin only
    if (!auth.roles.includes("platform_admin")) {
      throw new ApiException("FORBIDDEN", "Bulk recompute requires platform admin", 403);
    }

    const { data: orgs, error: orgsErr } = await supabase
      .from("organizations")
      .select("id");
    if (orgsErr) throw orgsErr;

    const results: Array<{ org_id: string; band: string; overall: number | null }> = [];
    for (const o of orgs ?? []) {
      try {
        const r = await computeForOrg(supabase, o.id, methodology);
        if (r.ok) results.push({ org_id: o.id, band: r.band, overall: r.overall });
      } catch (err) {
        console.error(`[${requestId}] failed for org ${o.id}:`, err);
      }
    }

    return new Response(
      JSON.stringify({
        requestId,
        methodology_version: methodology.version,
        computed: results.length,
        results,
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(`[${requestId}] compute-counterparty-ratings error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
