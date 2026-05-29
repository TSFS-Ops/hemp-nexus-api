/**
 * Batch 4 — org-sso-config
 *
 * GET  → returns the SSO config for the caller's org (org_admin) or any
 *        org (platform_admin with ?org_id=...).
 * PUT  → upserts metadata_url / metadata_xml_ref / verified_domains /
 *        entity_id / acs_url / supabase_sso_provider_id / certificate_status
 *        for the target org. Status transitions to 'pending_metadata' /
 *        'configured_not_connected' / 'disabled' are allowed.
 *        Status='live' is REFUSED here — only org-sso-test-connection may
 *        promote, and the DB trigger enforces this independently.
 *
 * AAL2 is required for every mutation. AAL1 callers receive a stable
 * 403 / MFA_REQUIRED, matching the staging-password and break-glass
 * endpoints from Batch 3.
 *
 * Audits use the IDENTITY_AUDIT_NAMES SSOT only. The prebuild guard
 * (scripts/check-identity-audit-names.mjs) forbids inline literals.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { IDENTITY_AUDIT_NAMES, writeIdentityAudit } from "../_shared/identity-audit.ts";

const PutSchema = z.object({
  org_id: z.string().uuid(),
  provider: z.enum(["saml"]).optional(),
  metadata_url: z.string().url().nullable().optional(),
  metadata_xml_ref: z.string().min(1).max(512).nullable().optional(),
  verified_domains: z.array(z.string().min(3).max(253)).max(64).optional(),
  entity_id: z.string().max(512).nullable().optional(),
  acs_url: z.string().url().nullable().optional(),
  supabase_sso_provider_id: z.string().max(255).nullable().optional(),
  certificate_status: z.enum(["none", "present", "expiring", "expired"]).optional(),
  status: z
    .enum([
      "not_configured",
      "pending_metadata",
      "configured_not_connected",
      "disabled",
    ])
    .optional(),
  failure_reason: z.string().max(2000).nullable().optional(),
});

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const cors = handleCors(req, allowedOrigins);
    if (cors) return cors;

    if (req.method !== "GET" && req.method !== "PUT") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    if (authCtx.isApiKey) {
      throw new ApiException("FORBIDDEN", "API-key callers cannot manage SSO config.", 403);
    }

    // Determine caller role.
    const { data: rolesRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", authCtx.userId);
    const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);
    const isPlatformAdmin = roles.includes("platform_admin");
    const isOrgAdmin = roles.includes("org_admin");
    if (!isPlatformAdmin && !isOrgAdmin) {
      throw new ApiException("FORBIDDEN", "SSO configuration is restricted to org_admin or platform_admin.", 403);
    }

    // Resolve target org.
    const url = new URL(req.url);
    let targetOrgId: string | null = null;
    if (req.method === "GET") {
      targetOrgId = url.searchParams.get("org_id");
    }

    let body: z.infer<typeof PutSchema> | null = null;
    if (req.method === "PUT") {
      await assertAal2(req.headers.get("authorization"), {
        adminClient: admin,
        callerUserId: authCtx.userId,
        action: "identity.sso_config_put",
      });
      const raw = await req.json().catch(() => null);
      const parsed = PutSchema.safeParse(raw);
      if (!parsed.success) {
        throw new ApiException("VALIDATION_ERROR", "Invalid SSO config payload", 400, parsed.error.flatten());
      }
      body = parsed.data;
      targetOrgId = body.org_id;
    }

    if (!targetOrgId) {
      // org_admin defaults to their own org.
      const { data: prof } = await admin
        .from("profiles")
        .select("org_id")
        .eq("id", authCtx.userId)
        .maybeSingle();
      targetOrgId = prof?.org_id ?? null;
    }
    if (!targetOrgId) {
      throw new ApiException("VALIDATION_ERROR", "Could not resolve target organisation.", 400);
    }

    // Boundary: org_admin may only touch their own org.
    if (!isPlatformAdmin) {
      const { data: prof } = await admin
        .from("profiles")
        .select("org_id")
        .eq("id", authCtx.userId)
        .maybeSingle();
      if (!prof?.org_id || prof.org_id !== targetOrgId) {
        throw new ApiException("FORBIDDEN", "Org admins may only manage their own organisation's SSO config.", 403);
      }
    }

    if (req.method === "GET") {
      const { data, error } = await admin
        .from("org_sso_configs")
        .select("*")
        .eq("org_id", targetOrgId)
        .maybeSingle();
      if (error) handleDatabaseError(error, requestId);
      return new Response(JSON.stringify({ config: data ?? null }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // PUT path -----------------------------------------------------------
    if (!body) throw new ApiException("VALIDATION_ERROR", "Missing body", 400);

    // Detect whether the row exists to choose audit and emit metadata/domain
    // change audits accurately.
    const { data: existing } = await admin
      .from("org_sso_configs")
      .select("*")
      .eq("org_id", targetOrgId)
      .maybeSingle();

    const writeRow: Record<string, unknown> = {
      org_id: targetOrgId,
      reviewed_by: authCtx.userId,
    };
    if (!existing) writeRow.requested_by = authCtx.userId;
    if (body.provider !== undefined) writeRow.provider = body.provider;
    if (body.metadata_url !== undefined) writeRow.metadata_url = body.metadata_url;
    if (body.metadata_xml_ref !== undefined) writeRow.metadata_xml_ref = body.metadata_xml_ref;
    if (body.verified_domains !== undefined) writeRow.verified_domains = body.verified_domains;
    if (body.entity_id !== undefined) writeRow.entity_id = body.entity_id;
    if (body.acs_url !== undefined) writeRow.acs_url = body.acs_url;
    if (body.supabase_sso_provider_id !== undefined) writeRow.supabase_sso_provider_id = body.supabase_sso_provider_id;
    if (body.certificate_status !== undefined) writeRow.certificate_status = body.certificate_status;
    if (body.failure_reason !== undefined) writeRow.failure_reason = body.failure_reason;
    if (body.status !== undefined) writeRow.status = body.status;

    const { data: saved, error: upsertErr } = await admin
      .from("org_sso_configs")
      .upsert(writeRow, { onConflict: "org_id" })
      .select()
      .single();
    if (upsertErr) handleDatabaseError(upsertErr, requestId);

    // Audit emissions -----------------------------------------------------
    const auditPayload = (extra: Record<string, unknown>) => ({
      org_id: targetOrgId!,
      actor_user_id: authCtx.userId,
      entity_id: saved.id,
      metadata: { request_id: requestId, ...extra },
    });

    if (!existing) {
      await writeIdentityAudit(admin, IDENTITY_AUDIT_NAMES.sso_config_created, auditPayload({
        provider: saved.provider,
      }));
    }
    const metadataChanged =
      (body.metadata_url !== undefined && body.metadata_url !== existing?.metadata_url) ||
      (body.metadata_xml_ref !== undefined && body.metadata_xml_ref !== existing?.metadata_xml_ref) ||
      (body.entity_id !== undefined && body.entity_id !== existing?.entity_id) ||
      (body.acs_url !== undefined && body.acs_url !== existing?.acs_url) ||
      (body.supabase_sso_provider_id !== undefined &&
        body.supabase_sso_provider_id !== existing?.supabase_sso_provider_id);
    if (metadataChanged) {
      await writeIdentityAudit(admin, IDENTITY_AUDIT_NAMES.sso_metadata_updated, auditPayload({
        metadata_url_present: !!saved.metadata_url,
        metadata_xml_present: !!saved.metadata_xml_ref,
        supabase_sso_provider_id: saved.supabase_sso_provider_id,
      }));
    }
    if (body.verified_domains !== undefined) {
      const before = existing?.verified_domains ?? [];
      const after = saved.verified_domains ?? [];
      const changed = before.length !== after.length || before.some((d: string, i: number) => d !== after[i]);
      if (changed || !existing) {
        await writeIdentityAudit(admin, IDENTITY_AUDIT_NAMES.sso_domains_updated, auditPayload({
          previous_count: before.length,
          new_count: after.length,
        }));
      }
    }
    if (body.status === "disabled" && existing?.status !== "disabled") {
      await writeIdentityAudit(admin, IDENTITY_AUDIT_NAMES.sso_disabled, auditPayload({
        previous_status: existing?.status ?? null,
      }));
    }

    return new Response(JSON.stringify({ config: saved }), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
      requestId,
      headers,
    );
  }
});
