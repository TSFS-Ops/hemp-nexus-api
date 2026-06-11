/**
 * generate-engagement-outreach-draft
 * ──────────────────────────────────────────────────────────────────────
 * Phase 1 of the AI Outreach Drafter + Human Approval Queue.
 *
 *   *** CRITICAL: this function NEVER sends anything. ***
 *
 * It produces a conservative outreach draft (subject + body + context
 * summary) for an admin-facilitated POI engagement and stores it in
 * `engagement_outreach_drafts` with status `pending_review`. Approval is
 * still a human gate, and even an approved draft must be sent manually by
 * the admin outside the platform — there is no dispatch path wired here.
 *
 * Hard rules:
 *   • Admin-only (is_admin RPC).
 *   • Engagement must exist; org must be loaded.
 *   • Frozen / restricted orgs are blocked.
 *   • No call to notification-dispatch, send-transactional-email, Resend,
 *     SMTP, Mailgun, Slack, or any other dispatch surface.
 *   • Writes audit_logs for every code path (generated / regenerated /
 *     access_denied).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { guardedAiCall } from "../_shared/ai-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

interface ReqBody {
  engagement_id: string;
  regenerate_from?: string | null;
  /** Optional admin steer (tone hint, e.g. "warmer", "more formal"). */
  tone_hint?: string;
}

interface DraftPayload {
  subject: string;
  body: string;
  context_summary: string;
  confidence: "low" | "medium" | "high";
}

function json(req: Request, body: unknown, status = 200) {
  return withCors(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  );
}

async function writeAudit(
  admin: ReturnType<typeof createClient>,
  orgId: string | null,
  actorUserId: string | null,
  action: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
) {
  try {
    await admin.from("audit_logs").insert({
      org_id: orgId,
      actor_user_id: actorUserId,
      action,
      entity_type: "engagement_outreach_draft",
      entity_id: entityId,
      metadata,
    });
  } catch (e) {
    console.warn("[generate-engagement-outreach-draft] audit insert failed", e);
  }
}

