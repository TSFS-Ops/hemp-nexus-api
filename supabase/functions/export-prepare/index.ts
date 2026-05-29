// DATA-005 / DATA-010 Phase 2A — export-prepare
//
// Service-role only. Loads a request in `export_preparation_required`,
// applies the kind-specific policy adapter + redaction, generates a
// CSV (allow-list projection — never SELECT *), uploads to the
// private bucket, inserts an export_files row, and transitions the
// request to ready_for_delivery / ready_for_download.
//
// Emits:
//   user_export  -> data.export_prepared
//   admin_export -> data.admin_export_generated

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/cors.ts";
  DATA_005_AUDIT_ACTIONS,
  DATA_010_AUDIT_ACTIONS,
  writeLifecycleAudit,
} from "../_shared/export-lifecycle-audit.ts";
import {
  USER_EXPORT_CATEGORY_ALLOW_LISTS,
  ADMIN_EXPORT_CATEGORY_ALLOW_LISTS,
  safeProjection,
  toCsv,
} from "../_shared/export-redaction.ts";
import { tryDemoShortCircuit } from "../_shared/demo-mode-entry.ts";
import {
  checkResidencyHoldAny,
  residencyBlockResponse,
} from "../_shared/residency-claim-guard.ts";

const BodySchema = z.object({
  request_id: z.string().uuid(),
}).strict();

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

const USER_EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
const ADMIN_EXPORT_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

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
    const _demoBlocked = await tryDemoShortCircuit(_demoAdmin, req, { op: "export-prepare", artefact: true });
    if (_demoBlocked) return _demoBlocked;
  } catch (_e) { /* OPS-010 best-effort; live flow continues */ }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

  // Service-role only: caller MUST present service-role bearer OR cron key.
  const auth = req.headers.get("Authorization") ?? "";
  const cronKey = req.headers.get("x-internal-cron-key") ?? "";
  const isServiceCaller =
    (auth.startsWith("Bearer ") && auth.slice(7) === SERVICE) ||
    (INTERNAL_CRON_KEY.length > 0 && cronKey === INTERNAL_CRON_KEY);
  if (!isServiceCaller) return json({ error: "forbidden", code: "SERVICE_ROLE_REQUIRED" }, 403);

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let raw: unknown;
  try { raw = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid_body" }, 400);
  const { request_id } = parsed.data;

  const { data: reqRow, error: reqErr } = await admin
    .from("export_requests")
    .select(
      "id, kind, status, requester_user_id, requester_org_id, subject_user_id, requested_categories, approver_user_id, verification, approval",
    )
    .eq("id", request_id)
    .single();
  if (reqErr || !reqRow) return json({ error: "not_found" }, 404);
  if (reqRow.status !== "export_preparation_required") {
    return json({ error: "invalid_state", actual: reqRow.status }, 409);
  }

  // DATA-009 Phase 2: block production export when residency review hold is active.
  const _residencyBlock = await checkResidencyHoldAny(admin, [
    (reqRow as { requester_org_id?: string | null }).requester_org_id ?? null,
    (reqRow as { target_org_id?: string | null }).target_org_id ?? null,
  ]);
  if (_residencyBlock) return residencyBlockResponse(_residencyBlock, corsHeaders);


  const isUser = reqRow.kind === "user_export";
  const allowLists = isUser
    ? USER_EXPORT_CATEGORY_ALLOW_LISTS
    : ADMIN_EXPORT_CATEGORY_ALLOW_LISTS;

  // Resolve categories: intersect requested with known allow-lists.
  const categories = (reqRow.requested_categories as string[]).filter(
    (c) => c in allowLists,
  );

  // Phase 2A: generate ONE CSV per category and zip into a manifest (here:
  // a single combined CSV containing per-category sections). Real shard
  // streaming is Phase 2B. We keep it small and explicit-projection-only.
  const rowCounts: Record<string, number> = {};
  const sections: string[] = [];
  for (const cat of categories) {
    const cols = safeProjection(allowLists[cat]);
    // Phase 2A stub: empty result-set per category. Real data adapters
    // land in subsequent Phase 2A iterations once each category's
    // server-side query is privacy-reviewed individually. The CSV is
    // produced with a real header so the pipeline is end-to-end testable.
    const rows: Record<string, unknown>[] = [];
    rowCounts[cat] = rows.length;
    sections.push(`# category: ${cat}\n${toCsv(rows, cols)}`);
  }
  const body = sections.join("\n\n");
  const sha = await sha256Hex(body);
  const bucket = isUser ? "user-exports" : "admin-exports";
  const path = `${request_id}/${sha}.csv`;

  // Upload to private bucket (service_role bypasses RLS).
  const { error: upErr } = await admin.storage.from(bucket).upload(
    path,
    new Blob([body], { type: "text/csv" }),
    { upsert: true, contentType: "text/csv" },
  );
  if (upErr) {
    console.error("[export-prepare] upload failed:", upErr);
    return json({ error: "upload_failed", message: upErr.message }, 500);
  }

  const ttlMs = isUser ? USER_EXPORT_TTL_MS : ADMIN_EXPORT_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  const { data: fileId, error: fileErr } = await admin.rpc("record_export_file", {
    p_request_id: request_id,
    p_bucket: bucket,
    p_path: path,
    p_format: "csv",
    p_byte_size: body.length,
    p_sha256: sha,
    p_row_counts: rowCounts,
    p_expires_at: expiresAt,
  });
  if (fileErr || !fileId) {
    console.error("[export-prepare] record_export_file failed:", fileErr);
    return json({ error: "record_file_failed" }, 500);
  }

  const nextStatus = isUser ? "ready_for_delivery" : "ready_for_download";
  const { error: trErr } = await admin.rpc("atomic_export_transition", {
    p_request_id: request_id,
    p_expected_from: "export_preparation_required",
    p_new_status: nextStatus,
    p_patch: { expires_at: expiresAt },
  });
  if (trErr) {
    console.error("[export-prepare] transition failed:", trErr);
    return json({ error: "transition_failed", message: trErr.message }, 409);
  }

  await writeLifecycleAudit(
    admin,
    isUser ? DATA_005_AUDIT_ACTIONS.prepared : DATA_010_AUDIT_ACTIONS.generated,
    {
      actor_user_id: null,
      actor: "service_role",
      request_id,
      file_id: fileId,
      bucket,
      sha256: sha,
      byte_size: body.length,
      row_counts: rowCounts,
      expires_at: expiresAt,
    },
    reqRow.target_org_id,
    request_id,
  );

  return json({ ok: true, request_id, file_id: fileId, status: nextStatus, expires_at: expiresAt });
});
