/**
 * Admin Legal Hold edge function — DATA-003 Phase 1.
 *
 * Single endpoint, action-discriminated:
 *   POST /admin-legal-hold { action: "apply"   | "release" | "list", ... }
 *
 * Security model (mirrors admin-credit-org):
 *   1. Valid Bearer token.
 *   2. Caller is platform_admin (has_role check via service-role).
 *   3. Caller's session is aal2 (MFA) — assertAal2.
 *   4. Reason is mandatory on apply (>= 10 chars).
 *   5. release_reason is mandatory on release (>= 10 chars).
 *   6. Cannot release an already-released hold.
 *   7. Apply for an already-active (scope_type, scope_id) pair is rejected
 *      idempotently with 409 + existing hold id (no duplicate created).
 *
 * Canonical audits:
 *   - data.legal_hold_applied  (on successful apply)
 *   - data.legal_hold_released (on successful release)
 *
 * Required audit metadata: scope_type, scope_id, reason, actor_user_id,
 *   aal, legal_hold_id, applied_at / released_at, related_request_id.
 */

// deno-lint-ignore-file no-explicit-any

import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertAal2, readAal } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import { LEGAL_HOLD_AUDIT_NAMES, type LegalHoldScopeType } from "../_shared/legal-hold.ts";
import { buildPostureSnapshot } from "../_shared/governance-audit-integration.ts";
import { LEGAL_HOLD_POLICY_VERSION } from "../_shared/governance-policy-versions.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SCOPE_TYPES = [
  "user", "org", "match", "engagement", "poi",
  "wad", "dispute", "payment", "evidence", "record_group",
] as const;

