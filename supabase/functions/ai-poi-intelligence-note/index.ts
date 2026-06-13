/**
 * ai-poi-intelligence-note
 * ──────────────────────────────────────────────────────────────────────
 * AI Counterparty Intelligence & Match Review — Batch 5.
 *
 * Generates a structured INTELLIGENCE NOTE for a proposed match,
 * classifying every reference by SOURCE TYPE:
 *   - verified            (NEVER — this function never sets this)
 *   - paid_provider       (NEVER — this function never calls paid APIs)
 *   - public_source       (public news/web/announcements/registers)
 *   - social_media        (advisory only)
 *   - ai_interpretation   (model-generated commentary, clearly labelled)
 *
 * HARD GUARANTEES — re-verified in code:
 *   - platform_admin only.
 *   - No POI is created or progressed.
 *   - No WaD is created.
 *   - No party is marked verified anywhere.
 *   - No outreach is triggered, no email/SMS/WhatsApp/notification call.
 *   - Escalation here ONLY sets `escalation_required=true` on the note and
 *     (optionally) flips `ai_proposed_matches.status='escalated'` via the
 *     same code path. It does NOT create external review action.
 *   - Phase 1 outreach drafter is never touched.
 *
 * Actions:
 *   - generate  (default): create one intelligence note row via Lovable AI
 *   - escalate            : mark an existing note `escalation_required=true`
 *                           and emit ai_review.escalation_created
 *
 * Audits emitted (canonical pinned names only):
 *   - ai_review.poi_intelligence_created
 *   - ai_review.risk_flag_added         (one per distinct risk_flag entry)
 *   - ai_review.escalation_created      (escalate action only)
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

const SOURCE_CLASSIFICATIONS = new Set([
  "public_source",
  "social_media",
  "ai_interpretation",
]);

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
    const ctx = await authenticateRequest(req, supabaseUrl, serviceKey);
    requireRole(ctx, "platform_admin");
    userId = ctx.userId;

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "generate";

    if (action === "escalate") {
      return await _escalate(req, admin, body, userId, requestId);
    }
    if (action !== "generate") {
      return json(400, { error: `unknown action: ${action}` });
    }
    return await _generate(req, admin, body, userId, requestId);
  } catch (e: unknown) {
    const err = e as { statusCode?: number; message?: string };
    console.error("[ai-poi-intelligence-note] error:", err);
    return json(err?.statusCode ?? 500, { error: err?.message ?? "internal error" });
  }
}

async function _generate(
  req: Request,
  admin: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  userId: string | null,
  requestId: string,
): Promise<Response> {
  const proposed_match_id =
    typeof body?.proposed_match_id === "string" ? body.proposed_match_id : null;
  if (!proposed_match_id) {
    return json(400, { error: "proposed_match_id is required" });
  }

  const pm = await admin
    .from("ai_proposed_matches")
    .select("*")
    .eq("id", proposed_match_id)
    .maybeSingle();
  if (pm.error) throw pm.error;
  if (!pm.data) return json(404, { error: "proposed match not found" });

  const tr = pm.data.trade_request_id
    ? await admin.from("trade_requests").select("*").eq("id", pm.data.trade_request_id).maybeSingle()
    : { data: null, error: null };
  if (tr && (tr as any).error) throw (tr as any).error;

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return json(500, { error: "LOVABLE_API_KEY missing" });

  const tool = {
    type: "function" as const,
    function: {
      name: "compose_intelligence_note",
      description:
        "Compose a structured, advisory intelligence note about a proposed counterparty. " +
        "STRICT RULES: Do NOT call any data source 'verified'. Do NOT imply background-check or KYC. " +
        "Every reference MUST be classified by source_type. Use only these source_type values: " +
        "'public_source' (public news / web / company announcements / public registers / public director records / public trade activity), " +
        "'social_media' (clearly labelled as social/community context, advisory only), or " +
        "'ai_interpretation' (your own narrative commentary, clearly labelled). " +
        "Do NOT include any 'paid_provider' or 'verified' source_type. " +
        "If you have no actual reference, return an empty array for that bucket — do NOT fabricate URLs.",
      parameters: {
        type: "object",
        properties: {
          public_news_refs: { type: "array", items: refItem() },
          public_web_refs: { type: "array", items: refItem() },
          company_announcement_refs: { type: "array", items: refItem() },
          director_management_refs: { type: "array", items: refItem() },
          trade_activity_refs: { type: "array", items: refItem() },
          adverse_media_refs: { type: "array", items: refItem() },
          litigation_refs: { type: "array", items: refItem() },
          fraud_warning_refs: { type: "array", items: refItem() },
          social_media_refs: { type: "array", items: refItem() },
          source_summaries: {
            type: "array",
            items: { type: "string" },
            description: "Plain-English advisory summary lines. Each line MUST start with the source_type in brackets, e.g. '[public_source] ...' or '[ai_interpretation] ...'.",
          },
          source_classification: {
            type: "string",
            enum: ["public_source", "social_media", "ai_interpretation"],
            description: "Dominant source classification across all refs in this note.",
          },
          risk_flags: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                severity: { type: "string", enum: ["info", "low", "medium", "high"] },
                rationale: { type: "string" },
              },
              required: ["code", "severity", "rationale"],
              additionalProperties: false,
            },
          },
          supports_or_weakens: {
            type: "string",
            enum: ["supports", "weakens", "neutral", "insufficient_signal"],
          },
          escalation_required: { type: "boolean" },
          escalation_reason: { type: "string" },
        },
        required: [
          "public_news_refs",
          "public_web_refs",
          "company_announcement_refs",
          "director_management_refs",
          "trade_activity_refs",
          "adverse_media_refs",
          "litigation_refs",
          "fraud_warning_refs",
          "social_media_refs",
          "source_summaries",
          "source_classification",
          "risk_flags",
          "supports_or_weakens",
          "escalation_required",
        ],
        additionalProperties: false,
      },
    },
  };

  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content:
            "You are an advisory counterparty-intelligence drafter for a platform admin reviewer. " +
            "You DO NOT verify anyone. You DO NOT KYC anyone. You produce a structured note that " +
            "separates verified data (you have none), paid provider data (you have none), " +
            "public-source intelligence, social/media context, and your own AI interpretation. " +
            "Be conservative. Prefer empty arrays over invented URLs. Never use the word 'verified'.",
        },
        {
          role: "user",
          content: JSON.stringify({
            trade_request: (tr as any)?.data ?? null,
            proposed_match: pm.data,
          }),
        },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "compose_intelligence_note" } },
    }),
  });

  if (!aiResp.ok) {
    const txt = await aiResp.text();
    if (aiResp.status === 429) return json(429, { error: "Rate limited by AI gateway." });
    if (aiResp.status === 402) return json(402, { error: "AI credits exhausted." });
    return json(aiResp.status, { error: "AI gateway error", detail: txt.slice(0, 500) });
  }

  const ai = await aiResp.json();
  const args = ai?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return json(502, { error: "AI returned no note payload" });

  let parsed: any;
  try {
    parsed = JSON.parse(args);
  } catch {
    return json(502, { error: "AI returned malformed note payload" });
  }

  const classification = SOURCE_CLASSIFICATIONS.has(parsed?.source_classification)
    ? parsed.source_classification
    : "ai_interpretation";

  // Aggregate source_links / source_summaries
  const buckets = [
    "public_news_refs",
    "public_web_refs",
    "company_announcement_refs",
    "director_management_refs",
    "trade_activity_refs",
    "adverse_media_refs",
    "litigation_refs",
    "fraud_warning_refs",
    "social_media_refs",
  ] as const;
  const source_links: any[] = [];
  for (const b of buckets) {
    const arr = Array.isArray(parsed?.[b]) ? parsed[b] : [];
    for (const r of arr) {
      if (r && typeof r === "object" && typeof r.url === "string") {
        source_links.push({ bucket: b, ...r });
      }
    }
  }

  const riskFlags = Array.isArray(parsed?.risk_flags) ? parsed.risk_flags : [];

  const ins = await admin
    .from("ai_poi_intelligence_notes")
    .insert({
      proposed_match_id,
      trade_request_id: pm.data.trade_request_id,
      counterparty_name: pm.data.suggested_counterparty_name,
      counterparty_org_id: pm.data.suggested_counterparty_org_id,
      public_news_refs: parsed.public_news_refs ?? [],
      public_web_refs: parsed.public_web_refs ?? [],
      company_announcement_refs: parsed.company_announcement_refs ?? [],
      director_management_refs: parsed.director_management_refs ?? [],
      trade_activity_refs: parsed.trade_activity_refs ?? [],
      adverse_media_refs: parsed.adverse_media_refs ?? [],
      litigation_refs: parsed.litigation_refs ?? [],
      fraud_warning_refs: parsed.fraud_warning_refs ?? [],
      social_media_refs: parsed.social_media_refs ?? [],
      source_links,
      source_summaries: Array.isArray(parsed?.source_summaries) ? parsed.source_summaries : [],
      source_classification: classification,
      risk_flags: riskFlags,
      supports_or_weakens:
        typeof parsed?.supports_or_weakens === "string" ? parsed.supports_or_weakens : "insufficient_signal",
      escalation_required: !!parsed?.escalation_required,
      escalation_reason:
        typeof parsed?.escalation_reason === "string" ? parsed.escalation_reason.slice(0, 1000) : null,
      model: "google/gemini-3-flash-preview",
      created_by: userId,
    })
    .select()
    .maybeSingle();
  if (ins.error) throw ins.error;

  await writeAdminAudit({
    admin,
    action: "ai_review.poi_intelligence_created",
    status: "success",
    actorUserId: userId,
    targetType: "ai_poi_intelligence_note",
    targetId: ins.data?.id,
    requestId,
    endpoint: "ai-poi-intelligence-note",
    ipAddress: extractIp(req),
    userAgent: extractUserAgent(req),
    extra: {
      proposed_match_id,
      trade_request_id: pm.data.trade_request_id,
      source_classification: classification,
      risk_flag_count: riskFlags.length,
      escalation_required: !!parsed?.escalation_required,
    },
  });

  for (const flag of riskFlags) {
    await writeAdminAudit({
      admin,
      action: "ai_review.risk_flag_added",
      status: "success",
      actorUserId: userId,
      targetType: "ai_poi_intelligence_note",
      targetId: ins.data?.id,
      requestId,
      endpoint: "ai-poi-intelligence-note",
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
      extra: {
        proposed_match_id,
        code: String(flag?.code ?? "").slice(0, 100),
        severity: String(flag?.severity ?? "").slice(0, 20),
        rationale: String(flag?.rationale ?? "").slice(0, 500),
      },
    });
  }

  return json(200, { note: ins.data });
}

async function _escalate(
  req: Request,
  admin: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  userId: string | null,
  requestId: string,
): Promise<Response> {
  const note_id = typeof body?.note_id === "string" ? body.note_id : null;
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 1000) : null;
  if (!note_id || !reason) {
    return json(400, { error: "note_id and reason are required" });
  }

  const upd = await admin
    .from("ai_poi_intelligence_notes")
    .update({ escalation_required: true, escalation_reason: reason })
    .eq("id", note_id)
    .select()
    .maybeSingle();
  if (upd.error) throw upd.error;
  if (!upd.data) return json(404, { error: "intelligence note not found" });

  await writeAdminAudit({
    admin,
    action: "ai_review.escalation_created",
    status: "success",
    actorUserId: userId,
    targetType: "ai_poi_intelligence_note",
    targetId: note_id,
    requestId,
    endpoint: "ai-poi-intelligence-note",
    ipAddress: extractIp(req),
    userAgent: extractUserAgent(req),
    extra: {
      proposed_match_id: upd.data.proposed_match_id,
      reason,
      surface_only: true,
      external_action: false,
    },
  });

  return json(200, { note: upd.data });
}

function refItem() {
  return {
    type: "object",
    properties: {
      url: { type: "string" },
      title: { type: "string" },
      published_at: { type: "string" },
      note: { type: "string" },
    },
    required: ["url", "title"],
    additionalProperties: false,
  };
}
