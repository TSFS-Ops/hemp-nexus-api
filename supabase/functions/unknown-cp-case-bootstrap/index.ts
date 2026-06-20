// P012 — Bootstrap overlay + initial timeline events when an unknown-counterparty
// facilitation case exists but has no overlay yet. Idempotent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders } from "../_shared/cors.ts";
import {
  UNKNOWN_CP_STATUS_LABEL,
  UNKNOWN_CP_STATUS_COPY,
} from "../_shared/unknown-cp-timeline.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({ facilitation_case_id: z.string().uuid() });

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
      return new Response(JSON.stringify({ error: "invalid_body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: caseRow, error } = await svc
      .from("facilitation_cases")
      .select("id, requesting_user_id, requesting_org_id, poi_engagement_id, trade_request_id")
      .eq("id", parsed.data.facilitation_case_id)
      .single();
    if (error || !caseRow) {
      return new Response(JSON.stringify({ error: "case_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (caseRow.requesting_user_id !== user.id) {
      // allow admins
      const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
      const ok = (roles ?? []).some((r: { role: string }) =>
        ["platform_admin", "compliance_owner", "compliance_admin", "admin"].includes(r.role),
      );
      if (!ok) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: existing } = await svc
      .from("unknown_cp_case_overlays")
      .select("id")
      .eq("facilitation_case_id", caseRow.id)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ ok: true, bootstrapped: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await svc.from("unknown_cp_case_overlays").insert({
      facilitation_case_id: caseRow.id,
      poi_id: caseRow.poi_engagement_id ?? null,
      user_facing_status: "facilitation_case_opened",
      status_group: "open",
    });

    const events = [
      {
        new_status: "poi_created",
        label: UNKNOWN_CP_STATUS_LABEL.poi_created,
        copy: UNKNOWN_CP_STATUS_COPY.poi_created,
        audit: "unknown_cp_case_created",
        source: "system:poi_created",
      },
      {
        new_status: "facilitation_case_opened",
        label: UNKNOWN_CP_STATUS_LABEL.facilitation_case_opened,
        copy: UNKNOWN_CP_STATUS_COPY.facilitation_case_opened,
        audit: "unknown_cp_status_changed",
        source: "system:case_opened",
      },
    ];

    for (const e of events) {
      await svc.from("unknown_cp_timeline_events").insert({
        facilitation_case_id: caseRow.id,
        poi_id: caseRow.poi_engagement_id ?? null,
        previous_status: null,
        new_status: e.new_status,
        status_label: e.label,
        user_visible: true,
        user_facing_copy: e.copy,
        actor_id: null,
        actor_role: "system",
        actor_type: "system",
        source: e.source,
        audit_event_name: e.audit,
      });
    }

    return new Response(JSON.stringify({ ok: true, bootstrapped: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("unknown-cp-case-bootstrap error", err);
    return new Response(JSON.stringify({ error: "internal_error", message: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
