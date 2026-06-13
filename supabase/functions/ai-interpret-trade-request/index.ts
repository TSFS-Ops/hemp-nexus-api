/**
 * ai-interpret-trade-request
 * ──────────────────────────────────────────────────────────────────────
 * AI Counterparty Intelligence & Match Review — Batch 1.
 *
 * Reads a trade_request and uses Lovable AI (tool-calling) to extract a
 * structured interpretation into `ai_trade_request_interpretations`.
 *
 * STRICT scope:
 *   - platform_admin only (authenticateRequest + requireRole).
 *   - NO outreach, NO POI creation, NO verification claim, NO match mutation.
 *   - Every call audits as `ai_review.trade_request_interpreted`.
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

    const { trade_request_id } = await req.json().catch(() => ({}));
    if (!trade_request_id || typeof trade_request_id !== "string") {
      return json(400, { error: "trade_request_id is required" });
    }

    const { data: tr, error: trErr } = await admin
      .from("trade_requests")
      .select("*")
      .eq("id", trade_request_id)
      .maybeSingle();
    if (trErr) throw trErr;
    if (!tr) return json(404, { error: "trade_request not found" });

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json(500, { error: "LOVABLE_API_KEY missing" });

    const tool = {
      type: "function" as const,
      function: {
        name: "interpret_trade_request",
        description: "Extract a structured interpretation of a trade request for admin review.",
        parameters: {
          type: "object",
          properties: {
            commodity_or_service: { type: "string" },
            side: { type: "string", enum: ["buyer", "seller", "unknown"] },
            geography: { type: "string" },
            quantity: { type: "string" },
            timing: { type: "string" },
            documentation_requirements: { type: "array", items: { type: "string" } },
            commercial_intent: { type: "string" },
            preferred_counterparty_type: { type: "string" },
            jurisdiction_requirements: { type: "array", items: { type: "string" } },
            risk_indicators: { type: "array", items: { type: "string" } },
            ai_confidence: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: [
            "commodity_or_service", "side", "geography", "quantity", "timing",
            "documentation_requirements", "commercial_intent", "preferred_counterparty_type",
            "jurisdiction_requirements", "risk_indicators", "ai_confidence",
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
              "You interpret commodity trade requests for an admin review queue. " +
              "Do NOT contact anyone. Do NOT claim verification. Be conservative. " +
              "If a field is not stated, set it to an empty string or empty array.",
          },
          { role: "user", content: JSON.stringify(tr) },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "interpret_trade_request" } },
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      return json(aiResp.status, { error: "AI gateway error", detail: txt.slice(0, 500) });
    }

    const ai = await aiResp.json();
    const args = ai?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return json(502, { error: "AI returned no structured interpretation" });
    const parsed = JSON.parse(args);

    const { data: row, error: insErr } = await admin
      .from("ai_trade_request_interpretations")
      .insert({
        trade_request_id,
        commodity_or_service: parsed.commodity_or_service || null,
        side: parsed.side || "unknown",
        geography: parsed.geography || null,
        quantity: parsed.quantity || null,
        timing: parsed.timing || null,
        documentation_requirements: parsed.documentation_requirements ?? [],
        commercial_intent: parsed.commercial_intent || null,
        preferred_counterparty_type: parsed.preferred_counterparty_type || null,
        jurisdiction_requirements: parsed.jurisdiction_requirements ?? [],
        risk_indicators: parsed.risk_indicators ?? [],
        model: "google/gemini-3-flash-preview",
        ai_confidence: parsed.ai_confidence || null,
        raw_extraction: parsed,
        created_by: userId,
      })
      .select()
      .single();
    if (insErr) throw insErr;

    await writeAdminAudit({
      admin,
      action: "ai_review.trade_request_interpreted",
      status: "success",
      actorUserId: userId,
      targetType: "ai_trade_request_interpretation",
      targetId: row.id,
      requestId,
      endpoint: "ai-interpret-trade-request",
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
      extra: { trade_request_id, ai_confidence: parsed.ai_confidence },
    });

    return json(200, { interpretation: row });
  } catch (e: any) {
    console.error("[ai-interpret-trade-request] error:", e);
    const status = e?.statusCode ?? 500;
    await writeAdminAudit({
      admin,
      action: "ai_review.trade_request_interpreted",
      status: "error",
      actorUserId: userId,
      targetType: "ai_trade_request_interpretation",
      requestId,
      endpoint: "ai-interpret-trade-request",
      reason: e?.message ?? "unknown",
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
    }).catch(() => {});
    return json(status, { error: e?.message ?? "internal error" });
  }
}
