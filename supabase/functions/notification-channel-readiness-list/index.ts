/**
 * notification-channel-readiness-list — Phase 1 admin read endpoint.
 * Returns the four channel rows with their Phase 1-locked safe labels.
 * NO live SMS/WhatsApp sending. NO provider calls. NO credentials access.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import {
  NOTIFICATION_CHANNELS,
  PHASE_1_LOCKED_CHANNELS,
  NOTIFICATION_SAFE_LABELS,
} from "../_shared/notification-channel-readiness.ts";

Deno.serve(async (req) => {
  const allowed = Deno.env.get("ALLOWED_ORIGINS") || '';
  const headers = corsHeaders(allowed, req.headers.get("origin"));
  const pre = handleCors(req, allowed);
  if (pre) return pre;

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });
    }
    const { data: userRes } = await sb.auth.getUser(token);
    if (!userRes?.user) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });
    }
    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", userRes.user.id);
    const roleSet = new Set((roles ?? []).map((r: any) => r.role));
    if (!roleSet.has("platform_admin") && !roleSet.has("compliance_analyst")) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...headers, "Content-Type": "application/json" } });
    }

    const { data, error } = await sb
      .from("notification_channel_readiness")
      .select("*")
      .order("channel");
    if (error) throw error;

    // Audit
    await sb.from("audit_logs").insert({
      org_id: "00000000-0000-0000-0000-000000000000",
      action: "notification_channel_readiness_viewed",
      entity_type: "notification_channel_readiness",
      metadata: { phase: 1, viewer: userRes.user.id },
    });

    return new Response(
      JSON.stringify({
        phase: 1,
        phase_1_locked_channels: PHASE_1_LOCKED_CHANNELS,
        safe_labels: NOTIFICATION_SAFE_LABELS,
        channels: data,
        known_channels: NOTIFICATION_CHANNELS,
      }),
      { headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
