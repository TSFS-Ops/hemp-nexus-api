// Batch 13 — Log-only in-app notification for bank-detail events.
// Never sends external email/SMS — that's an explicit Batch 13 out-of-scope.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  submission_id: z.string().uuid(),
  recipient_user_id: z.string().uuid().optional(),
  notification_type: z.string().min(1).max(120),
  payload: z.record(z.unknown()).default({}),
});

function json(req: Request, body: unknown, status = 200): Response {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json(req, { error: "unauthorized" }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json(req, { error: "invalid_body" }, 400);
    const input = parsed.data;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has("platform_admin") && !roleSet.has("compliance_owner")) {
      return json(req, { error: "forbidden" }, 403);
    }

    await svc.from("registry_bank_detail_status_notifications").insert({
      submission_id: input.submission_id,
      recipient_user_id: input.recipient_user_id ?? null,
      channel: "in_app",
      notification_type: input.notification_type,
      payload: input.payload,
      delivered_externally: false,
    });
    await svc.from("registry_bank_detail_events").insert({
      submission_id: input.submission_id,
      audit_event_name: "registry_bank_detail_notification_logged",
      previous_status: null, new_status: null, actor_id: user.id,
      payload: { notification_type: input.notification_type },
    });

    return json(req, { ok: true, delivered_externally: false });
  } catch (err) {
    console.error("registry-bank-detail-notification-log error", err);
    return json(req, { error: "internal_error" }, 500);
  }
});
