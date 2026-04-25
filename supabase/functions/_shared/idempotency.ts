/**
 * Server-side idempotency primitives.
 * ───────────────────────────────────
 * Uniform contract for all mutating Edge Functions:
 *
 *   1. Caller MAY include an `Idempotency-Key` header (UUID or any unique string)
 *   2. If present, the helper short-circuits duplicate requests and returns the
 *      cached response with `X-Idempotent-Replay: true`
 *   3. If absent, the helper still completes the request — but logs a structured
 *      warning so we can later tighten enforcement per-endpoint
 *   4. Successful responses are persisted into `public.idempotency_keys` with a
 *      24h TTL (configurable via `expiresAfterHours`)
 *
 * Why this shape:
 *   • A "soft" mode (warn-only) keeps backwards compatibility with older
 *     clients while letting us roll out enforcement endpoint-by-endpoint
 *   • Cached body + status preserves exact prior response, including any
 *     server-generated IDs or timestamps
 *   • TTL prevents the table from growing unbounded — the storage-orphan
 *     cleanup function already prunes expired rows
 *
 * Failure modes & how we handle them:
 *   • DB read fails → fall through (do not block legitimate requests)
 *   • DB write fails after success → log error, still return the live response
 *   • Two concurrent requests with the same key arrive simultaneously
 *     → one wins the unique-index race; the loser sees the cached response on
 *       the next read attempt. We do NOT lock optimistically here; the cost
 *     of a duplicate side-effect on a true race is bounded because each
 *     downstream mutation is itself idempotent (hash collisions, advisory
 *     locks, append-only events).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export interface IdempotencyOptions {
  /** Service-role Supabase client (bypasses RLS). */
  supabase: SupabaseClient;
  /** Org context for the request (mandatory — keys are scoped per-org). */
  orgId: string;
  /** Endpoint identifier, e.g. "POST /poi-transition" or "POST /collapse". */
  endpoint: string;
  /** Idempotency key from the request header (or null if not provided). */
  idempotencyKey: string | null;
  /** Whether the endpoint REQUIRES the header. Defaults to false (warn-only). */
  required?: boolean;
  /** Cache TTL in hours. Defaults to 24. */
  expiresAfterHours?: number;
  /** Optional request hash for additional collision guard. */
  requestHash?: string;
  /** Request id for log correlation. */
  requestId?: string;
}

export interface CachedIdempotentResponse {
  status: number;
  body: unknown;
}

/**
 * Look up a previously cached idempotent response. Returns null if not found
 * or if no key was provided (in soft mode). Throws if `required: true` and
 * the header is missing.
 */
export async function lookupIdempotentResponse(
  opts: IdempotencyOptions,
): Promise<CachedIdempotentResponse | null> {
  const { supabase, orgId, endpoint, idempotencyKey, required, requestId } = opts;

  if (!idempotencyKey) {
    if (required) {
      const err = new Error("Idempotency-Key header is required for this endpoint");
      (err as any).statusCode = 400;
      (err as any).code = "IDEMPOTENCY_KEY_REQUIRED";
      throw err;
    }
    console.warn(
      `[idempotency][${requestId ?? "-"}] No Idempotency-Key on ${endpoint} — duplicate suppression disabled for this call`,
    );
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("idempotency_keys")
      .select("response_data, response_status_code")
      .eq("org_id", orgId)
      .eq("idempotency_key", idempotencyKey)
      .eq("endpoint", endpoint)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error) {
      console.error(
        `[idempotency][${requestId ?? "-"}] Lookup failed for ${endpoint}:`,
        error.message,
      );
      return null;
    }

    if (!data) return null;

    return {
      status: data.response_status_code,
      body: data.response_data,
    };
  } catch (e) {
    console.error(
      `[idempotency][${requestId ?? "-"}] Unexpected lookup error for ${endpoint}:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * Persist a successful response into the idempotency cache. Best-effort —
 * never throws (failure here is logged but does not affect the live request).
 */
export async function storeIdempotentResponse(
  opts: IdempotencyOptions,
  response: CachedIdempotentResponse,
): Promise<void> {
  const {
    supabase,
    orgId,
    endpoint,
    idempotencyKey,
    expiresAfterHours = 24,
    requestHash,
    requestId,
  } = opts;

  if (!idempotencyKey) return;
  // Only cache 2xx responses — caching errors would re-serve transient failures.
  if (response.status < 200 || response.status >= 300) return;

  try {
    const expiresAt = new Date(
      Date.now() + expiresAfterHours * 60 * 60 * 1000,
    ).toISOString();
    const { error } = await supabase.from("idempotency_keys").insert({
      org_id: orgId,
      idempotency_key: idempotencyKey,
      endpoint,
      request_hash: requestHash ?? "",
      response_data: response.body as any,
      response_status_code: response.status,
      expires_at: expiresAt,
    });

    if (error) {
      // Unique-violation on (org_id, idempotency_key, endpoint) is expected on
      // race conditions and is not an error — the other request already cached.
      const isUniqueViolation = (error as any).code === "23505";
      if (!isUniqueViolation) {
        console.error(
          `[idempotency][${requestId ?? "-"}] Cache write failed for ${endpoint}:`,
          error.message,
        );
      }
    }
  } catch (e) {
    console.error(
      `[idempotency][${requestId ?? "-"}] Unexpected cache write error for ${endpoint}:`,
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * Convenience helper that builds a Response from a cached entry, preserving
 * status code and adding the X-Idempotent-Replay marker.
 */
export function cachedResponseToHttp(
  cached: CachedIdempotentResponse,
  baseHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(cached.body), {
    status: cached.status,
    headers: {
      ...baseHeaders,
      "Content-Type": "application/json",
      "X-Idempotent-Replay": "true",
    },
  });
}

// Shared helpers for Idempotency-Key handling.
//
// Pulled out of supabase/functions/wad/index.ts so the request-hashing rules
// (which determine whether a "repeat" request really has the same payload)
// can be unit-tested without spinning up Supabase. Keep this file pure —
// no DB calls, no Supabase imports.

/**
 * Lower-case hex SHA-256 of the input string. Used to fingerprint the
 * canonical request body so a retry with the same data short-circuits to
 * the cached response, while a retry with a different body returns 409.
 */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build the canonical (key-order-independent) JSON string for an attest
 * request. We only include the fields that semantically define the action;
 * incidental headers / IP / user agent are intentionally excluded so retries
 * from different network paths still match.
 */
export function canonicalAttestBody(input: {
  attested_name: string;
  role: string;
}): string {
  return JSON.stringify({
    attested_name: input.attested_name,
    role: input.role,
  });
}

/**
 * Convenience: hash the canonical attest body in one step.
 */
export function hashAttestBody(input: {
  attested_name: string;
  role: string;
}): Promise<string> {
  return sha256Hex(canonicalAttestBody(input));
}

/**
 * Decide what to do given an existing idempotency record (or the absence of
 * one). Pure function — easy to unit test the branching without hitting a DB.
 */
export type IdempotencyDecision =
  | { kind: "miss" } // no prior record — proceed with the real handler
  | { kind: "replay"; responseData: unknown; statusCode: number } // return cached response
  | { kind: "mismatch" }; // same key, different body — caller should 409

export function decideIdempotency(
  existing: { request_hash: string; response_data: unknown; response_status_code: number } | null,
  incomingHash: string,
): IdempotencyDecision {
  if (!existing) return { kind: "miss" };
  if (existing.request_hash !== incomingHash) return { kind: "mismatch" };
  return {
    kind: "replay",
    responseData: existing.response_data,
    statusCode: existing.response_status_code,
  };
}
