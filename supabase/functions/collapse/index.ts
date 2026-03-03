import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";

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
      public_key_jwk,
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
    for (const [label, oid] of [["Requesting org", org_id], ["Counterparty", counterparty_org_id]] as const) {
      const { data: approval } = await adminClient
        .from("trade_approvals")
        .select("status, valid_until")
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

    // ── CAP partition check — consistency first ──
    const partition = await checkPartitionHealth(adminClient);
    if (!partition.healthy) {
      return new Response(
        JSON.stringify({
          error: "Service unavailable — partition state detected",
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
          collapsed: true,
          idempotent: true,
          collapse_id: existing.id,
          payload_hash: existing.payload_hash,
          created_at: existing.created_at,
          message: "Duplicate request — returning original collapse record",
        }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // ── State machine check: POI must be in ELIGIBLE or COLLAPSE_REQUESTED state ──
    if (match_id && UUID_RE.test(match_id)) {
      const { data: match } = await adminClient
        .from("matches")
        .select("poi_state")
        .eq("id", match_id)
        .maybeSingle();

      if (match) {
        const allowed = ["ELIGIBLE", "COLLAPSE_REQUESTED"];
        if (!allowed.includes(match.poi_state)) {
          throw new ApiException(
            "STATE_VIOLATION",
            `Collapse not allowed from state ${match.poi_state}. Must be ELIGIBLE or COLLAPSE_REQUESTED.`,
            422,
            { currentState: match.poi_state }
          );
        }
      }
    }

    // ── ECDSA signature verification ──
    let signatureValid = false;
    if (public_key_jwk && signed_payload) {
      const parts = signed_payload.split(":");
      if (parts.length >= 2) {
        const signatureB64 = parts[0];
        const canonicalPayload = parts.slice(1).join(":");
        signatureValid = await verifyEcdsaSignature(canonicalPayload, signatureB64, public_key_jwk);
      }
    }

    if (!signatureValid) {
      throw new ApiException(
        "SIGNATURE_INVALID",
        "Invalid ECDSA signature — collapse rejected",
        400,
        { signatureValid: false }
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

    // ── Insert into append-only ledger ──
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
        poi_state: "COLLAPSED",
        metadata: metadata || {},
        actor_user_id: actorUserId || null,
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
              collapsed: true,
              idempotent: true,
              collapse_id: raceExisting.id,
              payload_hash: raceExisting.payload_hash,
              created_at: raceExisting.created_at,
              message: "Duplicate request — returning original collapse record",
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
        .update({ poi_state: "COLLAPSED" })
        .eq("id", match_id);

      await adminClient.from("poi_events").insert({
        match_id,
        org_id,
        from_state: "COLLAPSE_REQUESTED",
        to_state: "COLLAPSED",
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
      action: "poi.collapsed",
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
        collapsed: true,
        idempotent: false,
        collapse_id: record.id,
        payload_hash: payloadHash,
        signature_valid: signatureValid,
        poi_state: "COLLAPSED",
        created_at: record.created_at,
      }),
      { status: 201, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`[${requestId}] Collapse engine error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
