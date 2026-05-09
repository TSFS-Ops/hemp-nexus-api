import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";
import { assertEngagementAllowsProgression } from "../_shared/engagement-progression-guard.ts";
import { assertNoOpenChallenge } from "../_shared/challenge-progression-guard.ts";

// ── Mandatory fields ──
const MANDATORY_FIELDS = [
  "org_id",
  "counterparty_org_id",
  "asset_id",
  "quantity",
  "price",
  "currency",
  "client_timestamp",
  "idempotency_key",
  "signed_payload",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_RE = /^[A-Z]{3}$/;
const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

// ── SHA-256 helper ──
async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── ECDSA signature verification ──
async function verifyEcdsaSignature(
  payload: string,
  signatureB64: string,
  publicKeyJwk: JsonWebKey
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    const sig = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
    const data = new TextEncoder().encode(payload);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sig,
      data
    );
  } catch {
    return false;
  }
}

// ── Partition health check ──
async function checkPartitionHealth(
  adminClient: ReturnType<typeof createClient>
): Promise<{ healthy: boolean; reason?: string }> {
  try {
    const probe = crypto.randomUUID();
    const { error: writeErr } = await adminClient
      .from("audit_logs")
      .insert({
        org_id: "00000000-0000-0000-0000-000000000000",
        action: `partition.probe.${probe}`,
        entity_type: "system",
      });

    if (writeErr) {
      const msg = writeErr.message || "";
      if (msg.includes("foreign key") || msg.includes("violates") || msg.includes("23503")) {
        return { healthy: true };
      }
      if (msg.includes("timeout") || msg.includes("connection") || msg.includes("ECONNREFUSED")) {
        return { healthy: false, reason: `Database connectivity issue: ${msg}` };
      }
      return { healthy: true };
    }
    return { healthy: true };
  } catch (err) {
    return {
      healthy: false,
      reason: `Partition detected: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "POST") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }

    // ─── Idempotency-Key required ──────────────────────────────
    // Collapse mutates POI evidence-chain state; a retried POST without a
    // key would otherwise create duplicate collapse events on the ledger.
    const idempotencyKey =
      req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "Idempotency-Key header is required",
        400,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Auth via shared module (JWT + API key) ──
    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    if (authCtx.isApiKey) {
      requireScope(authCtx, "collapse");
    }

    const { actorUserId, actorApiKeyId } = deriveActorIds(authCtx);

    const adminClient = createClient(supabaseUrl, serviceKey);

    // ── Rate limiting ──
    await checkRateLimit(adminClient, authCtx.orgId, actorApiKeyId, "collapse", "collapse");

    // ── Body size check ──
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
      throw new ApiException("PAYLOAD_TOO_LARGE", "Payload too large (max 1 MB)", 413);
    }

    const body = await req.json();

    // ── Mandatory field validation ──
    const missing: string[] = [];
    for (const field of MANDATORY_FIELDS) {
      if (body[field] === undefined || body[field] === null || body[field] === "") {
        missing.push(field);
      }
    }
    if (missing.length > 0) {
      throw new ApiException("VALIDATION_ERROR", `Missing mandatory fields: ${missing.join(", ")}`, 400, { missingFields: missing });
    }

    const {
      org_id,
      counterparty_org_id,
      asset_id,
      quantity,
      price,
      currency,
      client_timestamp,
      idempotency_key,
      signed_payload,
      signature_key_id,
      match_id,
      metadata,
    } = body;

    // ── Type validation ──
    if (!UUID_RE.test(org_id)) throw new ApiException("VALIDATION_ERROR", "org_id must be a valid UUID", 400);
    if (!UUID_RE.test(counterparty_org_id)) throw new ApiException("VALIDATION_ERROR", "counterparty_org_id must be a valid UUID", 400);
    if (org_id === counterparty_org_id) throw new ApiException("VALIDATION_ERROR", "org_id and counterparty_org_id must differ", 400);
    if (typeof quantity !== "number" || quantity <= 0) throw new ApiException("VALIDATION_ERROR", "quantity must be a positive number", 400);
    if (typeof price !== "number" || price <= 0) throw new ApiException("VALIDATION_ERROR", "price must be a positive number", 400);
    if (!CURRENCY_RE.test(currency)) throw new ApiException("VALIDATION_ERROR", "currency must be a 3-letter uppercase ISO code", 400);

    // ── Org ownership check: API key org must match org_id ──
    if (authCtx.orgId !== org_id) {
      throw new ApiException("FORBIDDEN", "API key org does not match org_id in payload", 403);
    }

    // ── Trade Approval enforcement for BOTH parties ──
    for (const [label, oid] of [["Requesting org", org_id], ["Trading Partner", counterparty_org_id]] as const) {
      const { data: approval } = await adminClient
        .from("trade_approvals")
        .select("status, valid_until, risk_band")
        .eq("org_id", oid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!approval || approval.status !== "approved") {
        throw new ApiException(
          "ELIGIBILITY_FAILED",
          `${label} (${oid}) is not Approved to Trade. Collapse rejected.`,
          422,
          { orgId: oid, currentStatus: approval?.status || "none" }
        );
      }
      if (approval.valid_until && new Date(approval.valid_until) < new Date()) {
        throw new ApiException(
          "ELIGIBILITY_FAILED",
          `${label} (${oid}) trade approval has expired. Collapse rejected.`,
          422,
          { orgId: oid, expiredAt: approval.valid_until }
        );
      }
    }

    // ── Dynamic approval threshold enforcement ──
    // Query configurable thresholds for the requesting org
    const { data: thresholdConfig } = await adminClient
      .from("approval_thresholds")
      .select("low_threshold, high_threshold")
      .eq("org_id", org_id)
      .maybeSingle();

    const tradeValue = quantity * price;
    const lowThreshold = thresholdConfig?.low_threshold ?? 100000;
    const highThreshold = thresholdConfig?.high_threshold ?? 1000000;

    // Determine required approval tier based on trade value
    let requiredApprovalTier: string;
    if (tradeValue >= highThreshold) {
      requiredApprovalTier = "director";
    } else if (tradeValue >= lowThreshold) {
      requiredApprovalTier = "legal_reviewer";
    } else {
      requiredApprovalTier = "compliance_analyst";
    }

    // Check that the requesting org has completed the required approval level
    const { data: approvalReq } = await adminClient
      .from("dd_approval_requests")
      .select("completed_roles, status")
      .eq("target_org_id", counterparty_org_id)
      .eq("requesting_org_id", org_id)
      .eq("status", "approved")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!approvalReq) {
      throw new ApiException(
        "ELIGIBILITY_FAILED",
        "No approved due diligence request found for counterparty. Collapse rejected.",
        422,
        { requiredTier: requiredApprovalTier, tradeValue }
      );
    }

    const completedRoles: string[] = approvalReq.completed_roles || [];
    const tierHierarchy = ["compliance_analyst", "legal_reviewer", "director"];
    const requiredIndex = tierHierarchy.indexOf(requiredApprovalTier);
    const tiersNeeded = tierHierarchy.slice(0, requiredIndex + 1);
    const missingTiers = tiersNeeded.filter(t => !completedRoles.includes(t));

    if (missingTiers.length > 0) {
      throw new ApiException(
        "APPROVAL_INSUFFICIENT",
        `Trade value ${currency} ${tradeValue} requires ${requiredApprovalTier} approval. Missing: ${missingTiers.join(", ")}`,
        422,
        { requiredTier: requiredApprovalTier, tradeValue, missingTiers, completedRoles }
      );
    }

    // ── §24 BRD constraints runtime validation ──
    // Verify that core protocol rules haven't been tampered with
    const REQUIRED_CONSTRAINTS: Record<string, string> = {
      signed_payload_required: "enforced",
      idempotency_mandatory: "enforced",
      rpo_zero: "enforced",
      partition_consistency: "enforced",
      append_only_ledger: "enforced",
    };

    const { data: constraints } = await adminClient
      .from("brd_constraints")
      .select("constraint_key, current_value, locked")
      .in("constraint_key", Object.keys(REQUIRED_CONSTRAINTS));

    const constraintMap = new Map((constraints || []).map((c: any) => [c.constraint_key, c]));

    for (const [key, requiredValue] of Object.entries(REQUIRED_CONSTRAINTS)) {
      const constraint = constraintMap.get(key);
      if (!constraint) {
        throw new ApiException(
          "GOVERNANCE_VIOLATION",
          `BRD constraint '${key}' not found. Collapse rejected - protocol integrity cannot be verified.`,
          503,
          { missingConstraint: key }
        );
      }
      if (constraint.current_value !== requiredValue) {
        throw new ApiException(
          "GOVERNANCE_VIOLATION",
          `BRD constraint '${key}' has been modified (expected '${requiredValue}', got '${constraint.current_value}'). Collapse rejected.`,
          503,
          { constraint: key, expected: requiredValue, actual: constraint.current_value }
        );
      }
      if (!constraint.locked) {
        throw new ApiException(
          "GOVERNANCE_VIOLATION",
          `BRD constraint '${key}' is unlocked. Collapse rejected - all core constraints must be locked.`,
          503,
          { constraint: key, locked: false }
        );
      }
    }

    // ── Check global collapse freeze (break-glass) ──
    const { data: freezeSetting } = await adminClient
      .from("admin_settings")
      .select("value")
      .eq("key", "collapse_freeze")
      .maybeSingle();

    if ((freezeSetting?.value as any)?.enabled) {
      throw new ApiException(
        "COLLAPSE_FROZEN",
        "Global collapse freeze is active. All collapse operations are halted by break-glass protocol.",
        503,
        { frozenBy: (freezeSetting?.value as any)?.frozen_by, frozenAt: (freezeSetting?.value as any)?.frozen_at }
      );
    }

    // ── Check org-level freeze ──
    const { data: orgData } = await adminClient
      .from("organizations")
      .select("frozen, frozen_reason")
      .eq("id", org_id)
      .maybeSingle();

    if (orgData?.frozen) {
      throw new ApiException(
        "ORG_FROZEN",
        `Organisation ${org_id} is frozen: ${orgData.frozen_reason || "No reason provided"}`,
        503
      );
    }

    // ── Webhook circuit-breaker guard (PRIMARY endpoints only) ──
    // Block settlement if EITHER participant has their PRIMARY webhook endpoint
    // auto-disabled (status='inactive' AND disabled_at IS NOT NULL). A tripped
    // primary breaker means the participant's canonical delivery channel is
    // dead and settlement evidence cannot be reliably broadcast.
    // Non-primary (secondary/backup) endpoints being disabled does not block.
    const { data: trippedEndpoints, error: trippedErr } = await adminClient
      .from("webhook_endpoints")
      .select("id, org_id, url, disabled_at, consecutive_failures, is_primary")
      .in("org_id", [org_id, counterparty_org_id])
      .eq("is_primary", true)
      .eq("status", "inactive")
      .not("disabled_at", "is", null);

    if (trippedErr) {
      throw new ApiException(
        "INTERNAL_ERROR",
        "Failed to verify webhook delivery health",
        500,
        { detail: trippedErr.message }
      );
    }

    if (trippedEndpoints && trippedEndpoints.length > 0) {
      const offenders = trippedEndpoints.map((e) => ({
        endpoint_id: e.id,
        org_id: e.org_id,
        role: e.org_id === org_id ? "requesting_org" : "counterparty",
        disabled_at: e.disabled_at,
        consecutive_failures: e.consecutive_failures,
      }));
      console.warn(
        `[SETTLEMENT BLOCKED] Tripped webhook endpoints detected:`,
        JSON.stringify(offenders)
      );
      throw new ApiException(
        "WEBHOOK_PRIMARY_BREAKER_TRIPPED",
        "Settlement blocked: one or more participants have an auto-disabled PRIMARY webhook endpoint. " +
          "Re-enable the primary endpoint (clear disabled_at and set status='active'), or elect a healthy endpoint as primary, before retrying.",
        409,
        { tripped_primary_endpoints: offenders }
      );
    }

    // ── CAP partition check - consistency first ──
    const partition = await checkPartitionHealth(adminClient);
    if (!partition.healthy) {
      return new Response(
        JSON.stringify({
          error: "Service unavailable - partition state detected",
          partitionState: true,
          reason: partition.reason,
        }),
        { status: 503, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // ── Idempotency check ──
    const { data: existing } = await adminClient
      .from("collapse_ledger")
      .select("id, payload_hash, created_at")
      .eq("org_id", org_id)
      .eq("idempotency_key", idempotency_key)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({
          completed: true,
          idempotent: true,
          collapse_id: existing.id,
          payload_hash: existing.payload_hash,
          created_at: existing.created_at,
          message: "Duplicate request - returning original collapse record",
        }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // ── State machine check: POI must be in ELIGIBLE or COMPLETION_REQUESTED state ──
    if (match_id && UUID_RE.test(match_id)) {
      const { data: match } = await adminClient
        .from("matches")
        .select("poi_state, completion_probability")
        .eq("id", match_id)
        .maybeSingle();

      if (match) {
        const allowed = ["ELIGIBLE", "COMPLETION_REQUESTED"];
        if (!allowed.includes(match.poi_state)) {
          throw new ApiException(
            "STATE_VIOLATION",
            `Collapse not allowed from state ${match.poi_state}. Must be ELIGIBLE or COMPLETION_REQUESTED.`,
            422,
            { currentState: match.poi_state }
          );
        }

        // ── POI Probability prerequisite: ≥50.1% required for collapse ──
        const probability = match.completion_probability;
        if (probability === null || probability === undefined || probability < 50.1) {
          throw new ApiException(
            "PROBABILITY_THRESHOLD_NOT_MET",
            `POI completion probability is ${probability ?? "not calculated"}%. Minimum 50.1% required for collapse.`,
            422,
            { current_probability: probability, required: 50.1 }
          );
        }
      }

      // ── ENGAGEMENT HOLD-POINT GUARD (Batch B Phase 4) ──
      // Collapse / finality is the terminal commercial event for a match.
      // Block when the current engagement is anything other than `accepted`
      // (incl. late-acceptance pending reconfirmation, or a renewed
      // pending child superseding a historical accepted row).
      // Batch C Phase 3A: collapse blocked while a challenge is open.
      const challengeDecision = await assertNoOpenChallenge(adminClient, match_id);
      if (!challengeDecision.allowed) {
        throw new ApiException(
          "CHALLENGE_OPEN",
          challengeDecision.message ?? "Progression paused.",
          409,
          {
            challenge_id: challengeDecision.challengeId,
            challenge_status: challengeDecision.challengeStatus,
            raised_at: challengeDecision.raisedAt,
          },
        );
      }

      const engDecision = await assertEngagementAllowsProgression(adminClient, match_id);
      if (!engDecision.allowed) {
        throw new ApiException(
          engDecision.code!,
          engDecision.message ?? "Counterparty engagement is not accepted. Collapse blocked.",
          409,
          {
            current_engagement_status: engDecision.currentStatus,
            has_historical_engagement: engDecision.hasHistorical,
          },
        );
      }
    }

    // ── ECDSA signature verification via persistent key registry ──
    if (!signature_key_id) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "signature_key_id is required. Register your signing key via the /signing-keys endpoint first.",
        400
      );
    }

    // Look up the public key from the server-side registry - never trust client-supplied keys
    const { data: registeredKey, error: keyLookupErr } = await adminClient
      .from("signing_keys")
      .select("id, public_key_jwk, status, algorithm")
      .eq("org_id", org_id)
      .eq("key_id", signature_key_id)
      .maybeSingle();

    if (keyLookupErr) {
      throw new ApiException("INTERNAL_ERROR", "Failed to look up signing key", 500);
    }

    if (!registeredKey) {
      throw new ApiException(
        "KEY_NOT_FOUND",
        `Signing key '${signature_key_id}' is not registered for this organisation. Register it via POST /signing-keys.`,
        404,
        { signature_key_id }
      );
    }

    if (registeredKey.status !== "active") {
      throw new ApiException(
        "KEY_REVOKED",
        `Signing key '${signature_key_id}' has status '${registeredKey.status}'. Only active keys may be used for collapse.`,
        403,
        { signature_key_id, key_status: registeredKey.status }
      );
    }

    let signatureValid = false;
    const parts = signed_payload.split(":");
    if (parts.length >= 2) {
      const signatureB64 = parts[0];
      const canonicalPayload = parts.slice(1).join(":");
      signatureValid = await verifyEcdsaSignature(
        canonicalPayload,
        signatureB64,
        registeredKey.public_key_jwk as JsonWebKey
      );
    }

    if (!signatureValid) {
      throw new ApiException(
        "SIGNATURE_INVALID",
        "ECDSA signature verification failed against the registered public key. Collapse rejected.",
        400,
        { signatureValid: false, signature_key_id }
      );
    }

    // ── SHA-256 hash of canonical payload ──
    const canonicalData = JSON.stringify({
      org_id,
      counterparty_org_id,
      asset_id,
      quantity,
      price,
      currency,
      client_timestamp,
      idempotency_key,
    });
    const payloadHash = await sha256(canonicalData);

    // ── NTP drift measurement ──
    // Measure clock drift: compare server UTC with client_timestamp
    const serverNow = new Date();
    const clientTs = new Date(client_timestamp);
    const measuredDriftMs = isNaN(clientTs.getTime()) ? null : serverNow.getTime() - clientTs.getTime();
    const ntpSource = body.ntp_source || "edge-server-utc";
    const ntpStatus = measuredDriftMs !== null
      ? (Math.abs(measuredDriftMs) <= 1000 ? "hardened" : "drift-detected")
      : "not-measurable";

    // ── Insert into append-only ledger (incl. BRD §7 fields) ──
    const { data: record, error: insertError } = await adminClient
      .from("collapse_ledger")
      .insert({
        org_id,
        counterparty_org_id,
        match_id: match_id && UUID_RE.test(match_id) ? match_id : null,
        asset_id,
        quantity,
        price,
        currency,
        client_timestamp,
        idempotency_key,
        signed_payload,
        signature_key_id: signature_key_id || null,
        signature_valid: signatureValid,
        payload_hash: payloadHash,
        poi_state: "COMPLETED",
        metadata: metadata || {},
        actor_user_id: actorUserId || null,
        payload_ciphertext: body.payload_ciphertext || null,
        ntp_source: ntpSource,
        ntp_drift_ms: measuredDriftMs,
        timestamp_source_metadata: {
          source: ntpSource,
          client_timestamp,
          server_timestamp: serverNow.toISOString(),
          ntp_status: ntpStatus,
          ntp_server: body.ntp_server || "edge-runtime-clock",
          drift_ms: measuredDriftMs,
          measurement_method: "server-client-delta",
          drift_acceptable: measuredDriftMs !== null ? Math.abs(measuredDriftMs) <= 1000 : null,
        },
        annulment_reference: body.annulment_reference || null,
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.message?.includes("unique_idempotency_per_org") || insertError.code === "23505") {
        const { data: raceExisting } = await adminClient
          .from("collapse_ledger")
          .select("id, payload_hash, created_at")
          .eq("org_id", org_id)
          .eq("idempotency_key", idempotency_key)
          .single();

        if (raceExisting) {
          return new Response(
            JSON.stringify({
              completed: true,
              idempotent: true,
              collapse_id: raceExisting.id,
              payload_hash: raceExisting.payload_hash,
              created_at: raceExisting.created_at,
              message: "Duplicate request - returning original collapse record",
            }),
            { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
          );
        }
      }

      console.error("Collapse insert error:", insertError);
      throw new ApiException("INTERNAL_ERROR", "Failed to create collapse record", 500);
    }

    // ── Update match state if linked ──
    if (match_id && UUID_RE.test(match_id)) {
      await adminClient
        .from("matches")
        .update({ poi_state: "COMPLETED" })
        .eq("id", match_id);

      await adminClient.from("poi_events").insert({
        match_id,
        org_id,
        from_state: "COMPLETION_REQUESTED",
        to_state: "COMPLETED",
        actor_user_id: actorUserId || null,
        actor_api_key_id: actorApiKeyId || null,
        reason: "Deterministic collapse via collapse engine",
        metadata: {
          collapse_id: record.id,
          payload_hash: payloadHash,
          signature_valid: signatureValid,
          idempotency_key,
        },
      });
    }

    // ── Audit log ──
    await adminClient.from("audit_logs").insert({
      org_id,
      actor_user_id: actorUserId || null,
      actor_api_key_id: actorApiKeyId || null,
      action: "poi.completed",
      entity_type: "collapse_ledger",
      entity_id: record.id,
      metadata: {
        payload_hash: payloadHash,
        signature_valid: signatureValid,
        idempotency_key,
        counterparty_org_id,
        asset_id,
        quantity,
        price,
        currency,
        request_id: requestId,
      },
    });

    return new Response(
      JSON.stringify({
        completed: true,
        idempotent: false,
        collapse_id: record.id,
        payload_hash: payloadHash,
        signature_valid: signatureValid,
        poi_state: "COMPLETED",
        created_at: record.created_at,
      }),
      { status: 201, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`[${requestId}] Collapse engine error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
