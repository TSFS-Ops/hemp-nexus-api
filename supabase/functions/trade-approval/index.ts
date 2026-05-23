import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

/**
 * Trade Approval Edge Function - Sprint 7
 *
 * Manages the "Approved to Trade" status that the collapse engine enforces.
 * Links DD risk scores → approval decision → collapse eligibility.
 *
 * POST /trade-approval           → Issue/update trade approval (admin/compliance)
 * GET  /trade-approval           → List approvals or get by org_id
 * POST /trade-approval/revoke    → Revoke an org's approval (admin only)
 * POST /trade-approval/renew     → Extend validity (admin only)
 */

const ApprovalSchema = z.object({
  org_id: z.string().uuid(),
  risk_band: z.enum(["low", "medium", "high"]).optional(),
  valid_days: z.number().int().min(1).max(730).default(365),
  approval_request_id: z.string().uuid().optional(),
  reason: z.string().max(1000).optional(),
});

const RevokeSchema = z.object({
  org_id: z.string().uuid(),
  reason: z.string().min(1).max(1000),
});

const RenewSchema = z.object({
  org_id: z.string().uuid(),
  extend_days: z.number().int().min(1).max(730).default(365),
});

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function envelope(data: unknown, correlationId: string) {
  return { status: "SUCCESS", timestamp: new Date().toISOString(), correlation_id: correlationId, data };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const orgId = authCtx.orgId;
    if (!orgId) throw new ApiException("FORBIDDEN", "No organisation found", 403);

    const correlationId = req.headers.get("X-Correlation-ID") || crypto.randomUUID();
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const subAction = pathParts[pathParts.length - 1];
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorisation");

    // SEC-001: trade-approval issue/revoke/renew change the platform's
    // collapse-eligibility state and must require AAL2 for human callers.
    const requireMfaForApprovalOverride = async (target?: { org_id?: string; sub?: string }) => {
      if (authCtx.isApiKey) return;
      await assertAal2(authHeader, {
        adminClient: admin,
        callerUserId: authCtx.userId,
        action: "trade.approval_override",
        context: {
          sensitive_action_category: "compliance.trade_approval",
          target_resource_type: "trade_approval",
          target_resource_id: target?.org_id ?? null,
          sub_action: target?.sub ?? subAction,
          method: req.method,
        },
      });
    };

    // ── GET /trade-approval ── List approvals
    if (req.method === "GET") {
      const targetOrgId = url.searchParams.get("org_id");
      const statusFilter = url.searchParams.get("status");
      const isAdmin = authCtx.roles?.includes("admin") || authCtx.roles?.includes("platform_admin");

      let query = admin.from("trade_approvals").select("*").order("created_at", { ascending: false });

      if (targetOrgId) {
        // Enforce ownership: non-admins may only query their own org
        if (!isAdmin && targetOrgId !== orgId) {
          throw new ApiException("FORBIDDEN", "Access denied: cannot query trade approvals for another organisation", 403);
        }
        query = query.eq("org_id", targetOrgId);
      } else if (!isAdmin) {
        // Non-admin can only see own org
        query = query.eq("org_id", orgId);
      }

      if (statusFilter) query = query.eq("status", statusFilter);
      query = query.limit(200);

      const { data, error } = await query;
      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      // Enrich with org names
      const orgIds = [...new Set((data || []).map((d: any) => d.org_id))];
      const { data: orgs } = await admin.from("organizations").select("id, name").in("id", orgIds);
      const orgMap = new Map((orgs || []).map((o: any) => [o.id, o.name]));

      const enriched = (data || []).map((d: any) => ({
        ...d,
        org_name: orgMap.get(d.org_id) || "Unknown",
        is_valid: d.status === "approved" && (!d.valid_until || new Date(d.valid_until) > new Date()),
      }));

      return new Response(JSON.stringify(envelope(enriched, correlationId)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── POST /trade-approval/revoke ── Revoke approval
    if (req.method === "POST" && subAction === "revoke") {
      requireRole(authCtx, "platform_admin");
      assertIdempotencyKey(req);
      const body = await req.json();
      const { org_id: targetOrgId, reason } = RevokeSchema.parse(body);
      await requireMfaForApprovalOverride({ org_id: targetOrgId, sub: "revoke" });

      const { data: existing } = await admin
        .from("trade_approvals")
        .select("id, status")
        .eq("org_id", targetOrgId)
        .maybeSingle();

      if (!existing) throw new ApiException("NOT_FOUND", "No approval record for this organisation", 404);

      const { data: updated, error } = await admin
        .from("trade_approvals")
        .update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("org_id", targetOrgId)
        .select()
        .single();

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      // Event store
      const eventHash = await sha256(JSON.stringify({ action: "revoke", org_id: targetOrgId, reason }));
      await admin.from("event_store").insert({
        org_id: orgId, domain: "compliance", aggregate_type: "trade_approval", aggregate_id: updated.id,
        event_type: "compliance.trade_approval.revoked",
        actor_id: authCtx.userId, actor_role: authCtx.roles?.[0] || null,
        payload: { target_org_id: targetOrgId, reason, previous_status: existing.status },
        event_hash: eventHash,
      });

      await admin.from("audit_logs").insert({
        org_id: orgId, actor_user_id: authCtx.userId,
        action: "trade_approval.revoked", entity_type: "trade_approval", entity_id: updated.id,
        metadata: { target_org_id: targetOrgId, reason },
      });

      // Dispatch notification for trade approval revocation
      await admin.functions.invoke("notification-dispatch", {
        body: {
          event_type: "compliance.trade_approval.revoked",
          subject: "Trade approval revoked",
          message: `Trade approval for organisation ${targetOrgId} has been revoked. Reason: ${reason}`,
          metadata: { org_id: orgId, target_org_id: targetOrgId },
        },
      }).catch((err: any) => console.error("[trade-approval] Notification dispatch failed:", err));

      return new Response(JSON.stringify(envelope(updated, correlationId)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── POST /trade-approval/renew ── Extend validity
    if (req.method === "POST" && subAction === "renew") {
      requireRole(authCtx, "platform_admin");
      assertIdempotencyKey(req);
      const body = await req.json();
      const { org_id: targetOrgId, extend_days } = RenewSchema.parse(body);
      await requireMfaForApprovalOverride({ org_id: targetOrgId, sub: "renew" });

      const { data: existing } = await admin
        .from("trade_approvals")
        .select("id, valid_until")
        .eq("org_id", targetOrgId)
        .maybeSingle();

      if (!existing) throw new ApiException("NOT_FOUND", "No approval record for this organisation", 404);

      const baseDate = existing.valid_until ? new Date(existing.valid_until) : new Date();
      const newExpiry = new Date(baseDate);
      newExpiry.setDate(newExpiry.getDate() + extend_days);

      const { data: updated, error } = await admin
        .from("trade_approvals")
        .update({
          status: "approved",
          valid_until: newExpiry.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("org_id", targetOrgId)
        .select()
        .single();

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      // Event store + audit log (parity with issue & revoke)
      const eventHash = await sha256(JSON.stringify({ action: "renew", org_id: targetOrgId, extend_days }));
      await admin.from("event_store").insert({
        org_id: orgId, domain: "compliance", aggregate_type: "trade_approval", aggregate_id: updated.id,
        event_type: "compliance.trade_approval.renewed",
        actor_id: authCtx.userId, actor_role: authCtx.roles?.[0] || null,
        payload: { target_org_id: targetOrgId, previous_valid_until: existing.valid_until, new_valid_until: newExpiry.toISOString(), extend_days },
        event_hash: eventHash,
      });

      await admin.from("audit_logs").insert({
        org_id: orgId, actor_user_id: authCtx.userId,
        action: "trade_approval.renewed", entity_type: "trade_approval", entity_id: updated.id,
        metadata: { target_org_id: targetOrgId, previous_valid_until: existing.valid_until, new_valid_until: newExpiry.toISOString(), extend_days },
      });

      return new Response(JSON.stringify(envelope(updated, correlationId)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── POST /trade-approval ── Issue new approval
    if (req.method === "POST") {
      requireRole(authCtx, "platform_admin");
      const idempotencyKey = req.headers.get("Idempotency-Key");
      if (!idempotencyKey) throw new ApiException("VALIDATION_ERROR", "Idempotency-Key header required", 400);

      const body = await req.json();
      const parsed = ApprovalSchema.parse(body);

      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + parsed.valid_days);

      // If risk_band not provided, try to pull from latest DD risk score
      let riskBand = parsed.risk_band || null;
      if (!riskBand) {
        const { data: latestScore } = await admin
          .from("dd_risk_scores")
          .select("risk_band")
          .eq("org_id", parsed.org_id)
          .order("computed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        riskBand = latestScore?.risk_band || "medium";
      }

      // Upsert: one approval per org
      const { data: approval, error } = await admin
        .from("trade_approvals")
        .upsert({
          org_id: parsed.org_id,
          status: "approved",
          approved_at: new Date().toISOString(),
          approved_by: authCtx.userId,
          risk_band: riskBand,
          valid_until: validUntil.toISOString(),
          approval_request_id: parsed.approval_request_id || null,
        }, { onConflict: "org_id" })
        .select()
        .single();

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      // Event store
      const eventHash = await sha256(JSON.stringify({ action: "approve", org_id: parsed.org_id }));
      await admin.from("event_store").insert({
        org_id: orgId, domain: "compliance", aggregate_type: "trade_approval", aggregate_id: approval.id,
        event_type: "compliance.trade_approval.issued",
        actor_id: authCtx.userId, actor_role: authCtx.roles?.[0] || null,
        payload: { target_org_id: parsed.org_id, risk_band: riskBand, valid_until: validUntil.toISOString(), reason: parsed.reason },
        event_hash: eventHash,
      });

      await admin.from("audit_logs").insert({
        org_id: orgId, actor_user_id: authCtx.userId,
        action: "trade_approval.issued", entity_type: "trade_approval", entity_id: approval.id,
        metadata: { target_org_id: parsed.org_id, risk_band: riskBand, valid_days: parsed.valid_days },
      });

      // ── Approval routing notifications ──
      // Notify required approvers based on risk band / threshold
      const rolesToNotify: string[] = ["compliance_analyst"];
      if (riskBand === "medium" || riskBand === "high") rolesToNotify.push("legal_reviewer");
      if (riskBand === "high") rolesToNotify.push("director");

      // Find users with DD roles matching the required approver roles
      const { data: approverUsers } = await admin
        .from("dd_roles")
        .select("user_id, role")
        .eq("org_id", parsed.org_id)
        .in("role", rolesToNotify);

      if (approverUsers && approverUsers.length > 0) {
        const notificationRows = approverUsers.map((u: any) => ({
          user_id: u.user_id,
          org_id: parsed.org_id,
          type: "approval_required",
          title: `Trade approval requires your sign-off (${u.role})`,
          body: `A ${riskBand}-risk trade approval for this organisation requires ${u.role} review.`,
          link: `/dashboard/compliance`,
          read: false,
          // NOT-008: link to the trade_approval row so it can be auto-resolved
          // when the approval reaches a terminal state.
          entity_type: "trade_approval",
          entity_id: approval.id,
        }));
        const { error: notifErr } = await admin.from("notifications").insert(notificationRows);
        if (notifErr) {
          // Log but do not block approval issuance - notifications are non-transactional.
          // Record failure in audit log for operational visibility.
          console.error("Approval notification delivery failed:", notifErr.message);
          await admin.from("audit_logs").insert({
            org_id: orgId, actor_user_id: authCtx.userId,
            action: "approval_notification.failed", entity_type: "trade_approval", entity_id: approval.id,
            metadata: { error: notifErr.message, intended_recipients: notificationRows.length, roles: rolesToNotify },
          }).catch(() => { /* best-effort audit */ });
        }
      } else {
        // No approvers found - log for operational awareness
        console.warn(`No users with roles [${rolesToNotify.join(", ")}] found for org ${parsed.org_id}`);
      }

      return new Response(JSON.stringify(envelope(approval, correlationId)), {
        status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new ApiException("VALIDATION_ERROR", "Method not allowed", 405);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return new Response(
        JSON.stringify({ status: "ERROR", code: "VALIDATION_ERROR", message: err.errors.map((e) => e.message).join(", ") }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (err instanceof ApiException) {
      return new Response(
        JSON.stringify({ status: "ERROR", code: err.code, message: err.message }),
        { status: err.statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ status: "ERROR", code: "INTERNAL_ERROR", message: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
