// DATA-005 / DATA-010 Phase 2A — export-destroy (DRY-RUN ONLY)
//
// Identifies expired, non-destroyed export files. In Phase 2A this
// function ONLY reports what would be destroyed; it does NOT delete
// storage objects and does NOT mark rows destroyed.
//
// Destructive mode is gated on env var EXPORT_DESTROY_ENABLED='true'
// AND remains unset in Phase 2A (verified by prebuild guard).
//
// Phase 2A may emit a dry-run admin audit:
//   admin_audit_logs.action = 'export.destroy_dry_run_scanned'
// It must NOT emit the final destruction audit constants in this phase
// (see prebuild guard `check-data-005-010-export-lifecycle.mjs`).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Phase 2A guarantee. */
export const EXPORT_DESTROY_PHASE = "phase_2a_dry_run_only" as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const INTERNAL_CRON_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

  const auth = req.headers.get("Authorization") ?? "";
  const cronKey = req.headers.get("x-internal-cron-key") ?? "";
  const isServiceCaller =
    (auth.startsWith("Bearer ") && auth.slice(7) === SERVICE) ||
    (INTERNAL_CRON_KEY.length > 0 && cronKey === INTERNAL_CRON_KEY);
  if (!isServiceCaller) return json({ error: "forbidden", code: "SERVICE_ROLE_REQUIRED" }, 403);

  // PHASE 2A SAFETY: destructive deletion is intentionally disabled.
  // We do NOT honour any env flag that would flip this in Phase 2A —
  // Phase 2B will introduce the flag *and* the storage deletion path
  // in a separate, sign-off-gated patch.
  const destructiveEnabled = false;

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: expired, error: scanErr } = await admin
    .from("export_files")
    .select("id, export_request_id, storage_bucket, storage_path, expires_at")
    .is("destroyed_at", null)
    .lt("expires_at", new Date().toISOString())
    .limit(500);
  if (scanErr) {
    console.error("[export-destroy] scan failed:", scanErr);
    return json({ error: "scan_failed" }, 500);
  }

  const scanned = expired ?? [];
  const scannedCount = scanned.length;

  // Dry-run admin audit.
  try {
    await admin.from("admin_audit_logs").insert({
      admin_user_id: null,
      action: "export.destroy_dry_run_scanned",
      target_type: "system",
      target_id: null,
      details: {
        phase: EXPORT_DESTROY_PHASE,
        destructive_enabled: destructiveEnabled,
        scanned_count: scannedCount,
        sample: scanned.slice(0, 10).map((r) => ({
          file_id: r.id,
          request_id: r.export_request_id,
          bucket: r.storage_bucket,
          path: r.storage_path,
          expires_at: r.expires_at,
        })),
      },
    });
  } catch (e) {
    console.error("[export-destroy] audit write failed:", e);
  }

  return json({
    ok: true,
    phase: EXPORT_DESTROY_PHASE,
    destructive_enabled: destructiveEnabled,
    scanned_count: scannedCount,
    deleted_count: 0,
    message:
      "DRY-RUN: Phase 2A does not delete storage objects. Phase 2B will " +
      "introduce the destructive flag under a separate sign-off-gated patch.",
  });
});
