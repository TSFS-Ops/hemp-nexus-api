// Batch 11 — registry-claim-notification-log
// Records an in-app notification entry. LOG-ONLY. No external send.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const Body = z.object({
  claim_id: z.string().uuid(),
  recipient_user_id: z.string().uuid(),
  audit_event_name: z.string().min(1).max(80),
  subject: z.string().max(200).optional(),
  body: z.string().max(4000).optional(),
});

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: rolesRows } = await svc.from("user_roles").select("role").eq("user_id", userRes.user.id);
    const roles = (rolesRows ?? []).map((r: any) => r.role);
    if (!roles.includes("platform_admin") && !roles.includes("compliance_owner")) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));
    }

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return withCors(req, new Response(JSON.stringify({ error: "invalid_body" }), { status: 400 }));

    await svc.from("registry_company_claim_status_notifications").insert({
      claim_id: parsed.data.claim_id,
      recipient_user_id: parsed.data.recipient_user_id,
      channel: "in_app",
      audit_event_name: parsed.data.audit_event_name,
      subject: parsed.data.subject ?? null,
      body: parsed.data.body ?? null,
      delivery_state: "logged_only",
    });
    await svc.from("audit_logs").insert({
      action: "registry_claim_notification_logged",
      actor_user_id: userRes.user.id,
      metadata: { claim_id: parsed.data.claim_id, audit_event_name: parsed.data.audit_event_name },
    });

    return withCors(req, new Response(JSON.stringify({ ok: true, delivery_state: "logged_only" }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (e) {
    return withCors(req, new Response(JSON.stringify({ error: "internal", message: (e as Error).message }), { status: 500 }));
  }
});
