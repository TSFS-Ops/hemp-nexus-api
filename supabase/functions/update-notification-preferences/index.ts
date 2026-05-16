/**
 * update-notification-preferences
 * --------------------------------
 * Batch M Fix 6: authoritative path for changing notification preferences.
 *
 * Why an edge function instead of the direct table upsert?
 *  - Lets us require AAL2 for sensitive keys (compliance_status, billing-*).
 *  - Produces an explicit audit row (also covered by DB trigger, but the
 *    edge function knows the actor + IP and tags source=self|admin).
 *  - Distinguishes self-service from admin-on-behalf updates.
 *
 * RLS direct upsert still works (the DB trigger writes audit unconditionally),
 * so this function is the preferred path but failure to use it does not
 * silently lose audit.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertAal2 } from "../_shared/aal.ts";

const SENSITIVE_KEYS = new Set<string>([
  "compliance_status",
  "billing_alerts",
  "billing_receipts",
]);

const BodySchema = z.object({
  target_user_id: z.string().uuid().optional(),
  preferences: z.record(z.string(), z.boolean()),
});

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  const wrap = (r: Response) => withCors(req, r);
  const json = (status: number, body: unknown) =>
    wrap(new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }));

  if (req.method !== "POST" && req.method !== "PATCH") {
    return json(405, { error: "Method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "Unauthorized" });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: userResp, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userResp.user) return json(401, { error: "Unauthorized" });
  const actorId = userResp.user.id;

  let parsed;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch (e) {
    return json(400, { error: "Invalid body", details: (e as Error).message });
  }

  const targetUserId = parsed.target_user_id ?? actorId;
  const isAdminUpdate = targetUserId !== actorId;

  // Admin-on-behalf path requires platform_admin role AND AAL2.
  if (isAdminUpdate) {
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", actorId)
      .eq("role", "platform_admin")
      .maybeSingle();
    if (!roleRow) return json(403, { error: "Admin-on-behalf requires platform_admin" });
    try {
      await assertAal2(authHeader, {
        adminClient: admin,
        callerUserId: actorId,
        action: "notification_preference.admin_change",
        context: { target_user_id: targetUserId },
      });
    } catch (e) {
      return json(403, { error: (e as Error).message ?? "MFA_REQUIRED" });
    }
  }

  // Sensitive-key changes always require AAL2 (self or admin).
  const touchesSensitive = Object.keys(parsed.preferences).some((k) => SENSITIVE_KEYS.has(k));
  if (touchesSensitive) {
    try {
      await assertAal2(authHeader, {
        adminClient: admin,
        callerUserId: actorId,
        action: "notification_preference.sensitive_change",
        context: { keys: Object.keys(parsed.preferences) },
      });
    } catch (e) {
      return json(403, { error: (e as Error).message ?? "MFA_REQUIRED" });
    }
  }

  // Load existing for merge + before-snapshot (the DB trigger captures the
  // canonical before/after; we just need to merge so partial updates work).
  const { data: existing } = await admin
    .from("notification_preferences")
    .select("preferences")
    .eq("user_id", targetUserId)
    .maybeSingle();
  const before = (existing?.preferences as Record<string, boolean>) ?? {};
  const after = { ...before, ...parsed.preferences };

  const { error: upsertErr } = await admin
    .from("notification_preferences")
    .upsert({ user_id: targetUserId, preferences: after }, { onConflict: "user_id" });
  if (upsertErr) return json(500, { error: upsertErr.message });

  // Edge-function-side enrichment audit (DB trigger also fires; this row
  // adds actor IP / user agent / source label and is keyed differently).
  try {
    const { data: profile } = await admin
      .from("profiles").select("org_id").eq("id", targetUserId).maybeSingle();
    await admin.from("audit_logs").insert({
      org_id: (profile?.org_id as string) ?? "00000000-0000-0000-0000-000000000000",
      actor_user_id: actorId,
      action: "notification_preference.changed",
      entity_type: "notification_preference",
      entity_id: targetUserId,
      metadata: {
        before,
        after,
        target_user_id: targetUserId,
        source: isAdminUpdate ? "admin" : "self",
        touched_sensitive: touchesSensitive,
        via: "update-notification-preferences",
      },
    });
  } catch (e) {
    console.error("[update-notification-preferences] audit insert failed", e);
  }

  return json(200, { ok: true, preferences: after, source: isAdminUpdate ? "admin" : "self" });
});
