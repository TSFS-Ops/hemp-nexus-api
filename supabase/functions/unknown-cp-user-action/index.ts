// P012 — Requester-driven actions: add more info, contact support, cancel request.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders } from "../_shared/cors.ts";
import {
  UNKNOWN_CP_STATUS_LABEL,
  UNKNOWN_CP_STATUS_COPY,
  UNKNOWN_CP_STATUS_GROUP,
  type UnknownCpStatus,
} from "../_shared/unknown-cp-timeline.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  facilitation_case_id: z.string().uuid(),
  action: z.enum(["add_more_information", "contact_support", "cancel_request"]),
  message_body: z.string().min(20).max(4000).optional(),
  reason: z
    .enum([
      "corrected_details",
      "supporting_document",
      "urgency",
      "cancellation_question",
      "other",
    ])
    .optional(),
  attachment_ids: z.array(z.string()).max(10).optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const input = parsed.data;
    if ((input.action === "add_more_information" || input.action === "contact_support") && !input.message_body) {
      return new Response(JSON.stringify({ error: "message_body_required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: caseRow, error: caseErr } = await svc
      .from("facilitation_cases")
      .select("id, requesting_user_id, poi_engagement_id")
      .eq("id", input.facilitation_case_id)
      .single();
    if (caseErr || !caseRow) {
      return new Response(JSON.stringify({ error: "case_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (caseRow.requesting_user_id !== user.id) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: overlay } = await svc
      .from("unknown_cp_case_overlays")
      .select("user_facing_status, status_group")
      .eq("facilitation_case_id", input.facilitation_case_id)
      .maybeSingle();

    const currentStatus = (overlay?.user_facing_status ?? "poi_created") as UnknownCpStatus;
    const closed = overlay?.status_group === "closed";

    if (input.action === "cancel_request" && closed) {
      return new Response(JSON.stringify({ error: "case_already_closed" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let category: string;
    let messageBody: string;
    if (input.action === "add_more_information") {
      category = input.reason ?? "other";
      messageBody = input.message_body!;
    } else if (input.action === "contact_support") {
      category = "contact_support";
      messageBody = input.message_body!;
    } else {
      category = "cancel_request";
      messageBody = "Requester confirmed cancellation of unknown-counterparty facilitation case.";
    }

    const { error: msgErr } = await svc.from("unknown_cp_user_messages").insert({
      facilitation_case_id: input.facilitation_case_id,
      poi_id: caseRow.poi_engagement_id ?? null,
      requester_user_id: user.id,
      message_category: category,
      message_body: messageBody,
      visibility: "admin_only",
      attachment_ids: input.attachment_ids ?? [],
      sent_to_support: input.action !== "cancel_request",
    });
    if (msgErr) throw msgErr;

    // Project a timeline event + status change where applicable.
    let newStatus: UnknownCpStatus = currentStatus;
    let auditName = "unknown_cp_user_message_added";
    let label = UNKNOWN_CP_STATUS_LABEL[currentStatus];
    let copy = UNKNOWN_CP_STATUS_COPY[currentStatus];

    if (input.action === "add_more_information") {
      newStatus = "additional_information_received";
      auditName = "unknown_cp_status_changed";
      label = UNKNOWN_CP_STATUS_LABEL[newStatus];
      copy = UNKNOWN_CP_STATUS_COPY[newStatus];
    } else if (input.action === "cancel_request") {
      newStatus = "cancelled_by_requester";
      auditName = "unknown_cp_case_closed";
      label = UNKNOWN_CP_STATUS_LABEL[newStatus];
      copy = UNKNOWN_CP_STATUS_COPY[newStatus];
    }

    if (newStatus !== currentStatus) {
      await svc
        .from("unknown_cp_case_overlays")
        .upsert(
          {
            facilitation_case_id: input.facilitation_case_id,
            poi_id: caseRow.poi_engagement_id ?? null,
            user_facing_status: newStatus,
            status_group: UNKNOWN_CP_STATUS_GROUP[newStatus],
          },
          { onConflict: "facilitation_case_id" },
        );
    }

    await svc.from("unknown_cp_timeline_events").insert({
      facilitation_case_id: input.facilitation_case_id,
      poi_id: caseRow.poi_engagement_id ?? null,
      previous_status: currentStatus,
      new_status: newStatus,
      status_label: label,
      user_visible: true,
      user_facing_copy: copy,
      reason_code: input.reason ?? null,
      actor_id: user.id,
      actor_role: "requester",
      actor_type: "requester",
      source: `requester_action:${input.action}`,
      audit_event_name: auditName,
      metadata: { attachment_count: (input.attachment_ids ?? []).length },
    });

    return new Response(JSON.stringify({ ok: true, new_status: newStatus }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("unknown-cp-user-action error", err);
    return new Response(JSON.stringify({ error: "internal_error", message: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
