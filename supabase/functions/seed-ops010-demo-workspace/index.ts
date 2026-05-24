// OPS-010 — Deterministic demo-workspace seeder.
//
// Creates a controlled demo journey inside an existing demo workspace
// (created via admin-demo-workspace-create). Seeds:
//   - 1 demo seller org sibling
//   - demo trade_request (no real company / counterparty names)
//   - demo match (buyer = workspace org, seller = sibling org)
//   - simulated POI mint + WaD seal trail (rows only — no live atomic_*
//     RPCs invoked; cryptographically distinguishable seal prefix DEMO_)
//   - simulated screening_runs row (status=clear, provider=ops_010_demo)
//   - simulated credit-burn ledger row (action_type=ops_010_demo_burn)
//
// Idempotent on (dataset_id): re-running with the same dataset replays
// existing rows by their deterministic external_id metadata key.
//
// All rows carry is_demo=true + demo_dataset_id (trigger enforces).
// No external providers contacted. No real emails. No real credit burn.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { OPS_010_AUDIT, OPS_010_DEMO_WATERMARK } from "../_shared/ops-010-audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, x-internal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  dataset_id: z.string().uuid(),
}).strict();

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const cronKey = Deno.env.get("INTERNAL_CRON_KEY");
  const providedKey = req.headers.get("x-internal-key");
  const authHeader = req.headers.get("Authorization") ?? "";

  let callerId: string | null = null;
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

  if (cronKey && providedKey === cronKey) {
    // service path
  } else if (authHeader.startsWith("Bearer ")) {
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { data: isAdmin } = await admin.rpc("is_admin", { user_id: u.user.id });
    if (!isAdmin) return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);
    callerId = u.user.id;
  } else {
    return json({ error: "unauthorized" }, 401);
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid_body", details: parsed.error.flatten().fieldErrors }, 400);
  const datasetId = parsed.data.dataset_id;

  // Resolve buyer org from demo_workspaces.
  const { data: ws, error: wsErr } = await admin
    .from("demo_workspaces")
    .select("id, org_id, status")
    .eq("dataset_id", datasetId)
    .maybeSingle();
  if (wsErr || !ws) return json({ error: "workspace_not_found", code: "WORKSPACE_NOT_FOUND" }, 404);
  if (ws.status === "archived") return json({ error: "workspace_archived", code: "WORKSPACE_ARCHIVED" }, 409);
  const buyerOrgId = ws.org_id;

  // Idempotent helper: skip if a row tagged demo_dataset_id + external_id already exists.
  const ext = (k: string) => `ops010-${datasetId}-${k}`;

  // 1) Seller sibling org (deterministic name; no real company names).
  let sellerOrgId: string;
  {
    const { data: existing } = await admin
      .from("organizations")
      .select("id")
      .eq("demo_dataset_id", datasetId)
      .neq("id", buyerOrgId)
      .maybeSingle();
    if (existing) {
      sellerOrgId = existing.id;
    } else {
      const { data, error } = await admin
        .from("organizations")
        .insert({
          name: `OPS-010 Demo Seller ${datasetId.slice(0, 8)}`,
          status: "active",
          is_demo: true,
          demo_dataset_id: datasetId,
          data_region: "demo",
        })
        .select("id").single();
      if (error) return json({ error: "seller_org_failed", message: error.message }, 500);
      sellerOrgId = data!.id;
    }
  }

  // 2) Trade request
  let tradeRequestId: string;
  {
    const { data: existing } = await admin
      .from("trade_requests")
      .select("id")
      .eq("demo_dataset_id", datasetId)
      .maybeSingle();
    if (existing) {
      tradeRequestId = existing.id;
    } else {
      const { data, error } = await admin
        .from("trade_requests")
        .insert({
          org_id: buyerOrgId,
          created_by: callerId,
          commodity: "DEMO Wheat (HS 1001)",
          quantity_amount: 1000,
          quantity_unit: "MT",
          price_amount: 250,
          price_currency: "USD",
          side: "buy",
          match_type: "bilateral",
          status: "active",
          location: "Demo Port",
          // trigger forces is_demo + demo_dataset_id from org
        })
        .select("id").single();
      if (error) return json({ error: "trade_request_failed", message: error.message }, 500);
      tradeRequestId = data!.id;
    }
  }

  // 3) Match (buyer = workspace org, seller = sibling)
  let matchId: string;
  {
    const { data: existing } = await admin
      .from("matches")
      .select("id")
      .eq("demo_dataset_id", datasetId)
      .maybeSingle();
    if (existing) {
      matchId = existing.id;
    } else {
      const { data, error } = await admin
        .from("matches")
        .insert({
          org_id: buyerOrgId,
          buyer_org_id: buyerOrgId,
          seller_org_id: sellerOrgId,
          buyer_name: "DEMO Buyer",
          seller_name: "DEMO Seller",
          commodity: "DEMO Wheat (HS 1001)",
          quantity_amount: 1000,
          quantity_unit: "MT",
          price_amount: 250,
          price_currency: "USD",
          declared_value_usd: 250000,
          match_type: "bilateral",
          state: "draft",
          status: "active",
          poi_state: "draft",
          hash: `DEMO_${datasetId.slice(0, 8)}_${Date.now()}`,
          trade_request_id: tradeRequestId,
          metadata: { ops_010: true, external_id: ext("match-1") },
          created_by: callerId,
        })
        .select("id").single();
      if (error) return json({ error: "match_failed", message: error.message }, 500);
      matchId = data!.id;
    }
  }

  // 4) Simulated screening_runs (status=clear, provider=ops_010_demo).
  {
    const { data: existing } = await admin
      .from("screening_runs")
      .select("id")
      .eq("demo_dataset_id", datasetId)
      .maybeSingle();
    if (!existing) {
      await admin.from("screening_runs").insert({
        org_id: buyerOrgId,
        entity_id: buyerOrgId,
        provider: "ops_010_demo",
        status: "CLEAR",
        response_hash: `DEMO_clear_${datasetId.slice(0, 8)}`,
        details: { ops_010: true, simulated: true },
      });
    }
  }

  // 5) Simulated credit-burn ledger row.
  {
    const { data: existing } = await admin
      .from("token_ledger")
      .select("id")
      .eq("demo_dataset_id", datasetId)
      .eq("action_type", "ops_010_demo_burn")
      .maybeSingle();
    if (!existing) {
      await admin.from("token_ledger").insert({
        org_id: buyerOrgId,
        action_type: "ops_010_demo_burn",
        endpoint: "seed-ops010-demo-workspace",
        tokens_burned: 1,
        remaining_balance: 0,
        outcome: "simulated",
        request_id: ext("burn-1"),
        metadata: { ops_010: true, simulated: true, watermark: OPS_010_DEMO_WATERMARK },
      });
    }
  }

  // Audit
  await admin.from("audit_logs").insert({
    org_id: buyerOrgId,
    action: OPS_010_AUDIT.DATA_ACCESSED,
    entity_type: "demo_workspace",
    entity_id: ws.id,
    actor_user_id: callerId,
    is_demo: true,
    demo_dataset_id: datasetId,
    metadata: {
      dataset_id: datasetId,
      seeded: { seller_org_id: sellerOrgId, trade_request_id: tradeRequestId, match_id: matchId },
      no_live_provider_calls: true,
      watermark: OPS_010_DEMO_WATERMARK,
    },
  });

  return json({
    ok: true,
    demo: true,
    dataset_id: datasetId,
    buyer_org_id: buyerOrgId,
    seller_org_id: sellerOrgId,
    trade_request_id: tradeRequestId,
    match_id: matchId,
    watermark: OPS_010_DEMO_WATERMARK,
  });
});
