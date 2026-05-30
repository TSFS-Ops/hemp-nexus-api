// Admin Export Controls Batch 9 — admin-governance-export-preview
//
// Platform-admin only. AAL2 required. READ-ONLY redaction preview for a
// Governance Record (anchor = match_id). Runs the Batch 8 redaction
// contract (`supabase/functions/_shared/admin-export-redaction.ts`)
// against a payload built from EXISTING already-safe sources and
// returns ONLY {redacted, manifest, contract}.
//
// This function NEVER:
//   - generates a file (no CSV / JSON-file / PDF)
//   - writes to storage / creates signed URLs / download URLs / download tokens
//   - calls admin-governance-export-prepare/download/destroy
//   - mutates export_requests / legal_holds / governance / matches
//   - changes any row status
//   - returns raw legal-hold reasons / notes / metadata
//   - returns raw sanctions / PEP / adverse-media payloads
//   - returns secrets / tokens / auth identifiers
//   - emits a new audit name (only the canonical denial audit on refusal)
//
// Batch 7C production guard is NOT touched. DATA-004 (cron / retention /
// cold-storage) is NOT touched.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import {
  corsHeaders as __buildCorsHeaders,
  handleCors as __handleCors,
} from "../_shared/cors.ts";
import {
  DATA_010_AUDIT_ACTIONS,
  writeLifecycleAudit,
} from "../_shared/export-lifecycle-audit.ts";
import { detectGovernanceRecordLegalHold } from "../_shared/legal-hold-detection.ts";
import {
  DEFAULT_REDACTION_MODE,
  REDACTION_MODES,
  redactGovernanceRecord,
  UnsupportedRedactionModeError,
} from "../_shared/admin-export-redaction.ts";

const BodySchema = z.object({
  governance_record_id: z.string().uuid(),
  redaction_mode: z
    .enum([
      "redacted_client_safe",
      "evidence_only",
      "metadata_only",
      "full_internal",
    ])
    .optional()
    .default(DEFAULT_REDACTION_MODE),
}).strict();

interface MatchRow {
  id: string;
  status: string | null;
  created_at: string;
  updated_at: string;
  buyer_org_id: string | null;
  seller_org_id: string | null;
}

interface ExportRequestSummary {
  id: string;
  status: string;
  redaction_mode: string | null;
  requested_at: string;
  updated_at: string;
  created_at: string;
}

