/**
 * list-facilitation-cases — Phase 1 queue listing + Batch 8 management view.
 *
 * - Regular users see their org's cases (RLS).
 * - platform_admin / admin / compliance_analyst see all cases (RLS).
 *
 * Filters (all optional):
 *   status, urgency, assigned_to_me, overdue_only, q (case_number prefix),
 *   country (ISO/code), sector (substring), value_min, value_max, currency,
 *   open_or_closed ("open" | "closed"), final_outcome, requesting_org_id,
 *   owner_user_id, date_from, date_to (created_at ISO date strings),
 *   warning_only (is_overdue OR internal_status='blocked_by_compliance').
 *
 * Resolves requesting_org name + owner display name for the returned rows
 * (single batched lookup — no N+1).
 *
 * No mutations. No outreach. No notifications.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }));
}

const BodySchema = z.object({
  status: z.string().trim().max(64).nullable().optional(),
  urgency: z.enum(["low", "normal", "high", "critical"]).nullable().optional(),
  assigned_to_me: z.boolean().nullable().optional(),
  overdue_only: z.boolean().nullable().optional(),
  warning_only: z.boolean().nullable().optional(),
  q: z.string().trim().max(64).nullable().optional(),
  country: z.string().trim().max(64).nullable().optional(),
  sector: z.string().trim().max(64).nullable().optional(),
  value_min: z.number().nonnegative().nullable().optional(),
  value_max: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().length(3).nullable().optional(),
  open_or_closed: z.enum(["open", "closed"]).nullable().optional(),
  final_outcome: z.string().trim().max(64).nullable().optional(),
  requesting_org_id: z.string().uuid().nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).max(10000).default(0),
});

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
  const { data: claims, error: cerr } = await userClient.auth.getClaims(token);
  if (cerr || !claims?.claims?.sub) return json(req, { error: "Unauthorized" }, 401);
  const userId = claims.claims.sub as string;

  let parsed;
  try { parsed = BodySchema.safeParse(await req.json().catch(() => ({}))); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  if (!parsed.success) return json(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);
  const f = parsed.data;

  let q = userClient
    .from("facilitation_cases")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (f.status) q = q.eq("internal_status", f.status);
  if (f.urgency) q = q.eq("urgency", f.urgency);
  if (f.assigned_to_me) q = q.eq("case_owner_id", userId);
  if (f.overdue_only) q = q.eq("is_overdue", true);
  if (f.q) q = q.ilike("case_number", `${f.q}%`);
  if (f.country) q = q.ilike("counterparty_country", `%${f.country}%`);
  if (f.sector) q = q.ilike("sector", `%${f.sector}%`);
  if (f.currency) q = q.eq("estimated_value_currency", f.currency.toUpperCase());
  if (typeof f.value_min === "number") q = q.gte("estimated_value_amount", f.value_min);
  if (typeof f.value_max === "number") q = q.lte("estimated_value_amount", f.value_max);
  if (f.final_outcome) q = q.eq("final_outcome", f.final_outcome);
  if (f.requesting_org_id) q = q.eq("requesting_org_id", f.requesting_org_id);
  if (f.owner_user_id) q = q.eq("case_owner_id", f.owner_user_id);
  if (f.open_or_closed === "open") q = q.is("closed_at", null);
  if (f.open_or_closed === "closed") q = q.not("closed_at", "is", null);
  if (f.date_from) q = q.gte("created_at", `${f.date_from}T00:00:00Z`);
  if (f.date_to) q = q.lte("created_at", `${f.date_to}T23:59:59Z`);
  if (f.warning_only) {
    // Admin-friendly union: overdue OR blocked-by-compliance.
    q = q.or("is_overdue.eq.true,internal_status.eq.blocked_by_compliance");
  }
  q = q.range(f.offset, f.offset + f.limit - 1);

  const { data, error, count } = await q;
  if (error) return json(req, { error: error.message }, 500);

  // ── Resolve org / owner / requester labels for returned rows.
  const rows = (data ?? []) as Record<string, unknown>[];
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const orgIds = new Set<string>();
  const userIds = new Set<string>();
  for (const r of rows) {
    if (r.requesting_org_id) orgIds.add(r.requesting_org_id as string);
    if (r.linked_organization_id) orgIds.add(r.linked_organization_id as string);
    if (r.requesting_user_id) userIds.add(r.requesting_user_id as string);
    if (r.case_owner_id) userIds.add(r.case_owner_id as string);
  }
  const orgMap = new Map<string, string>();
  const userMap = new Map<string, string>();
  if (orgIds.size > 0) {
    const { data: orgs } = await admin.from("organizations").select("id, name").in("id", [...orgIds]);
    for (const o of (orgs ?? []) as { id: string; name: string }[]) orgMap.set(o.id, o.name);
  }
  if (userIds.size > 0) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [...userIds]);
    for (const p of (profs ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
      userMap.set(p.id, p.full_name || p.email || "—");
    }
  }
  // Enriched derived fields (do not overwrite raw columns).
  const enriched = rows.map((r) => ({
    ...r,
    requesting_org_name: r.requesting_org_id ? orgMap.get(r.requesting_org_id as string) ?? null : null,
    linked_organization_name: r.linked_organization_id ? orgMap.get(r.linked_organization_id as string) ?? null : null,
    requesting_user_label: r.requesting_user_id ? userMap.get(r.requesting_user_id as string) ?? null : null,
    case_owner_label: r.case_owner_id ? userMap.get(r.case_owner_id as string) ?? null : null,
  }));

  return json(req, { cases: enriched, total: count ?? 0 });
});
