/**
 * facilitation-case-admin-action — Phase 1 admin/requester triage actions.
 *
 * Supported actions:
 *   - assign           (admin only)        — set/clear case_owner_id
 *   - status_change    (admin or requester w/ allowed transition)
 *   - note             (any party with case visibility)
 *
 * No outreach, no notification, no email, no POI/WaD/match/token mutation.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  INTERNAL_STATUSES,
  OUTCOMES,
  isTransitionAllowed,
  type FacilitationInternalStatus,
} from "../_shared/facilitation-case-state.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }));
}

const StatusSchema = z.enum(INTERNAL_STATUSES as unknown as [string, ...string[]]);
const OutcomeSchema = z.enum(OUTCOMES as unknown as [string, ...string[]]);

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    case_id: z.string().uuid(),
    owner_user_id: z.string().uuid().nullable(),
  }),
  z.object({
    action: z.literal("status_change"),
    case_id: z.string().uuid(),
    to_status: StatusSchema,
    closing_reason: z.string().trim().min(3).max(2000).nullable().optional(),
    final_outcome: OutcomeSchema.nullable().optional(),
    linked_organization_id: z.string().uuid().nullable().optional(),
  }),
  z.object({
    action: z.literal("note"),
    case_id: z.string().uuid(),
    body: z.string().trim().min(2).max(4000),
  }),
]);

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
  try { parsed = BodySchema.safeParse(await req.json()); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  if (!parsed.success) return json(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Role detection.
  async function hasRole(role: string): Promise<boolean> {
    const { data } = await admin.rpc("has_role", { _user_id: userId, _role: role });
    return !!data;
  }
  const isPlatformAdmin = await hasRole("platform_admin");
  const isAdmin = isPlatformAdmin || (await hasRole("admin")) || (await hasRole("compliance_analyst"));

  // Load case via service role + caller-visibility re-check.
  const caseId = parsed.data.case_id;
  const { data: kase, error: kerr } = await admin.from("facilitation_cases").select("*").eq("id", caseId).maybeSingle();
  if (kerr) return json(req, { error: kerr.message }, 500);
  if (!kase) return json(req, { error: "Not found" }, 404);

  // Visibility: admin OR same-org requesting user OR assigned owner.
  const { data: profile } = await admin.from("profiles").select("org_id").eq("id", userId).maybeSingle();
  const isRequester = profile?.org_id === kase.requesting_org_id;
  const isOwner = kase.case_owner_id === userId;
  if (!(isAdmin || isRequester || isOwner)) return json(req, { error: "Forbidden" }, 403);

  if (parsed.data.action === "assign") {
    if (!isAdmin) return json(req, { error: "Only admins can assign cases" }, 403);
    const { error: uerr } = await admin.from("facilitation_cases")
      .update({ case_owner_id: parsed.data.owner_user_id }).eq("id", caseId);
    if (uerr) return json(req, { error: uerr.message }, 500);
    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: userId,
      action: "facilitation_case.assigned",
      from_status: kase.internal_status, to_status: kase.internal_status,
      payload: { owner_user_id: parsed.data.owner_user_id },
    });
    return json(req, { ok: true });
  }

  if (parsed.data.action === "status_change") {
    const role = isAdmin ? "admin" : "requester";
    const from = kase.internal_status as FacilitationInternalStatus;
    if (!isTransitionAllowed(from, parsed.data.to_status as FacilitationInternalStatus, role)) {
      return json(req, { error: "Transition not allowed", from, to: parsed.data.to_status, role }, 409);
    }
    const patch: Record<string, unknown> = { internal_status: parsed.data.to_status };
    if (parsed.data.closing_reason !== undefined) patch.closing_reason = parsed.data.closing_reason;
    if (parsed.data.final_outcome !== undefined) patch.final_outcome = parsed.data.final_outcome;
    if (parsed.data.linked_organization_id !== undefined) patch.linked_organization_id = parsed.data.linked_organization_id;
    if (["closed", "cancelled_by_requester", "unable_to_proceed", "converted_to_known_counterparty_poi"].includes(parsed.data.to_status)) {
      patch.closed_at = new Date().toISOString();
    }
    const { error: uerr } = await admin.from("facilitation_cases").update(patch).eq("id", caseId);
    if (uerr) return json(req, { error: uerr.message }, 500);

    const action = parsed.data.to_status === "cancelled_by_requester"
      ? "facilitation_case.cancelled_by_requester"
      : parsed.data.to_status === "closed"
        ? "facilitation_case.closed"
        : "facilitation_case.status_changed";

    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: userId,
      action,
      from_status: from, to_status: parsed.data.to_status,
      payload: {
        closing_reason: parsed.data.closing_reason ?? null,
        final_outcome: parsed.data.final_outcome ?? null,
        linked_organization_id: parsed.data.linked_organization_id ?? null,
      },
    });
    return json(req, { ok: true });
  }

  if (parsed.data.action === "note") {
    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: userId,
      action: "facilitation_case.note_added",
      from_status: kase.internal_status, to_status: kase.internal_status,
      payload: { body: parsed.data.body, by_admin: isAdmin },
    });
    return json(req, { ok: true });
  }

  return json(req, { error: "Unsupported action" }, 400);
});