const ApplySchema = z.object({
  action: z.literal("apply"),
  scope_type: z.enum(SCOPE_TYPES),
  scope_id: z.string().uuid(),
  reason: z.string().trim().min(10, "reason must be at least 10 characters").max(500),
  related_request_id: z.string().trim().max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const ReleaseSchema = z.object({
  action: z.literal("release"),
  legal_hold_id: z.string().uuid(),
  released_reason: z.string().trim().min(10, "released_reason must be at least 10 characters").max(500),
  related_request_id: z.string().trim().max(200).optional(),
});

const ListSchema = z.object({
  action: z.literal("list"),
  status: z.enum(["active", "released", "all"]).default("active"),
  scope_type: z.enum(SCOPE_TYPES).optional(),
  scope_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

const BodySchema = z.discriminatedUnion("action", [ApplySchema, ReleaseSchema, ListSchema]);

function jsonResponse(req: Request, body: unknown, status = 200) {
  return withCors(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  );
}

async function writeCanonicalAudit(
  admin: any,
  action: typeof LEGAL_HOLD_AUDIT_NAMES.applied | typeof LEGAL_HOLD_AUDIT_NAMES.released,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from("audit_logs").insert({
      org_id: null,
      actor_user_id: (payload.actor_user_id as string | null) ?? null,
      action,
      entity_type: "legal_hold",
      entity_id: (payload.legal_hold_id as string | null) ?? null,
      metadata: payload,
    });
  } catch (e) {
    console.error(`[admin-legal-hold] canonical audit write failed (${action}):`, e);
  }
}

async function writeAdminAudit(
  admin: any,
  callerUserId: string | null,
  action: string,
  targetId: string | null,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from("admin_audit_logs").insert({
      admin_user_id: callerUserId,
      action,
      target_type: "legal_hold",
      target_id: targetId,
      details,
    });
  } catch (e) {
    console.error(`[admin-legal-hold] admin audit write failed (${action}):`, e);
  }
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
  let callerId: string | null = null;

  try {
    // 1. Auth
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorisation");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse(req, { error: "Unauthorised" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userRes, error: authError } = await admin.auth.getUser(token);
    if (authError || !userRes?.user) {
      return jsonResponse(req, { error: "Invalid token" }, 401);
    }
    callerId = userRes.user.id;
    const observedAal = readAal(authHeader);

    // 2. RBAC
    const { data: hasAdmin, error: roleError } = await admin.rpc("has_role", {
      _user_id: callerId,
      _role: "platform_admin",
    });
    if (roleError) {
      console.error("[admin-legal-hold] has_role failed:", roleError);
      await writeAdminAudit(admin, callerId, "admin.legal_hold.rbac_check_failed", null, {
        request_id: requestId,
        error: roleError.message,
      });
      return jsonResponse(req, { error: "Authorisation check failed" }, 500);
    }
    if (!hasAdmin) {
      await writeAdminAudit(admin, callerId, "admin.legal_hold.forbidden", null, {
        request_id: requestId,
        reason: "caller_not_platform_admin",
      });
      return jsonResponse(req, { error: "Platform admin access required" }, 403);
    }

    // 3. AAL2 — applies to apply/release. List is read-only but still admin-only;
    //    we enforce AAL2 for parity with other sensitive admin endpoints.
    try {
      await assertAal2(authHeader, {
        adminClient: admin,
        callerUserId: callerId,
        action: "admin.legal_hold",
      });
    } catch (mfaErr) {
      if (mfaErr instanceof ApiException && mfaErr.code === "MFA_REQUIRED") {
        return jsonResponse(
          req,
          { error: mfaErr.message, code: "MFA_REQUIRED" },
          403,
        );
      }
      throw mfaErr;
    }

    // 4. Parse body
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return jsonResponse(req, { error: "Invalid JSON body" }, 400);
    }
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonResponse(
        req,
        { error: "Invalid input", details: parsed.error.flatten() },
        400,
      );
    }

    // ── ACTION: list ─────────────────────────────────────────────────
    if (parsed.data.action === "list") {
      const { status, scope_type, scope_id, limit } = parsed.data;
      let q = admin.from("legal_holds").select("*").order("applied_at", { ascending: false }).limit(limit);
      if (status !== "all") q = q.eq("status", status);
      if (scope_type) q = q.eq("scope_type", scope_type);
      if (scope_id) q = q.eq("scope_id", scope_id);
      const { data, error } = await q;
      if (error) {
        return jsonResponse(req, { error: "Query failed", detail: error.message }, 500);
      }
      return jsonResponse(req, { ok: true, holds: data ?? [], request_id: requestId });
    }

    // ── ACTION: apply ────────────────────────────────────────────────
    if (parsed.data.action === "apply") {
      const { scope_type, scope_id, reason, related_request_id, metadata } = parsed.data;

      // Atomic apply: insert legal_holds + emit legal_hold.applied in one tx.
      const legalHoldApplyGovPayload = {
        actor_user_id: callerId,
        actor_role: "platform_admin",
        source_function: "admin-legal-hold",
        request_id: requestId,
        allowed_or_blocked: "allowed",
        reason_code: `scope:${scope_type}`,
        posture_snapshot: buildPostureSnapshot("Standard", {
          policy_version: LEGAL_HOLD_POLICY_VERSION,
          check_status: { aal: observedAal, scope_type, scope_id },
        }),
        metadata: {
          reason,
          scope_type,
          scope_id,
          related_request_id: related_request_id ?? null,
          policy_version: LEGAL_HOLD_POLICY_VERSION,
        },
        idempotency_key: `${scope_type}:${scope_id}|legal_hold.applied|${requestId}|apply`,
      };

      const { data: applyResult, error: applyErr } = await admin.rpc(
        "atomic_legal_hold_apply",
        {
          p_input: {
            scope_type,
            scope_id,
            reason,
            applied_by: callerId,
            gov_org_id: scope_type === "org" ? scope_id : scope_id,
            metadata: {
              ...(metadata ?? {}),
              related_request_id: related_request_id ?? null,
              applied_via: "admin-legal-hold",
              request_id: requestId,
            },
          },
          p_governance: legalHoldApplyGovPayload,
        },
      );
      if (applyErr) {
        return jsonResponse(req, { error: "Insert failed", detail: applyErr.message }, 500);
      }
      const aR = applyResult as {
        success: boolean;
        error?: string;
        existing_hold_id?: string;
        applied_at?: string;
        legal_hold_id?: string;
        governance_event_id?: string | null;
      } | null;
      if (!aR?.success) {
        if (aR?.error === "LEGAL_HOLD_ALREADY_ACTIVE") {
          await writeAdminAudit(admin, callerId, "admin.legal_hold.apply_idempotent_skip", aR.existing_hold_id ?? null, {
            request_id: requestId,
            scope_type,
            scope_id,
            existing_hold_id: aR.existing_hold_id,
          });
          return jsonResponse(req, {
            ok: false,
            code: "LEGAL_HOLD_ALREADY_ACTIVE",
            message: "An active legal hold already exists for this scope.",
            existing_hold: { id: aR.existing_hold_id, applied_at: aR.applied_at },
            request_id: requestId,
          }, 409);
        }
        console.error("[admin-legal-hold] CRITICAL: atomic_legal_hold_apply failed:", aR);
        return jsonResponse(req, {
          error: "Hold rolled back: governance proof write failed",
          code: "GOV_AUDIT_WRITE_FAILED",
        }, 500);
      }
      if (!aR.governance_event_id) {
        return jsonResponse(req, {
          error: "Legal hold apply atomic RPC did not return governance_event_id",
          code: "GOV_AUDIT_WRITE_FAILED",
        }, 500);
      }

      await writeCanonicalAudit(admin, LEGAL_HOLD_AUDIT_NAMES.applied, {
        legal_hold_id: aR.legal_hold_id,
        scope_type,
        scope_id,
        reason,
        actor_user_id: callerId,
        aal: observedAal,
        applied_at: aR.applied_at,
        related_request_id: related_request_id ?? null,
        request_id: requestId,
      });
      await writeAdminAudit(admin, callerId, "admin.legal_hold.applied", aR.legal_hold_id ?? null, {
        request_id: requestId,
        scope_type,
        scope_id,
        reason,
        aal: observedAal,
      });

      return jsonResponse(req, {
        ok: true,
        legal_hold_id: aR.legal_hold_id,
        applied_at: aR.applied_at,
        message: "Legal hold applied — deletion/anonymisation suspended for this scope.",
        request_id: requestId,
      });
    }


    // ── ACTION: release ──────────────────────────────────────────────
    if (parsed.data.action === "release") {
      const { legal_hold_id, released_reason, related_request_id } = parsed.data;

      const legalHoldReleaseGovPayload = {
        actor_user_id: callerId,
        actor_role: "platform_admin",
        source_function: "admin-legal-hold",
        request_id: requestId,
        allowed_or_blocked: "allowed",
        posture_snapshot: buildPostureSnapshot("Standard", {
          policy_version: LEGAL_HOLD_POLICY_VERSION,
          check_status: { aal: observedAal },
        }),
        metadata: {
          released_reason,
          policy_version: LEGAL_HOLD_POLICY_VERSION,
        },
        idempotency_key: `${legal_hold_id}|legal_hold.released|${requestId}|release`,
      };

      const { data: relResult, error: relErr } = await admin.rpc(
        "atomic_legal_hold_release",
        {
          p_input: {
            legal_hold_id,
            released_by: callerId,
            released_reason,
            gov_org_id: null,
          },
          p_governance: legalHoldReleaseGovPayload,
        },
      );
      if (relErr) {
        return jsonResponse(req, { error: "Update failed", detail: relErr.message }, 500);
      }
      const rR = relResult as {
        success: boolean;
        error?: string;
        current_status?: string;
        legal_hold_id?: string;
        released_at?: string;
        scope_type?: string;
        scope_id?: string;
        governance_event_id?: string | null;
      } | null;
      if (!rR?.success) {
        if (rR?.error === "NOT_FOUND") {
          return jsonResponse(req, { error: "Legal hold not found", code: "NOT_FOUND" }, 404);
        }
        if (rR?.error === "LEGAL_HOLD_NOT_ACTIVE") {
          return jsonResponse(req, {
            error: "Legal hold is not active",
            code: "LEGAL_HOLD_NOT_ACTIVE",
            current_status: rR.current_status,
          }, 409);
        }
        console.error("[admin-legal-hold] CRITICAL: atomic_legal_hold_release failed:", rR);
        return jsonResponse(req, {
          error: "Hold release rolled back: governance proof write failed",
          code: "GOV_AUDIT_WRITE_FAILED",
        }, 500);
      }
      if (!rR.governance_event_id) {
        return jsonResponse(req, {
          error: "Legal hold release atomic RPC did not return governance_event_id",
          code: "GOV_AUDIT_WRITE_FAILED",
        }, 500);
      }

      await writeCanonicalAudit(admin, LEGAL_HOLD_AUDIT_NAMES.released, {
        legal_hold_id,
        scope_type: rR.scope_type as LegalHoldScopeType,
        scope_id: rR.scope_id!,
        reason: released_reason,
        actor_user_id: callerId,
        aal: observedAal,
        released_at: rR.released_at,
        related_request_id: related_request_id ?? null,
        request_id: requestId,
      });
      await writeAdminAudit(admin, callerId, "admin.legal_hold.released", legal_hold_id, {
        request_id: requestId,
        scope_type: rR.scope_type,
        scope_id: rR.scope_id,
        released_reason,
        aal: observedAal,
      });

      return jsonResponse(req, {
        ok: true,
        legal_hold_id,
        released_at: rR.released_at,
        message:
          "Legal hold released — deletion/anonymisation may resume where otherwise permitted.",
        request_id: requestId,
      });
    }


    return jsonResponse(req, { error: "Unknown action" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[admin-legal-hold] unhandled error:", err);
    if (callerId) {
      await writeAdminAudit(admin, callerId, "admin.legal_hold.unhandled_error", null, {
        request_id: requestId,
        error: message,
      });
    }
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
