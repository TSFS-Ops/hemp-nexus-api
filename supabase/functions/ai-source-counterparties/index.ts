/**
 * ai-source-counterparties
 * ──────────────────────────────────────────────────────────────────────
 * AI Counterparty Intelligence & Match Review — Batch 1.
 *
 * Sources possible counterparties for a given trade_request from APPROVED
 * INTERNAL sources only:
 *   - public.organizations
 *   - public.matches      (prior trade relationships)
 *   - public.pois         (prior POI history)
 *   - public.match_counterparty_intel (existing AI intel rows)
 *
 * Ranks them with Lovable AI and writes ranked rows to ai_proposed_matches.
 *
 * HARD EXCLUSIONS: no LinkedIn, no Hunter, no ZoomInfo, no external scrape,
 * no autonomous outreach, no POI/WaD creation, no "verified" claim.
 *
 * Audits:
 *   - one `ai_review.counterparty_sourced` per candidate considered
 *   - one `ai_review.proposed_match_created` per row written
 *   - one `ai_review.counterparty_ranked` summary
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { writeAdminAudit, extractIp, extractUserAgent } from "../_shared/admin-audit.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const MAX_CANDIDATES_DEFAULT = 10; // Phase 2: hard cap of 10 results per run (was 25).
const MAX_RUNS_PER_MATCH = 3;       // Phase 2: hard cap on AI runs per match.

async function aiGatewayCallWithRetry(
  body: unknown,
  apiKey: string,
): Promise<{ ok: true; data: any } | { ok: false; status: number; detail: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (resp.ok) return { ok: true, data: await resp.json() };
      if (attempt === 0 && (resp.status >= 500 || resp.status === 408 || resp.status === 429)) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return { ok: false, status: resp.status, detail: (await resp.text()).slice(0, 500) };
    } catch (e: any) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return { ok: false, status: 599, detail: e?.message ?? "network error" };
    }
  }
  return { ok: false, status: 599, detail: "unreachable" };
}

serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  return withCors(req, await _handle(req));
});

async function _handle(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let userId: string | null = null;
  try {
    // Phase 2: internal-key invocation bypasses platform_admin requirement.
    const internalKey = Deno.env.get("INTERNAL_CRON_KEY");
    const providedKey = req.headers.get("x-internal-key");
    const isInternal = !!internalKey && providedKey === internalKey;

    if (!isInternal) {
      const ctx = await authenticateRequest(req, supabaseUrl, serviceKey);
      requireRole(ctx, "platform_admin");
      userId = ctx.userId;
    }

    const body = await req.json().catch(() => ({}));
    const trade_request_id = body?.trade_request_id;
    const interpretation_id = body?.interpretation_id ?? null;
    const match_id: string | null =
      typeof body?.match_id === "string" ? body.match_id : null;
    const requestedMax = Number(body?.max_results);
    const MAX_CANDIDATES =
      Number.isFinite(requestedMax) && requestedMax > 0 && requestedMax <= MAX_CANDIDATES_DEFAULT
        ? Math.floor(requestedMax)
        : MAX_CANDIDATES_DEFAULT;

    if (!trade_request_id || typeof trade_request_id !== "string") {
      return json(400, { error: "trade_request_id is required" });
    }

    // Phase 2: enforce per-match hard cap (3 runs). Only applies when match_id is supplied.
    if (match_id) {
      const { data: counted, error: cntErr } = await admin
        .rpc("ai_increment_match_run_count", { p_match_id: match_id, p_max_runs: MAX_RUNS_PER_MATCH });
      if (cntErr) throw cntErr;
      if (counted === -1) {
        await writeAdminAudit({
          admin,
          action: "ai_review.usage_limit_exceeded",
          status: "blocked",
          actorUserId: userId,
          targetType: "match",
          targetId: match_id,
          requestId,
          endpoint: "ai-source-counterparties",
          ipAddress: extractIp(req),
          userAgent: extractUserAgent(req),
          extra: { limit: MAX_RUNS_PER_MATCH, kind: "runs_per_match", trade_request_id },
        }).catch(() => {});
        return json(429, {
          error: "usage_limit_exceeded",
          limit: MAX_RUNS_PER_MATCH,
          kind: "runs_per_match",
          retry_after: null,
        });
      }
    }


    const { data: tr, error: trErr } = await admin
      .from("trade_requests")
      .select("*")
      .eq("id", trade_request_id)
      .maybeSingle();
    if (trErr) throw trErr;
    if (!tr) return json(404, { error: "trade_request not found" });

    // ── Source ONLY from approved internal datasets ─────────────────────
    const [orgs, matches, pois, intel] = await Promise.all([
      admin.from("organizations").select("id, org_name, jurisdiction, sectors, status").limit(200),
      admin
        .from("matches")
        .select("id, buyer_org_id, seller_org_id, commodity_id, status, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("pois")
        .select("id, buyer_org_id, seller_org_id, status, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("match_counterparty_intel")
        .select("id, match_id, auto_summary, auto_status")
        .limit(100),
    ]);

    const candidates = (orgs.data ?? [])
      .filter((o: any) => o.id !== tr.org_id) // never propose the requester
      .slice(0, MAX_CANDIDATES)
      .map((o: any) => ({
        org_id: o.id,
        name: o.org_name,
        jurisdiction: o.jurisdiction,
        sectors: o.sectors,
        status: o.status,
      }));

    // ── Active do-not-contact rules (do not surface blocked counterparties) ──
    const { data: dnc } = await admin
      .from("ai_do_not_contact_rules")
      .select("rule_type, rule_value")
      .eq("active", true);
    const blockedOrgIds = new Set(
      (dnc ?? []).filter((r: any) => r.rule_type === "organisation").map((r: any) => r.rule_value),
    );
    const blockedNames = new Set(
      (dnc ?? [])
        .filter((r: any) => r.rule_type === "specific_counterparty")
        .map((r: any) => (r.rule_value as string).toLowerCase()),
    );

    const filtered = candidates.filter(
      (c) => !blockedOrgIds.has(c.org_id) && !blockedNames.has((c.name ?? "").toLowerCase()),
    );

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json(500, { error: "LOVABLE_API_KEY missing" });

    const tool = {
      type: "function" as const,
      function: {
        name: "rank_counterparties",
        description:
          "Rank candidate counterparties for an admin review queue. " +
          "Never describe any counterparty as 'verified'. Use confidence labels and fit labels only.",
        parameters: {
          type: "object",
          properties: {
            ranked: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  org_id: { type: "string" },
                  name: { type: "string" },
                  role: { type: "string" },
                  jurisdiction: { type: "string" },
                  sector_or_product_fit: { type: "string" },
                  capacity_indicator: { type: "string" },
                  prior_activity_summary: { type: "string" },
                  source_summary: { type: "string" },
                  fit_label: { type: "string", enum: ["strong_fit", "possible_fit", "weak_fit"] },
                  confidence_level: { type: "string", enum: ["low", "medium", "high"] },
                  rank_position: { type: "number" },
                  match_rationale: { type: "string" },
                  risk_flags: { type: "array", items: { type: "string" } },
                  escalation_required: { type: "boolean" },
                  escalation_reason: { type: "string" },
                },
                required: [
                  "name", "fit_label", "confidence_level", "rank_position",
                  "match_rationale", "risk_flags", "escalation_required",
                ],
                additionalProperties: true,
              },
            },
          },
          required: ["ranked"],
          additionalProperties: false,
        },
      },
    };

    const aiCall = await aiGatewayCallWithRetry({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content:
            "You rank candidate counterparties for an admin review queue. " +
            "Use approved internal data only. Do NOT label anyone verified. " +
            "Flag risks conservatively. Escalate when source evidence is weak.",
        },
        {
          role: "user",
          content: JSON.stringify({
            trade_request: tr,
            candidate_pool: filtered,
            prior_matches: matches.data ?? [],
            prior_pois: pois.data ?? [],
            prior_intel: intel.data ?? [],
          }),
        },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "rank_counterparties" } },
    }, LOVABLE_API_KEY);

    // Phase 2 provider-failure handling: retry-once already attempted by helper.
    // On terminal failure: audit, create an admin task, do NOT crash — return 200
    // with zero proposed matches so the workflow continues.
    if (!aiCall.ok) {
      const provider_status = aiCall.status;
      const material = provider_status >= 500 || provider_status === 429 || provider_status === 408 || provider_status === 599;

      await writeAdminAudit({
        admin,
        action: "ai_review.provider_failure_recorded",
        status: "error",
        actorUserId: userId,
        targetType: "trade_request",
        targetId: trade_request_id,
        requestId,
        endpoint: "ai-source-counterparties",
        reason: aiCall.detail,
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
        extra: {
          provider: "lovable_ai_gateway",
          provider_status,
          retried_once: true,
          material,
          match_id,
        },
      }).catch(() => {});

      if (material) {
        await admin.from("ai_intel_tasks").insert({
          kind: "provider_failure_review",
          status: "open",
          match_id,
          trade_request_id,
          description: `AI provider failure (status=${provider_status}, retried once). Detail: ${aiCall.detail.slice(0, 300)}`,
          metadata: { provider: "lovable_ai_gateway", provider_status, retried_once: true },
        }).then(() => {}).catch((e) => console.warn("[ai-source-counterparties] task insert failed", e));

      }

      // Surface to caller but DO NOT throw. Continue with zero ranked results.
      return json(200, {
        proposed_matches: [],
        provider_failure: { status: provider_status, material, retried_once: true },
      });
    }

    const args = aiCall.data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return json(502, { error: "AI returned no ranking" });
    const parsed = JSON.parse(args);
    const ranked = Array.isArray(parsed.ranked) ? parsed.ranked : [];


    const rowsToInsert = ranked.slice(0, MAX_CANDIDATES).map((r: any, i: number) => ({
      trade_request_id,
      match_id,

      interpretation_id,
      suggested_counterparty_name: r.name,
      suggested_counterparty_org_id:
        typeof r.org_id === "string" && /^[0-9a-f-]{36}$/i.test(r.org_id) ? r.org_id : null,
      counterparty_role: r.role ?? null,
      jurisdiction: r.jurisdiction ?? null,
      sector_or_product_fit: r.sector_or_product_fit ?? null,
      capacity_indicator: r.capacity_indicator ?? null,
      prior_activity_summary: r.prior_activity_summary ?? null,
      source_summary: r.source_summary ?? null,
      source_references: [
        { type: "internal", source: "organizations" },
        { type: "internal", source: "matches" },
        { type: "internal", source: "pois" },
        { type: "internal", source: "match_counterparty_intel" },
      ],
      confidence_level: r.confidence_level ?? "low",
      fit_label: r.fit_label ?? "possible_fit",
      rank_position: typeof r.rank_position === "number" ? r.rank_position : i + 1,
      match_rationale: r.match_rationale ?? null,
      risk_flags: r.risk_flags ?? [],
      escalation_required: !!r.escalation_required,
      escalation_reason: r.escalation_reason ?? null,
      status: r.escalation_required ? "escalated" : "new",
      created_by: userId,
    }));

    let inserted: any[] = [];
    if (rowsToInsert.length) {
      const ins = await admin.from("ai_proposed_matches").insert(rowsToInsert).select();
      if (ins.error) throw ins.error;
      inserted = ins.data ?? [];
    }

    // Audits
    await writeAdminAudit({
      admin,
      action: "ai_review.counterparty_ranked",
      status: "success",
      actorUserId: userId,
      targetType: "trade_request",
      targetId: trade_request_id,
      requestId,
      endpoint: "ai-source-counterparties",
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
      extra: { candidates_considered: filtered.length, ranked_returned: ranked.length, written: inserted.length },
    });

    for (const row of inserted) {
      await writeAdminAudit({
        admin,
        action: "ai_review.proposed_match_created",
        status: "success",
        actorUserId: userId,
        targetType: "ai_proposed_match",
        targetId: row.id,
        requestId,
        endpoint: "ai-source-counterparties",
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
        extra: {
          trade_request_id,
          confidence_level: row.confidence_level,
          fit_label: row.fit_label,
          escalated: row.escalation_required,
        },
      });
    }

    return json(200, { proposed_matches: inserted });
  } catch (e: any) {
    console.error("[ai-source-counterparties] error:", e);
    const status = e?.statusCode ?? 500;
    await writeAdminAudit({
      admin,
      action: "ai_review.counterparty_sourced",
      status: "error",
      actorUserId: userId,
      targetType: "trade_request",
      requestId,
      endpoint: "ai-source-counterparties",
      reason: e?.message ?? "unknown",
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
    }).catch(() => {});
    return json(status, { error: e?.message ?? "internal error" });
  }
}
