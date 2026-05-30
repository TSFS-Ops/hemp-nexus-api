// Admin Export Controls Batch 5 — admin-governance-export-list
//
// Platform-admin only. AAL2 required. Read-only list of Governance Record
// export requests anchored to `kind = 'admin_export'` AND a non-null
// `governance_record_id`. Returns ONLY governance-safe summary fields.
//
// This function NEVER:
//   - generates a file
//   - returns export data, raw sensitive metadata, or raw API payloads
//   - mints a signed URL
//   - approves, prepares, downloads, or destroys anything
//   - changes status or any DB row
//
// "Approved means approved only — not prepared, not generated, not
// downloadable." This list view exposes WHO/WHAT/WHEN of governance
// export requests, not the export contents.
//
// No audit name is emitted for the read itself in this batch — reads of
// admin governance metadata are not part of the existing canonical
// DATA-010 audit vocabulary, and inventing a new name would drift the
// DATA-005/010 SSOT. Denials still emit
// `data.admin_export_blocked_or_declined` to keep refusal evidence
// uniform with Batch 2/4.

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

/**
 * Allowed visible statuses for this batch. Mirrors the existing
 * request → approval lifecycle. No prepare / ready / generated /
 * downloaded / destroyed surfaces are introduced.
 */
export const BATCH_5_VISIBLE_STATUSES = [
  "awaiting_approval",
  "approved",
  "denied",
  "failed",
] as const;

const BodySchema = z.object({
  governance_record_id: z.string().uuid().nullable().optional().default(null),
  statuses: z
    .array(z.enum(BATCH_5_VISIBLE_STATUSES))
    .min(1)
    .max(BATCH_5_VISIBLE_STATUSES.length)
    .optional()
    .default([...BATCH_5_VISIBLE_STATUSES]),
  limit: z.number().int().min(1).max(200).optional().default(100),
}).strict();

interface RawRow {
  id: string;
  kind: string;
  status: string;
  requester_user_id: string;
  requested_at: string;
  updated_at: string;
  created_at: string;
  governance_record_id: string | null;
  target_org_id: string | null;
  redaction_mode: string | null;
  purpose: string | null;
  reason: string | null;
  approval: Record<string, unknown> | null;
  verification: Record<string, unknown> | null;
}

interface SafeRow {
  export_request_id: string;
  governance_record_id: string;
  status: string;
  requested_by: string;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  redaction_mode: string | null;
  purpose: string | null;
  reason_summary: string | null;
  approval_note_summary: string | null;
  legal_hold_context_present: boolean;
  legal_hold_context_scope: string | null;
  target_org_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Trim free-text to a safe summary for HQ list view — never expose full free text in the list payload. */
function summarise(input: string | null | undefined, max = 160): string | null {
  if (!input) return null;
  const trimmed = String(input).replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function toSafeRow(row: RawRow): SafeRow {
  const approval = (row.approval ?? {}) as Record<string, unknown>;
  const verification = (row.verification ?? {}) as Record<string, unknown>;
  const legalHold = (verification["legal_hold_context"] ?? null) as
    | Record<string, unknown>
    | null;
  return {
    export_request_id: row.id,
    governance_record_id: row.governance_record_id as string,
    status: row.status,
    requested_by: row.requester_user_id,
    requested_at: row.requested_at,
    approved_by:
      typeof approval["approved_by"] === "string"
        ? (approval["approved_by"] as string)
        : null,
    approved_at:
      typeof approval["approved_at"] === "string"
        ? (approval["approved_at"] as string)
        : null,
    redaction_mode: row.redaction_mode,
    purpose: row.purpose,
    reason_summary: summarise(row.reason),
    approval_note_summary: summarise(
      typeof approval["note"] === "string" ? (approval["note"] as string) : null,
    ),
    legal_hold_context_present: Boolean(legalHold),
    legal_hold_context_scope:
      legalHold && typeof legalHold["scope"] === "string"
        ? (legalHold["scope"] as string)
        : null,
    target_org_id: row.target_org_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
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

  // platform_admin gate (defence in depth — RLS also enforces this).
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
        surface: "admin-governance-export-list",
      },
      null,
      null,
    );
    return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);
  }

  // AAL2 gate — list view exposes sensitive export-governance metadata.
  try {
    await assertAal2(authHeader, {
      adminClient: admin,
      callerUserId: adminUser.id,
      action: "admin-governance-export-list",
    });
  } catch (e) {
    if (e instanceof ApiException && e.code === "MFA_REQUIRED") {
      await writeLifecycleAudit(
        admin,
        DATA_010_AUDIT_ACTIONS.blocked_or_declined,
        {
          actor_user_id: adminUser.id,
          reason: "mfa_required",
          surface: "admin-governance-export-list",
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

  let q = admin
    .from("export_requests")
    .select(
      "id, kind, status, requester_user_id, requested_at, updated_at, created_at, governance_record_id, target_org_id, redaction_mode, purpose, reason, approval, verification",
    )
    .eq("kind", "admin_export")
    .not("governance_record_id", "is", null)
    .in("status", b.statuses)
    .order("requested_at", { ascending: false })
    .limit(b.limit);
  if (b.governance_record_id) {
    q = q.eq("governance_record_id", b.governance_record_id);
  }
  const { data, error } = await q;
  if (error) {
    console.error("[admin-governance-export-list] query failed:", error);
    return json({ error: "list_failed" }, 500);
  }
  const safe = (data as RawRow[]).map(toSafeRow);

  return json({
    ok: true,
    count: safe.length,
    items: safe,
    contract: {
      read_only: true,
      no_file_generated: true,
      no_download_link: true,
      no_signed_url: true,
      no_prepare: true,
      no_destroy: true,
      aal2_required: true,
      platform_admin_only: true,
    },
  });
});