Deno.serve(async (req) => {
  const corsHeaders = __buildCorsHeaders(
    Deno.env.get("ALLOWED_ORIGINS") || "",
    req.headers.get("origin"),
  );
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const adminUser = userData.user;

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // platform_admin gate (defence in depth — RLS also enforces).
  const { data: isAdmin } = await admin.rpc("is_admin", {
    user_id: adminUser.id,
  });
  if (!isAdmin) {
    await writeLifecycleAudit(
      admin,
      DATA_010_AUDIT_ACTIONS.blocked_or_declined,
      {
        actor_user_id: adminUser.id,
        reason: "not_platform_admin",
        surface: "admin-governance-export-preview",
      },
      null,
      null,
    );
    return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);
  }

  // AAL2 gate — preview surface still discloses governance-shape data.
  try {
    await assertAal2(authHeader, {
      adminClient: admin,
      callerUserId: adminUser.id,
      action: "admin-governance-export-preview",
    });
  } catch (e) {
    if (e instanceof ApiException && e.code === "MFA_REQUIRED") {
      await writeLifecycleAudit(
        admin,
        DATA_010_AUDIT_ACTIONS.blocked_or_declined,
        {
          actor_user_id: adminUser.id,
          reason: "mfa_required",
          surface: "admin-governance-export-preview",
        },
        null,
        null,
      );
      return json({ error: "mfa_required", code: "MFA_REQUIRED" }, 403);
    }
    return json({ error: "aal_check_failed" }, 500);
  }

  let raw: unknown = {};
  if (req.headers.get("content-length") !== "0") {
    try {
      raw = await req.json();
    } catch {
      raw = {};
    }
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json(
      { error: "invalid_body", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }
  const b = parsed.data;

  // ---- Build a Governance Record-shaped payload from SAFE sources ----
  // Source A: matches (anchor for Governance Record).
  let matchRow: MatchRow | null = null;
  try {
    const { data, error } = await admin
      .from("matches")
      .select("id, status, created_at, updated_at, buyer_org_id, seller_org_id")
      .eq("id", b.governance_record_id)
      .maybeSingle();
    if (error) {
      console.error("[export-preview] match lookup failed:", error);
      return json({ error: "preview_failed", code: "MATCH_LOOKUP_FAILED" }, 500);
    }
    matchRow = (data as MatchRow | null) ?? null;
  } catch (e) {
    console.error("[export-preview] match lookup threw:", e);
    return json({ error: "preview_failed", code: "MATCH_LOOKUP_THREW" }, 500);
  }
  if (!matchRow) {
    return json(
      { error: "not_found", code: "GOVERNANCE_RECORD_NOT_FOUND" },
      404,
    );
  }

  // Source B: latest export request summary (read-only, safe columns).
  let latestRequest: ExportRequestSummary | null = null;
  try {
    const { data } = await admin
      .from("export_requests")
      .select("id, status, redaction_mode, requested_at, updated_at, created_at")
      .eq("kind", "admin_export")
      .eq("governance_record_id", b.governance_record_id)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestRequest = (data as ExportRequestSummary | null) ?? null;
  } catch (e) {
    console.error("[export-preview] request lookup threw:", e);
    // Non-fatal — preview can render without a backing request.
  }

  // Source C: legal-hold safe summary (Batch 6 detection — read-only).
  const detected = await detectGovernanceRecordLegalHold(
    admin,
    b.governance_record_id,
    {},
  );

  // Assemble the Governance Record-shaped payload. Field names match
  // the Batch 8 ALLOWED_FIELDS_BY_MODE allow-list so the redactor can
  // surface them under any mode. NOTE: only safe, allow-list-aligned
  // fields are placed here. Raw match metadata is NOT included.
  const counterpartyLabel =
    matchRow.buyer_org_id && matchRow.seller_org_id
      ? "Bilateral match (buyer + seller orgs)"
      : matchRow.buyer_org_id
      ? "Unilateral match (buyer org)"
      : matchRow.seller_org_id
      ? "Unilateral match (seller org)"
      : "Match (unknown side)";

  const payload: Record<string, unknown> = {
    governance_record_id: matchRow.id,
    match_id: matchRow.id,
    status: matchRow.status ?? "unknown",
    created_at: matchRow.created_at,
    updated_at: matchRow.updated_at,
    counterparty_label: counterpartyLabel,
    redaction_mode: b.redaction_mode,
    legal_hold: {
      has_legal_hold: detected.has_legal_hold,
      scope: detected.primary_scope,
      hold_count: detected.hold_count,
      hold_sources: detected.hold_sources,
      primary_scope: detected.primary_scope,
      detected_at: detected.detected_at,
      detection_source: detected.detection_source,
      detection_version: detected.detection_version,
    },
  };
  if (latestRequest) {
    payload.export_request_id = latestRequest.id;
    payload.requested_at = latestRequest.requested_at;
  }

  // Apply Batch 8 redaction contract. The helper is pure and never
  // mutates `payload`. Unsupported mode throws — guarded by Zod above
  // but defence-in-depth catch keeps the response shape stable.
  let redacted, manifest;
  try {
    const out = redactGovernanceRecord(payload, b.redaction_mode);
    redacted = out.redacted;
    manifest = out.manifest;
  } catch (e) {
    if (e instanceof UnsupportedRedactionModeError) {
      return json(
        { error: "invalid_redaction_mode", code: "UNSUPPORTED_REDACTION_MODE" },
        400,
      );
    }
    console.error("[export-preview] redaction failed:", e);
    return json({ error: "preview_failed", code: "REDACTION_FAILED" }, 500);
  }

  return json({
    ok: true,
    governance_record_id: b.governance_record_id,
    redaction_mode: b.redaction_mode,
    redacted,
    manifest,
    contract: {
      read_only: true,
      preview_only: true,
      no_file_generated: true,
      no_download_link: true,
      no_signed_url: true,
      no_prepare: true,
      no_destroy: true,
      no_mutation: true,
      aal2_required: true,
      platform_admin_only: true,
    },
  });
});
