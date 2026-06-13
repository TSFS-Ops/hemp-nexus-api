/**
 * ai-outreach-draft-v2
 * ──────────────────────────────────────────────────────────────────────
 * AI Counterparty Intelligence & Match Review — Batch 4.
 *
 * Generates an outreach draft from an APPROVED `ai_proposed_matches` row.
 *
 * HARD GUARANTEES — re-verified in code, not just policy:
 *   - platform_admin only.
 *   - Proposed match MUST be in status='approved' or generation is blocked.
 *   - Active do-not-contact rules are re-checked AT DRAFT TIME (even though
 *     sourcing already filtered). DNC hit → 409, no row written, dedicated
 *     audit emitted.
 *   - Draft rows are written ONLY to `ai_outreach_drafts_v2`. The legacy
 *     Phase 1 `engagement_outreach_drafts` table is NEVER touched here.
 *   - No provider call (no email, SMS, WhatsApp, notification). The draft
 *     is text persisted to the database. Nothing leaves the platform.
 *   - "Send manually" is handled by the decision edge function and only
 *     marks `sent_by_human`; this function does not send anything.
 *
 * Body:
 *   { proposed_match_id: string, regenerate_from?: string, tone_hint?: string }
 *
 * Audits (canonical names only — pinned by check-ai-review-audit-names.mjs):
 *   - ai_review.outreach_draft_created (success)   on insert
 *   - ai_review.outreach_draft_rejected (success)  on DNC auto-block (no row)
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { clampSubject } from "../_shared/email-subject.ts";
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

    const body = await req.json().catch(() => ({}));
    const proposed_match_id = typeof body?.proposed_match_id === "string" ? body.proposed_match_id : null;
    const regenerate_from = typeof body?.regenerate_from === "string" ? body.regenerate_from : null;
    const tone_hint = typeof body?.tone_hint === "string" ? body.tone_hint.slice(0, 200) : null;

    if (!proposed_match_id) return json(400, { error: "proposed_match_id is required" });

    // ── Load the proposed match and enforce APPROVED gating ─────────────
    const pm = await admin
      .from("ai_proposed_matches")
      .select("*")
      .eq("id", proposed_match_id)
      .maybeSingle();
    if (pm.error) throw pm.error;
    if (!pm.data) return json(404, { error: "proposed match not found" });
    if (pm.data.status !== "approved") {
      return json(409, {
        error: "proposed match must be in status='approved' before drafting outreach",
        current_status: pm.data.status,
      });
    }

    // Load related trade request for context
    const tr = await admin
      .from("trade_requests")
      .select("*")
      .eq("id", pm.data.trade_request_id)
      .maybeSingle();
    if (tr.error) throw tr.error;

    // ── DNC re-check at draft time (defence-in-depth) ───────────────────
    const dnc = await admin
      .from("ai_do_not_contact_rules")
      .select("id, rule_type, rule_value, reason")
      .eq("active", true);
    if (dnc.error) throw dnc.error;

    const name = (pm.data.suggested_counterparty_name ?? "").toLowerCase();
    const orgId = pm.data.suggested_counterparty_org_id;
    const juris = (pm.data.jurisdiction ?? "").toLowerCase();

    const hit = (dnc.data ?? []).find((r: any) => {
      const v = (r.rule_value ?? "").toLowerCase();
      if (r.rule_type === "organisation") return orgId && r.rule_value === orgId;
      if (r.rule_type === "specific_counterparty") return v === name;
      if (r.rule_type === "jurisdiction") return v && v === juris;
      return false;
    });

    if (hit) {
      await writeAdminAudit({
        admin,
        action: "ai_review.outreach_draft_rejected",
        status: "success",
        actorUserId: userId,
        targetType: "ai_proposed_match",
        targetId: proposed_match_id,
        requestId,
        endpoint: "ai-outreach-draft-v2",
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
        extra: {
          auto_blocked: true,
          reason: "dnc_hit",
          dnc_rule_id: hit.id,
          dnc_rule_type: hit.rule_type,
          dnc_rule_value: hit.rule_value,
        },
      });
      return json(409, {
        error: "Draft blocked by active do-not-contact rule",
        dnc_rule: { id: hit.id, rule_type: hit.rule_type, rule_value: hit.rule_value, reason: hit.reason },
      });
    }

    // ── Call Lovable AI to draft text (no provider, no send) ────────────
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json(500, { error: "LOVABLE_API_KEY missing" });

    const tool = {
      type: "function" as const,
      function: {
        name: "compose_outreach_draft",
        description:
          "Compose a short, professional outreach draft for an admin to review. " +
          "Never describe any counterparty as 'verified'. The draft is for a HUMAN to send manually; " +
          "do not include automated dispatch language, tracking links, or anything implying the platform sends it.",
        parameters: {
          type: "object",
          properties: {
            subject: { type: "string" },
            body: { type: "string" },
          },
          required: ["subject", "body"],
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
              "You draft initial outreach emails for an admin reviewer. " +
              "The admin will copy the text and send it manually from their own email client. " +
              "Be concise, neutral, and professional. Do NOT promise verification. " +
              "Do NOT claim the counterparty is already approved by the platform. " +
              "Do NOT include tracking pixels, unsubscribe links, or send-from-platform language.",
          },
          {
            role: "user",
            content: JSON.stringify({
              trade_request: tr.data ?? null,
              proposed_match: pm.data,
              tone_hint,
              regenerated: !!regenerate_from,
            }),
          },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "compose_outreach_draft" } },
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      if (aiResp.status === 429) return json(429, { error: "Rate limited by AI gateway. Try again shortly." });
      if (aiResp.status === 402) return json(402, { error: "AI credits exhausted. Add credits to continue." });
      return json(aiResp.status, { error: "AI gateway error", detail: txt.slice(0, 500) });
    }

    const ai = await aiResp.json();
    const args = ai?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return json(502, { error: "AI returned no draft" });

    let subject = "";
    let bodyText = "";
    try {
      const parsed = JSON.parse(args);
      subject = clampSubject(String(parsed?.subject ?? ""));
      bodyText = String(parsed?.body ?? "").slice(0, 6000);
    } catch {
      return json(502, { error: "AI returned malformed draft payload" });
    }
    if (!subject.trim() || !bodyText.trim()) {
      return json(502, { error: "AI returned an empty draft" });
    }

    const ins = await admin
      .from("ai_outreach_drafts_v2")
      .insert({
        proposed_match_id,
        trade_request_id: pm.data.trade_request_id,
        recipient_name: pm.data.suggested_counterparty_name,
        recipient_organisation: pm.data.suggested_counterparty_name,
        draft_subject: subject,
        draft_body: bodyText,
        draft_status: "draft_created",
        created_by_ai: true,
        created_by_user_id: userId,
        model: "google/gemini-3-flash-preview",
      })
      .select()
      .maybeSingle();
    if (ins.error) throw ins.error;

    await writeAdminAudit({
      admin,
      action: "ai_review.outreach_draft_created",
      status: "success",
      actorUserId: userId,
      targetType: "ai_outreach_draft_v2",
      targetId: ins.data?.id,
      requestId,
      endpoint: "ai-outreach-draft-v2",
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
      extra: {
        proposed_match_id,
        trade_request_id: pm.data.trade_request_id,
        regenerated_from: regenerate_from,
      },
    });

    return json(200, { draft: ins.data });
  } catch (e: unknown) {
    const err = e as { statusCode?: number; message?: string };
    console.error("[ai-outreach-draft-v2] error:", err);
    return json(err?.statusCode ?? 500, { error: err?.message ?? "internal error" });
  }
}
