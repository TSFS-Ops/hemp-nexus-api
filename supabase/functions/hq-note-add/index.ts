// Batch B — HQ Notes + Correction Events edge function.
//
// Append-only. Original event is NEVER edited. Both event types are
// fail-closed: governance writer failure → 500.
//
// Access:
//   - platform_admin (HQ) only.
//   - AAL2/MFA required for BOTH hq.note_added and hq.event_corrected.
//     (David's binding decision: any HQ override / correction is sensitive.)
//
// Body: see handler.ts HqNoteBodySchema.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import {
  buildPostureSnapshot,
  writeCriticalEventWithPosture,
} from "../_shared/governance-audit-integration.ts";
import { HQ_NOTE_POLICY_VERSION } from "../_shared/governance-policy-versions.ts";
import { deriveAggregate, parseHqNoteBody } from "./handler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u, error: uerr } = await userClient.auth.getUser();
  if (uerr || !u?.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: isAdmin } = await admin.rpc("is_admin", { user_id: u.user.id });
  if (!isAdmin) return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);

  try {
    await assertAal2(authHeader, {
      adminClient: admin,
      callerUserId: u.user.id,
      action: "hq-note-add",
    });
  } catch (e) {
    if (e instanceof ApiException && e.code === "MFA_REQUIRED") {
      return json({ error: "mfa_required", code: "MFA_REQUIRED" }, 403);
    }
    return json({ error: "aal_check_failed" }, 500);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "invalid_json", code: "INVALID_JSON" }, 400);
  }
  const parsed = parseHqNoteBody(raw);
  if (!parsed.ok) {
    return json(
      { error: parsed.message, code: parsed.code, details: parsed.details },
      parsed.status,
    );
  }
  const body = parsed.body;

  // Correction events: verify the target event exists in event_store.
  if (body.note_type === "correction") {
    const { data: target, error: tErr } = await admin
      .from("event_store")
      .select("id, event_type, occurred_at")
      .eq("id", body.corrects_event_id!)
      .maybeSingle();
    if (tErr) {
      console.error("[hq-note-add] target lookup failed:", tErr);
      return json({ error: "target_lookup_failed" }, 500);
    }
    if (!target) {
      return json(
        {
          error: "correction_target_not_found",
          code: "CORRECTION_TARGET_NOT_FOUND",
        },
        404,
      );
    }
    // Prevent correcting a correction recursively beyond one hop — keeps
    // the audit chain simple. New correction must target a non-correction
    // event. (HQ can still add a follow-up `hq.note_added` if needed.)
    if (target.event_type === "hq.event_corrected") {
      return json(
        {
          error: "cannot_correct_a_correction",
          code: "CANNOT_CORRECT_A_CORRECTION",
        },
        400,
      );
    }
  }

  const { aggregate_type, aggregate_id } = deriveAggregate(body);
  const event_type =
    body.note_type === "correction" ? "hq.event_corrected" : "hq.note_added";

  const metadata: Record<string, unknown> = {
    note: body.note,
    note_label: "Manual HQ note",
    ...(body.note_type === "correction"
      ? {
          corrects_event_id: body.corrects_event_id,
          corrected_copy: "Corrected by later HQ note",
        }
      : {}),
  };

  try {
    const result = await writeCriticalEventWithPosture(admin, {
      event_type,
      org_id: body.org_id,
      aggregate_type,
      aggregate_id,
      actor_user_id: u.user.id,
      actor_role: "platform_admin",
      source_function: "hq-note-add",
      request_id: req.headers.get("x-request-id"),
      match_id: body.match_id ?? null,
      poi_id: body.poi_id ?? null,
      wad_id: body.wad_id ?? null,
      engagement_id: body.engagement_id ?? null,
      payment_reference: body.payment_reference ?? null,
      allowed_or_blocked: "allowed",
      reason_code: body.reason_code,
      posture: buildPostureSnapshot("Standard", {
        policy_version: HQ_NOTE_POLICY_VERSION,
        check_status: { aal: "aal2" },
      }),
      metadata,
      // Same operator + same target + same note_type within the idempotency
      // window dedupes a double-submit.
      idempotency_extra: `${u.user.id}|${body.note_type}|${body.corrects_event_id ?? ""}`,
    });
    return json({ ok: true, event_id: result.event_id, deduplicated: result.deduplicated }, 200);
  } catch (govErr) {
    console.error("[hq-note-add] CRITICAL: gov audit failed:", govErr);
    return json(
      { error: "gov_audit_write_failed", code: "GOV_AUDIT_WRITE_FAILED" },
      500,
    );
  }
});
