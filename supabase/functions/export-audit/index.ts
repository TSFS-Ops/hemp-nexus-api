// Batch O — AUD-012: export-audit edge function.
//
// Records a row in `audit_logs` before a sensitive CSV/JSON export is
// delivered. The actor is identified server-side from the caller JWT;
// IP + user-agent come from request headers (never client-claimed).
//
// For "sensitive" exports (audit_logs / admin_audit_logs) we require
// AAL2 — if the JWT does not carry aal2 we respond 403 with
// `aal_required` so the client can prompt re-authentication.
//
// We do not stream the export itself — the client does the actual CSV
// write. This function only persists the audit row and the AAL gate.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  target_type: z.enum(["audit_logs", "admin_audit_logs", "outreach_blocks", "matches", "other"]),
  format: z.enum(["csv", "json"]).default("csv"),
  row_count: z.number().int().nonnegative().max(1_000_000),
  filters: z.record(z.unknown()).optional().default({}),
  sensitive: z.boolean().default(false),
  reason: z.string().max(500).nullable().optional(),
});

const SENSITIVE_TARGETS = new Set(["audit_logs", "admin_audit_logs"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }
  const token = authHeader.slice(7);

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const user = userData.user;

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: "validation_error", details: parsed.error.flatten() }, 400);
  const input = parsed.data;

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // AAL2 gate for sensitive targets. We read aal from the JWT.
  // supabase-js exposes the AAL through getAuthenticatorAssuranceLevel.
  let aal: string | null = null;
  try {
    const { data: aalData } = await userClient.auth.mfa.getAuthenticatorAssuranceLevel();
    aal = aalData?.currentLevel ?? null;
  } catch { aal = null; }

  if (SENSITIVE_TARGETS.has(input.target_type) && aal !== "aal2") {
    return json({
      error: "aal2_required",
      aal_required: true,
      message: "This export requires step-up authentication (AAL2).",
    }, 403);
  }

  // Lookup the caller's org for audit_logs.org_id (NOT NULL).
  const { data: prof } = await admin
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();
  const orgId = prof?.org_id ?? null;

  // Reduce filters to a deterministic hash to keep audit row small but
  // forensically meaningful.
  const filtersJson = JSON.stringify(input.filters ?? {});
  const filters_hash = await sha256Hex(filtersJson);

  const ip = extractIp(req);
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 500) || null;

  // Write to audit_logs (org-scoped, requires org_id NOT NULL).
  if (orgId) {
    await admin.from("audit_logs").insert({
      org_id: orgId,
      actor_user_id: user.id,
      action: `export.${input.format}`,
      entity_type: input.target_type,
      entity_id: null,
      metadata: {
        target_type: input.target_type,
        format: input.format,
        row_count: input.row_count,
        sensitive: input.sensitive,
        reason: input.reason ?? null,
        filters_hash,
        filters_summary_keys: Object.keys(input.filters ?? {}).sort(),
        actor_ip: ip,
        user_agent: ua,
        exported_at: new Date().toISOString(),
      },
    });
  }

  // Mirror to admin_audit_logs when the export touches admin/audit data.
  if (SENSITIVE_TARGETS.has(input.target_type)) {
    await admin.from("admin_audit_logs").insert({
      admin_user_id: user.id,
      action: `export.${input.format}`,
      target_type: input.target_type,
      target_id: null,
      details: {
        target_type: input.target_type,
        format: input.format,
        row_count: input.row_count,
        sensitive: input.sensitive,
        reason: input.reason ?? null,
        filters_hash,
        org_id: orgId,
        aal,
        exported_at: new Date().toISOString(),
      },
      ip_address: ip,
      user_agent: ua,
    });
  }

  return json({ ok: true, request_id: req.headers.get("x-request-id") ?? crypto.randomUUID() });
});
