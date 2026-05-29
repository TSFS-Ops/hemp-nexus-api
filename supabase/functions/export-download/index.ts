// DATA-005 / DATA-010 Phase 2A — export-download
//
// Mints a 5-minute (300 s) signed URL for an export file.
//
//   user_export  : subject_user_id == auth.uid()
//   admin_export : platform_admin + AAL2 AND (requester OR approver)
//
// Emits:
//   user_export  -> data.export_delivered
//   admin_export -> data.admin_export_downloaded

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/cors.ts";
import {
  DATA_005_AUDIT_ACTIONS,
  DATA_010_AUDIT_ACTIONS,
  writeLifecycleAudit,
} from "../_shared/export-lifecycle-audit.ts";
import { tryDemoShortCircuit } from "../_shared/demo-mode-entry.ts";
import { residencyGateForMatchRequest } from "../_shared/residency-entry.ts";
import {
  checkResidencyHoldAny,
  residencyBlockResponse,
} from "../_shared/residency-claim-guard.ts";

const BodySchema = z.object({
  file_id: z.string().uuid(),
}).strict();

/** DATA-005 / DATA-010 contract: signed URL TTL is exactly 300 seconds. */
export const EXPORT_DOWNLOAD_SIGNED_URL_TTL_SECONDS = 300;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const corsHeaders = __buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin"));
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
  // OPS-010: short-circuit live side effects for demo data.
  try {
    const _demoAdmin = (await import("https://esm.sh/@supabase/supabase-js@2.39.3")).createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const _demoBlocked = await tryDemoShortCircuit(_demoAdmin, req, { op: "export-download", artefact: true });
    if (_demoBlocked) return _demoBlocked;
    // DATA-009 Phase 2 residency gate (best-effort; deeper org check after request lookup).
    const _resGate = await residencyGateForMatchRequest(_demoAdmin, req);
    if (_resGate) return _resGate;
    void checkResidencyHoldAny; void residencyBlockResponse;
  } catch (_e) { /* OPS-010 best-effort; live flow continues */ }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const caller = userData.user;

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid_body" }, 400);
  const { file_id } = parsed.data;

  const { data: fileRow, error: fileErr } = await admin
    .from("export_files")
    .select("id, export_request_id, storage_bucket, storage_path, destroyed_at, expires_at")
    .eq("id", file_id)
    .single();
  if (fileErr || !fileRow) return json({ error: "not_found" }, 404);
  if (fileRow.destroyed_at) return json({ error: "destroyed" }, 410);
  if (new Date(fileRow.expires_at).getTime() < Date.now()) {
    return json({ error: "expired" }, 410);
  }

  const { data: reqRow } = await admin
    .from("export_requests")
    .select("id, kind, requester_user_id, subject_user_id, target_org_id, approval")
    .eq("id", fileRow.export_request_id)
    .single();
  if (!reqRow) return json({ error: "request_not_found" }, 404);

  // Authorisation matrix.
  if (reqRow.kind === "user_export") {
    if (reqRow.subject_user_id !== caller.id) {
      return json({ error: "forbidden", code: "NOT_SUBJECT" }, 403);
    }
  } else {
    // admin_export: platform_admin + AAL2 + (requester OR approver).
    const { data: isAdmin } = await admin.rpc("is_admin", { user_id: caller.id });
    if (!isAdmin) return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);
    try {
      await assertAal2(authHeader, { adminClient: admin, callerUserId: caller.id, action: "export-download" });
    } catch (e) {
      if (e instanceof ApiException && e.code === "MFA_REQUIRED") {
        return json({ error: "mfa_required", code: "MFA_REQUIRED" }, 403);
      }
      return json({ error: "aal_check_failed" }, 500);
    }
    const approverId = (reqRow.approval as Record<string, unknown> | null)?.approver_user_id as string | undefined;
    if (caller.id !== reqRow.requester_user_id && caller.id !== approverId) {
      return json({ error: "forbidden", code: "NOT_REQUESTER_OR_APPROVER" }, 403);
    }
  }

  const { data: signed, error: signErr } = await admin.storage
    .from(fileRow.storage_bucket)
    .createSignedUrl(fileRow.storage_path, EXPORT_DOWNLOAD_SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    console.error("[export-download] sign failed:", signErr);
    return json({ error: "sign_failed" }, 500);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 500) || null;
  const ipHash = ip ? await sha256Hex(ip) : null;
  const uaHash = ua ? await sha256Hex(ua) : null;

  await admin.rpc("record_export_download", {
    p_file_id: file_id,
    p_actor_meta: { actor_user_id: caller.id, ip_hash: ipHash, ua_hash: uaHash },
  });

  // Transition to delivered/downloaded on first download (best effort).
  const fromState = reqRow.kind === "user_export" ? "ready_for_delivery" : "ready_for_download";
  const toState = reqRow.kind === "user_export" ? "delivered" : "downloaded";
  await admin.rpc("atomic_export_transition", {
    p_request_id: reqRow.id,
    p_expected_from: fromState,
    p_new_status: toState,
    p_patch: {},
  }).then(() => {}, () => {/* already moved on subsequent downloads — ignore */});

  await writeLifecycleAudit(
    admin,
    reqRow.kind === "user_export"
      ? DATA_005_AUDIT_ACTIONS.delivered
      : DATA_010_AUDIT_ACTIONS.downloaded,
    {
      actor_user_id: caller.id,
      request_id: reqRow.id,
      file_id,
      ttl_seconds: EXPORT_DOWNLOAD_SIGNED_URL_TTL_SECONDS,
      ip_hash: ipHash,
      ua_hash: uaHash,
    },
    reqRow.target_org_id,
    reqRow.id,
  );

  return json({
    ok: true,
    download_url: signed.signedUrl,
    expires_in: EXPORT_DOWNLOAD_SIGNED_URL_TTL_SECONDS,
  });
});
