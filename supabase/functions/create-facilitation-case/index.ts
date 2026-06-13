/**
 * create-facilitation-case — Phase 1 intake.
 *
 * Authenticated user submits a new unknown-counterparty facilitation case.
 * No outreach, notification, POI/WaD/match/token mutation is performed here.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  trade_request_id: z.string().uuid(),
  poi_engagement_id: z.string().uuid().nullable().optional(),
  counterparty_legal_name: z.string().trim().min(2).max(255),
  counterparty_trading_name: z.string().trim().max(255).nullable().optional(),
  counterparty_country: z.string().trim().min(2).max(120),
  counterparty_city: z.string().trim().max(120).nullable().optional(),
  counterparty_website: z.string().trim().max(255).nullable().optional(),
  counterparty_email: z.string().trim().email().max(255).nullable().optional(),
  counterparty_phone: z.string().trim().max(64).nullable().optional(),
  counterparty_contact_name: z.string().trim().max(255).nullable().optional(),
  product_or_commodity: z.string().trim().min(2).max(500),
  role: z.enum(["buyer", "seller"]),
  estimated_value_amount: z.number().nonnegative().max(1e15),
  estimated_value_currency: z.string().trim().min(3).max(8),
  urgency: z.enum(["low", "normal", "high", "critical"]),
  reason: z.string().trim().min(10).max(2000),
  how_user_knows_counterparty: z.string().trim().min(2).max(500),
  how_user_knows_notes: z.string().trim().max(2000).nullable().optional(),
  permission_to_contact: z.boolean(),
  user_declaration_accepted: z.literal(true),
});

function json(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }));
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(req, { error: "Unauthorized" }, 401);

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return json(req, { error: "Unauthorized" }, 401);
  const userId = claims.claims.sub as string;

  let parsed;
  try {
    parsed = BodySchema.safeParse(await req.json());
  } catch {
    return json(req, { error: "Invalid JSON" }, 400);
  }
  if (!parsed.success) return json(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Resolve requester org from profile.
  const { data: profile } = await admin.from("profiles").select("org_id").eq("id", userId).maybeSingle();
  if (!profile?.org_id) return json(req, { error: "No organization for user" }, 403);

  // Verify the trade_request belongs to the requester's org.
  const { data: tr } = await admin.from("trade_requests").select("id, org_id").eq("id", parsed.data.trade_request_id).maybeSingle();
  if (!tr || tr.org_id !== profile.org_id) return json(req, { error: "trade_request_id not accessible" }, 403);

  const insertRow = {
    requesting_org_id: profile.org_id,
    requesting_user_id: userId,
    trade_request_id: parsed.data.trade_request_id,
    poi_engagement_id: parsed.data.poi_engagement_id ?? null,
    counterparty_legal_name: parsed.data.counterparty_legal_name,
    counterparty_trading_name: parsed.data.counterparty_trading_name ?? null,
    counterparty_country: parsed.data.counterparty_country,
    counterparty_city: parsed.data.counterparty_city ?? null,
    counterparty_website: parsed.data.counterparty_website ?? null,
    counterparty_email: parsed.data.counterparty_email ?? null,
    counterparty_phone: parsed.data.counterparty_phone ?? null,
    counterparty_contact_name: parsed.data.counterparty_contact_name ?? null,
    product_or_commodity: parsed.data.product_or_commodity,
    role: parsed.data.role,
    estimated_value_amount: parsed.data.estimated_value_amount,
    estimated_value_currency: parsed.data.estimated_value_currency.toUpperCase(),
    urgency: parsed.data.urgency,
    reason: parsed.data.reason,
    how_user_knows_counterparty: parsed.data.how_user_knows_counterparty,
    how_user_knows_notes: parsed.data.how_user_knows_notes ?? null,
    permission_to_contact: parsed.data.permission_to_contact,
    user_declaration_accepted: parsed.data.user_declaration_accepted,
    internal_status: "new",
    case_number: "",
  };

  const { data: created, error: insErr } = await admin.from("facilitation_cases").insert(insertRow).select("*").single();
  if (insErr || !created) return json(req, { error: "Insert failed", details: insErr?.message }, 500);

  await admin.from("facilitation_case_events").insert({
    case_id: created.id,
    actor_user_id: userId,
    action: "facilitation_case.created",
    from_status: null,
    to_status: "new",
    payload: { case_number: created.case_number, urgency: parsed.data.urgency },
  });

  return json(req, { case: created }, 201);
});