async function callDraftModel(
  admin: ReturnType<typeof createClient>,
  orgId: string,
  context: {
    counterparty_name: string;
    commodity: string | null;
    side: string | null;
    intel_summary: string | null;
    tone_hint?: string;
  },
): Promise<DraftPayload | null> {
  if (!LOVABLE_API_KEY) return null;

  const system = [
    "You are a conservative outreach drafter for a regulated commodity trading platform.",
    "Your job is to draft a short, professional outreach message to a NAMED counterparty on behalf of a platform admin.",
    "Hard rules:",
    "1. Never claim the counterparty has been verified, vetted, sanctioned, or approved.",
    "2. Never invent facts about the counterparty. Use ONLY the supplied context.",
    "3. Hedge: 'we understand you may', 'subject to your verification', 'please confirm'.",
    "4. Do not promise pricing, volumes, settlement terms, or compliance outcomes.",
    "5. Do not include unsubscribe links, tracking pixels, or marketing language.",
    "6. Keep subject under 120 characters; body under ~220 words; plain text.",
    "7. Output via the report_outreach_draft tool only.",
  ].join("\n");

  const user = [
    `Counterparty name: ${context.counterparty_name}`,
    context.commodity ? `Commodity: ${context.commodity}` : null,
    context.side ? `Their side: ${context.side}` : null,
    context.intel_summary ? `Public-source intel summary: ${context.intel_summary}` : null,
    context.tone_hint ? `Admin tone hint: ${context.tone_hint}` : null,
    "",
    "Produce a conservative outreach draft.",
  ].filter(Boolean).join("\n");

  const outcome = await guardedAiCall(admin as any, {
    org_id: orgId,
    call_type: "engagement_outreach_draft",
    body: {
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{
        type: "function",
        function: {
          name: "report_outreach_draft",
          description: "Return a structured conservative outreach draft.",
          parameters: {
            type: "object",
            properties: {
              subject: { type: "string" },
              body: { type: "string" },
              context_summary: { type: "string" },
              confidence: { type: "string", enum: ["low", "medium", "high"] },
            },
            required: ["subject", "body", "context_summary", "confidence"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "report_outreach_draft" } },
    },
  });

  if (outcome.kind !== "ok") return null;
  const args = (outcome.body as any)?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return null;
  try {
    return JSON.parse(args) as DraftPayload;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Auth ───────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorisation");
  if (!authHeader) return json(req, { error: "Unauthorised" }, 401);
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return json(req, { error: "Invalid token" }, 401);

  // ── Admin gate ─────────────────────────────────────────────────────
  const { data: isAdmin, error: roleErr } = await admin.rpc("is_admin", { user_id: user.id });
  if (roleErr) {
    console.error("[generate-engagement-outreach-draft] is_admin failed", roleErr);
    return json(req, { error: "Authorisation check failed" }, 500);
  }
  if (!isAdmin) {
    await writeAudit(admin, null, user.id, "engagement.outreach_draft.access_denied", null, {
      reason: "not_admin",
      path: "generate",
    });
    return json(req, { error: "Admin access required" }, 403);
  }

  // ── Body ───────────────────────────────────────────────────────────
  let body: ReqBody;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  if (!body?.engagement_id || typeof body.engagement_id !== "string") {
    return json(req, { error: "engagement_id required" }, 400);
  }

  // ── Load engagement + org ──────────────────────────────────────────
  const { data: eng, error: engErr } = await admin
    .from("poi_engagements")
    .select("id, org_id, counterparty_name, commodity, side")
    .eq("id", body.engagement_id)
    .maybeSingle();
  if (engErr) {
    console.error("[generate-engagement-outreach-draft] engagement load failed", engErr);
    return json(req, { error: "Could not load engagement" }, 500);
  }
  if (!eng) return json(req, { error: "Engagement not found" }, 404);

  // ── Org legitimacy / frozen gate ───────────────────────────────────
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, frozen, status")
    .eq("id", eng.org_id)
    .maybeSingle();
  if (orgErr || !org) return json(req, { error: "Could not load org" }, 500);
  if (org.frozen === true || org.status === "suspended" || org.status === "blocked") {
    await writeAudit(admin, eng.org_id, user.id, "engagement.outreach_draft.access_denied", null, {
      reason: "org_restricted",
      engagement_id: eng.id,
      frozen: org.frozen,
      status: org.status,
    });
    return json(req, { error: "Organisation is restricted; outreach drafting blocked." }, 403);
  }

  const regenerate = !!body.regenerate_from;

  await writeAudit(admin, eng.org_id, user.id,
    regenerate ? "engagement.outreach_draft.regenerated" : "engagement.outreach_draft.requested",
    eng.id, { engagement_id: eng.id, regenerate_from: body.regenerate_from ?? null });

  // ── Optional supporting intel ──────────────────────────────────────
  let intelSummary: string | null = null;
  try {
    const { data: intel } = await admin
      .from("match_counterparty_intel")
      .select("auto_summary")
      .eq("org_id", eng.org_id)
      .limit(1)
      .maybeSingle();
    intelSummary = intel?.auto_summary ?? null;
  } catch {
    // best-effort only
  }

  // ── Generate ───────────────────────────────────────────────────────
  const payload = await callDraftModel(admin, eng.org_id, {
    counterparty_name: (eng as any).counterparty_name ?? "Counterparty",
    commodity: (eng as any).commodity ?? null,
    side: (eng as any).side ?? null,
    intel_summary: intelSummary,
    tone_hint: body.tone_hint,
  });

  if (!payload) {
    return json(req, {
      error: LOVABLE_API_KEY
        ? "AI drafting did not return a usable response. Please retry."
        : "AI drafting is not configured on this environment.",
    }, 503);
  }

  const subject = payload.subject.slice(0, 200).trim();
  const draftBody = payload.body.trim();
  const ctx = payload.context_summary.trim();

  const { data: inserted, error: insErr } = await admin
    .from("engagement_outreach_drafts")
    .insert({
      engagement_id: eng.id,
      org_id: eng.org_id,
      status: "pending_review",
      draft_subject: subject,
      draft_body: draftBody,
      context_summary: ctx,
      model: "google/gemini-2.5-flash",
      ai_confidence: payload.confidence,
      created_by: user.id,
      regenerated_from: body.regenerate_from ?? null,
    })
    .select("*")
    .single();

  if (insErr || !inserted) {
    console.error("[generate-engagement-outreach-draft] insert failed", insErr);
    return json(req, { error: "Could not persist draft" }, 500);
  }

  await writeAudit(admin, eng.org_id, user.id, "engagement.outreach_draft.generated", inserted.id, {
    engagement_id: eng.id,
    draft_id: inserted.id,
    confidence: payload.confidence,
    regenerate_from: body.regenerate_from ?? null,
  });

  return json(req, { status: "ok", draft: inserted });
});
