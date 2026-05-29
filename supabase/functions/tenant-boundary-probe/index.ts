/**
 * Tenant-Boundary Probe — Batch 5 · Stage 1
 *
 * platform_admin-only. Runs reproducible RLS / policy coverage analysis
 * over every `public` table with an `org_id` column, classifies each
 * table as PASS / FAIL / ALLOWLISTED, writes an append-only sealed
 * evidence row in `tenant_boundary_evidence`, and emits a
 * `governance.tenant_boundary.probe_completed` audit.
 *
 * Probe (static + reproducible):
 *   For each org_id table NOT in `tenant_boundary_allowlist`:
 *     CRITICAL → rls_enabled = false
 *     CRITICAL → any policy uses USING (true) / WITH CHECK (true)
 *     HIGH     → policy_count = 0
 *     HIGH     → no policy references auth.uid()/has_role()/org_id
 *     PASS     → otherwise
 *
 * This is intentionally a static analysis; live cross-org probing
 * (synthetic JWT spoof) is out of scope for Stage 1.
 *
 * No MFA gate (user direction): probe is non-destructive.
 */

// deno-lint-ignore-file no-explicit-any

import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(req: Request, body: unknown, status = 200) {
  return withCors(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  );
}

type InventoryRow = {
  table_name: string;
  rls_enabled: boolean;
  policy_count: number;
  select_policies: number;
  insert_policies: number;
  update_policies: number;
  delete_policies: number;
  all_policies: number;
  has_permissive_true: boolean;
  references_auth_uid: boolean;
  references_has_role: boolean;
  references_org_id: boolean;
};

type Severity = "PASS" | "HIGH" | "CRITICAL" | "ALLOWLISTED";

interface TableResult extends InventoryRow {
  severity: Severity;
  findings: string[];
}

function classify(row: InventoryRow, allowlisted: boolean): TableResult {
  if (allowlisted) {
    return { ...row, severity: "ALLOWLISTED", findings: ["table is in tenant_boundary_allowlist"] };
  }
  const findings: string[] = [];
  let severity: Severity = "PASS";

  if (!row.rls_enabled) {
    findings.push("RLS not enabled");
    severity = "CRITICAL";
  }
  if (row.has_permissive_true) {
    findings.push("policy uses USING (true) or WITH CHECK (true)");
    severity = "CRITICAL";
  }
  if (row.policy_count === 0 && row.rls_enabled) {
    findings.push("no policies defined");
    if (severity !== "CRITICAL") severity = "HIGH";
  }
  if (
    row.rls_enabled &&
    row.policy_count > 0 &&
    !row.references_auth_uid &&
    !row.references_has_role &&
    !row.references_org_id
  ) {
    findings.push("no policy references auth.uid(), has_role(), or org_id");
    if (severity !== "CRITICAL") severity = "HIGH";
  }
  if (findings.length === 0) findings.push("ok");
  return { ...row, severity, findings };
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    // 1. Auth
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorisation");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse(req, { error: "Unauthorised" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userRes, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !userRes?.user) {
      return jsonResponse(req, { error: "Invalid token" }, 401);
    }
    const callerId = userRes.user.id;

    // 2. RBAC — platform_admin only
    const { data: hasAdmin, error: roleErr } = await admin.rpc("has_role", {
      _user_id: callerId,
      _role: "platform_admin",
    });
    if (roleErr) {
      console.error("[tenant-boundary-probe] has_role failed:", roleErr);
      return jsonResponse(req, { error: "Authorisation check failed" }, 500);
    }
    if (!hasAdmin) {
      return jsonResponse(req, { error: "Platform admin access required" }, 403);
    }

    // 3. Inventory
    const { data: inventory, error: invErr } = await admin.rpc("tenant_boundary_inventory");
    if (invErr) {
      console.error("[tenant-boundary-probe] inventory failed:", invErr);
      return jsonResponse(req, { error: "Inventory query failed", detail: invErr.message }, 500);
    }
    const rows: InventoryRow[] = (inventory ?? []) as InventoryRow[];

    // 4. Allowlist
    const { data: allowRows, error: allowErr } = await admin
      .from("tenant_boundary_allowlist")
      .select("table_name");
    if (allowErr) {
      return jsonResponse(req, { error: "Allowlist query failed", detail: allowErr.message }, 500);
    }
    const allowSet = new Set((allowRows ?? []).map((r: any) => r.table_name as string));

    // 5. Classify
    const results: TableResult[] = rows.map((r) => classify(r, allowSet.has(r.table_name)));
    const tables_total = results.length;
    const tables_allowlisted = results.filter((r) => r.severity === "ALLOWLISTED").length;
    const critical_count = results.filter((r) => r.severity === "CRITICAL").length;
    const high_count = results.filter((r) => r.severity === "HIGH").length;
    const tables_failed = critical_count + high_count;
    const tables_passed = tables_total - tables_failed - tables_allowlisted;

    let status: "pass" | "fail" | "partial" = "pass";
    if (critical_count > 0) status = "fail";
    else if (high_count > 0) status = "partial";

    // 6. Schema hash (stable signature of table inventory shape)
    const schemaSignature = rows
      .map((r) => `${r.table_name}|${r.rls_enabled ? 1 : 0}|${r.policy_count}`)
      .sort()
      .join("\n");
    const schema_hash = await sha256Hex(schemaSignature);

    const run_id = crypto.randomUUID();
    const run_at = new Date().toISOString();

    const manifest = {
      run_id,
      run_at,
      run_by: callerId,
      generator: "tenant-boundary-probe@1",
      schema_hash,
      summary: {
        tables_total,
        tables_passed,
        tables_failed,
        tables_allowlisted,
        critical_count,
        high_count,
        status,
      },
      allowlist: [...allowSet].sort(),
      results,
    };
    const manifest_sha256 = await sha256Hex(JSON.stringify(manifest));

    // 7. Persist
    const { error: insErr } = await admin.from("tenant_boundary_evidence").insert({
      run_id,
      run_at,
      run_by: callerId,
      schema_hash,
      tables_total,
      tables_passed,
      tables_failed,
      tables_allowlisted,
      critical_count,
      high_count,
      status,
      results: manifest,
      manifest_sha256,
    });
    if (insErr) {
      console.error("[tenant-boundary-probe] insert failed:", insErr);
      return jsonResponse(req, { error: "Persist failed", detail: insErr.message }, 500);
    }

    // 8. Canonical audit (best-effort)
    try {
      await admin.from("audit_logs").insert({
        org_id: null,
        actor_user_id: callerId,
        action: "governance.tenant_boundary.probe_completed",
        entity_type: "tenant_boundary_evidence",
        entity_id: run_id,
        metadata: {
          request_id: requestId,
          status,
          tables_total,
          tables_passed,
          tables_failed,
          tables_allowlisted,
          critical_count,
          high_count,
          manifest_sha256,
          schema_hash,
        },
      });
    } catch (e) {
      console.error("[tenant-boundary-probe] audit failed:", e);
    }

    return jsonResponse(req, {
      ok: true,
      request_id: requestId,
      run_id,
      run_at,
      status,
      tables_total,
      tables_passed,
      tables_failed,
      tables_allowlisted,
      critical_count,
      high_count,
      manifest_sha256,
    });
  } catch (e) {
    console.error("[tenant-boundary-probe] unhandled:", e);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
