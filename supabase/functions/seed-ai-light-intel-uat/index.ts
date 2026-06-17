/**
 * seed-ai-light-intel-uat — idempotent seeder for AI Light-Intel V1 UAT retest.
 *
 * Provisions (or refreshes):
 *   - Uses existing accounts: api@izenzo.co.za (originator org_admin),
 *     test1@izenzo.co.za (outside non-admin), and existing platform_admin
 *     daniel-platformadmin@test.izenzo.co.za.
 *   - 1 trade_request in api@'s org tagged metadata.fixture='ai-light-intel-uat'
 *   - 3 ai_proposed_matches at distinct lifecycle states so UAT can exercise
 *     every Phase 3B control without first having to walk the funnel:
 *       (a) status='pending_review'        — for Approve / Override / Mark dup
 *                                            / Mark not relevant / Feedback /
 *                                            Assign / Due date / Edit payload /
 *                                            View versions / Request rerun
 *       (b) status='approved_internal'     — for Approve for client view
 *       (c) status='approved_client_view'  — for Approve for outreach + Draft
 *                                            Outreach panel
 *
 * AUTH: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 * BODY: { confirm: "RUN_SEED_AI_LIGHT_INTEL_UAT" }
 *
 * SAFETY:
 *   - No emails sent, no outreach triggered, no payment/credit/POI mutations.
 *   - Trade request flagged is_demo=true; org is the existing Batch A fixture.
 *   - Idempotent: re-run resets the three proposals back to seeded states.
 */
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders as buildCors, handleCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIXTURE_TAG = "ai-light-intel-uat";

// Existing accounts (verified to exist 2026-06-17 against auth.users)
const API_USER_ID = "a9398f73-1bc0-4943-abfe-1bb5763cb18d"; // api@izenzo.co.za
const API_ORG_ID  = "ce6b09b7-f3ba-4246-aad4-7abb6bf54199"; // Batch A Initiator Ltd

async function ensureTradeRequest(admin: SupabaseClient): Promise<string> {
  const { data: existing } = await admin
    .from("trade_requests").select("id")
    .eq("org_id", API_ORG_ID)
    .contains("metadata", { fixture: FIXTURE_TAG } as never)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data, error } = await admin.from("trade_requests").insert({
    org_id: API_ORG_ID,
    created_by: API_USER_ID,
    commodity: "Copper cathodes (LME Grade A)",
    quantity_amount: 500,
    quantity_unit: "MT",
    price_amount: 9200,
    price_currency: "USD",
    side: "seller",
    location: "Durban, ZA",
    match_type: "bilateral",
    status: "active",
    is_demo: true,
    metadata: { fixture: FIXTURE_TAG, purpose: "AI Light-Intel V1 UAT retest" },
  } as never).select("id").single();
  if (error || !data) throw new Error(`trade_request insert: ${error?.message}`);
  return data.id;
}

async function upsertProposal(
  admin: SupabaseClient,
  tradeRequestId: string,
  name: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const { data: existing } = await admin
    .from("ai_proposed_matches").select("id")
    .eq("trade_request_id", tradeRequestId)
    .eq("suggested_counterparty_name", name)
    .maybeSingle();

  const base = {
    trade_request_id: tradeRequestId,
    suggested_counterparty_name: name,
    counterparty_role: "buyer",
    jurisdiction: "AE",
    sector_or_product_fit: "Copper refining / trading desk",
    capacity_indicator: "20-50k MT / year",
    prior_activity_summary: "Synthetic fixture for AI Light-Intel V1 UAT.",
    source_summary: "FIXTURE — no real public sources consulted.",
    source_references: [] as never,
    confidence_level: "medium",
    fit_label: "strong_fit",
    rank_position: 1,
    match_rationale: "Seeded for UAT of Phase 3B/3C/3D/4/5/6 controls.",
    risk_flags: [] as never,
    status,
    created_by: API_USER_ID,
    ...extra,
  };

  if (existing?.id) {
    await admin.from("ai_proposed_matches").update({
      ...base,
      reviewed_at: null, approved_at: null, rejected_at: null, archived_at: null,
      reviewed_by: null, reviewer_note: null, rejection_reason: null,
      confidence_override: null, confidence_override_reason: null,
      escalation_required: false, escalation_reason: null,
    } as never).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await admin.from("ai_proposed_matches")
    .insert(base as never).select("id").single();
  if (error || !data) throw new Error(`ai_proposed_match insert (${status}): ${error?.message}`);
  return data.id;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCors(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin"));
  const pf = handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (pf) return pf;
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: corsHeaders });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (req.headers.get("Authorization") !== `Bearer ${SERVICE_ROLE}`) {
    return json({ error: "unauthorized" }, 401);
  }
  let body: { confirm?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (body.confirm !== "RUN_SEED_AI_LIGHT_INTEL_UAT") {
    return json({ error: "confirm phrase required: RUN_SEED_AI_LIGHT_INTEL_UAT" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const tradeRequestId = await ensureTradeRequest(admin);
    const pendingId = await upsertProposal(
      admin, tradeRequestId,
      "UAT Pending Review Counterparty Ltd (FIXTURE)",
      "pending_review",
    );
    const approvedInternalId = await upsertProposal(
      admin, tradeRequestId,
      "UAT Approved-Internal Counterparty Ltd (FIXTURE)",
      "approved_internal",
      { approved_at: new Date().toISOString() },
    );
    const approvedClientId = await upsertProposal(
      admin, tradeRequestId,
      "UAT Client-View Counterparty Ltd (FIXTURE)",
      "approved_client_view",
      { approved_at: new Date().toISOString() },
    );

    return json({
      ok: true,
      trade_request_id: tradeRequestId,
      proposals: {
        pending_review: pendingId,
        approved_internal: approvedInternalId,
        approved_client_view: approvedClientId,
      },
      accounts: {
        platform_admin: "daniel-platformadmin@test.izenzo.co.za",
        originator_org_admin: "api@izenzo.co.za",
        outside_non_admin: "test1@izenzo.co.za",
        note_test2: "test2@izenzo.co.za is soft-deleted (pending_deletion) — substitute with test1@ or restore via account-restore flow before UAT.",
      },
      hq_queue_url: "https://api.trade.izenzo.co.za/hq/ai-suggestions",
      trade_match_url: `https://api.trade.izenzo.co.za/trades/${tradeRequestId}`,
    });
  } catch (e) {
    console.error("[seed-ai-light-intel-uat]", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
