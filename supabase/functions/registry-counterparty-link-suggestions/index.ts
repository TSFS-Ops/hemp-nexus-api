// Unified counterparty/register suggestions for the Trade Desk.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { calculateMatchConfidence } from "../_shared/registry-counterparty-linking.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const Body = z.object({
  counterparty_id: z.string().max(120).optional(),
  counterparty_name: z.string().min(2).max(200),
  country_code: z.string().min(2).max(8).optional(),
  registration_number: z.string().max(60).optional(),
  legal_form: z.string().max(60).optional(),
  limit: z.number().int().min(1).max(25).optional(),
  cursor: z.string().uuid().optional(),
});

function json(req: Request, status: number, body: unknown) {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json(req, 401, { error: "unauthorized" });

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json(req, 400, { error: "invalid_body", details: parsed.error.flatten() });

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: profile } = await svc.from("profiles").select("org_id").eq("id", user.id).maybeSingle();
    if (!profile?.org_id) return json(req, 403, { error: "profile_org_required" });

    const input = parsed.data;
    let counterparty = {
      id: input.counterparty_id ?? `external:${input.counterparty_name}`,
      name: input.counterparty_name,
      countryCode: input.country_code ?? null,
      registrationNumber: input.registration_number ?? null,
      legalForm: input.legal_form ?? null,
    };

    if (input.counterparty_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.counterparty_id)) {
      const { data: cp } = await svc
        .from("counterparties")
        .select("id, company_name, jurisdiction, registration_number")
        .eq("id", input.counterparty_id)
        .maybeSingle();
      if (cp) {
        counterparty = {
          id: cp.id,
          name: cp.company_name,
          countryCode: input.country_code ?? cp.jurisdiction ?? null,
          registrationNumber: cp.registration_number ?? input.registration_number ?? null,
          legalForm: input.legal_form ?? null,
        };
      }
    }

    const terms = [counterparty.name, counterparty.registrationNumber].filter((v): v is string => !!v && v.trim().length >= 2);
    let query = svc
      .from("registry_company_records")
      .select("id, country_code, company_name, registration_number, legal_form, claim_status, claim_allowed, claim_blocked_reason, public_display_allowed")
      .eq("public_display_allowed", true)
      .order("id", { ascending: true });
    if (input.cursor) query = query.gt("id", input.cursor);
    if (counterparty.countryCode && /^[A-Z]{2,8}$/i.test(counterparty.countryCode)) query = query.eq("country_code", counterparty.countryCode.toUpperCase());
    if (terms.length > 0) {
      const escaped = terms.map((t) => t.replace(/[%_\\]/g, "")).filter(Boolean);
      query = query.or(escaped.map((t) => `company_name.ilike.%${t}%,registration_number.ilike.%${t}%`).join(","));
    }

    const limit = input.limit ?? 10;
    const { data: rows, error } = await query.limit(limit + 1);
    if (error) throw error;

    const candidates = (rows ?? []).map((r: any) => {
      const confidence = calculateMatchConfidence(counterparty, {
        id: r.id,
        name: r.company_name,
        countryCode: r.country_code,
        registrationNumber: r.registration_number,
        legalForm: r.legal_form,
      });
      return {
        state: confidence.score >= 80 ? "candidate_match" : "registry_only",
        counterparty,
        registry: {
          id: r.id,
          name: r.company_name,
          countryCode: r.country_code,
          registrationNumber: r.registration_number,
          legalForm: r.legal_form,
          claimStatus: r.claim_status,
          claimAvailable: r.claim_allowed === true && !r.claim_blocked_reason,
        },
        score: confidence.score,
        breakdown: confidence.breakdown,
      };
    }).sort((a, b) => b.score - a.score);

    const page = candidates.slice(0, limit);
    const hasMore = (rows ?? []).length > limit;
    const nextCursor = hasMore && rows?.[limit - 1]?.id ? rows[limit - 1].id : null;
    const suggestions = page.some((s) => s.state === "candidate_match")
      ? page
      : [{ state: "counterparty_only", counterparty, score: 0, breakdown: null }, ...page];

    await svc.from("event_store").insert({
      org_id: profile.org_id,
      domain: "registry",
      aggregate_type: "registry_counterparty_link_suggestions",
      aggregate_id: crypto.randomUUID(),
      event_type: "registry_counterparty_link_suggestions_fetched",
      actor_id: user.id,
      payload: { counterparty_id: counterparty.id, result_count: suggestions.length },
      event_hash: crypto.randomUUID(),
    }).catch(() => {});

    return json(req, 200, { ok: true, suggestions, next_cursor: nextCursor });
  } catch (e) {
    console.error("registry-counterparty-link-suggestions error", e);
    return json(req, 500, { error: "internal", message: (e as Error).message });
  }
});