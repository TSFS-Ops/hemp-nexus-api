/**
 * Public API V1 · Sand/Prod Batch 7 — Webhook event model, signing,
 * retries and environment guards.
 *
 * Single source of truth for the public-API webhook layer:
 *   - canonical V1 sandbox + production event types;
 *   - forbidden event types (POI/WaD/compliance/payment/verification/
 *     evidence/raw documents are NEVER emitted by V1 webhooks);
 *   - environment match check (sandbox endpoint ↔ sandbox event,
 *     production endpoint ↔ production event — strictly enforced);
 *   - production-enable gate (production endpoints require a passing
 *     sandbox webhook test for the same api_client_id; mirror of the
 *     `api_webhook_endpoint_production_gate` DB trigger);
 *   - HMAC-SHA256 signing with X-Izenzo-Signature / X-Izenzo-Timestamp;
 *   - retry schedule (1 minute, 5 minutes, 30 minutes, then mark
 *     `webhook.delivery_failed`);
 *   - canonical audit event names.
 *
 * V1 webhooks NEVER trigger POI, WaD, compliance, verification or
 * payment actions, and NEVER carry raw documents, internal notes,
 * personal identity documents, bank details, evidence packs, research
 * output or another client's data.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// ─── Event type catalogue ────────────────────────────────────────────────

/** Sandbox-only event types (test events). Never emitted in production. */
export const V1_SANDBOX_WEBHOOK_EVENTS = [
  "lookup.completed",
  "lookup.failed",
  "usage.limit_warning",
  "usage.limit_reached",
  "key.expiring",
  "key.revoked",
  "webhook.test",
] as const;
export type V1SandboxWebhookEvent = typeof V1_SANDBOX_WEBHOOK_EVENTS[number];

/** Production event types. Optional in V1; only emitted to enabled
 *  production endpoints for the matching client. */
export const V1_PRODUCTION_WEBHOOK_EVENTS = [
  "lookup.completed",
  "lookup.failed",
  "usage.limit_80",
  "usage.limit_100",
  "usage.limit_120",
  "billable_overage",
  "key.expiring",
  "key.revoked",
  "incident.notice",
  "webhook.delivery_failed",
] as const;
export type V1ProductionWebhookEvent = typeof V1_PRODUCTION_WEBHOOK_EVENTS[number];

/**
 * Forbidden V1 webhook event types — never emitted, never delivered,
 * never logged as a public-API webhook event. Mirror of the gateway
 * forbidden-scope catalogue; defence-in-depth against accidental
 * cross-surface emission.
 */
export const V1_FORBIDDEN_WEBHOOK_EVENT_PATTERNS: ReadonlyArray<RegExp> = [
  /^poi\./i,
  /^wad\./i,
  /^compliance\./i,
  /^verification\./i,
  /^payment\./i,
  /^evidence\./i,
  /^document\./i,
  /^bank\./i,
  /^governance\./i,
];

export function isForbiddenV1WebhookEvent(evt: string): boolean {
  for (const p of V1_FORBIDDEN_WEBHOOK_EVENT_PATTERNS) {
    if (p.test(evt)) return true;
  }
  return false;
}

// ─── Forbidden payload fields ────────────────────────────────────────────

/**
 * Field names that must never appear in a V1 webhook payload. Used by
 * `assertSafePayload()` to fail loudly before the dispatcher delivers
 * anything sensitive — this is the same posture as
 * counterparty.assertNoForbiddenFields in the lookup surface.
 */
export const V1_FORBIDDEN_WEBHOOK_PAYLOAD_FIELDS: ReadonlyArray<string> = [
  "document",
  "documents",
  "document_url",
  "evidence",
  "evidence_pack",
  "internal_notes",
  "notes_internal",
  "id_document",
  "id_number",
  "passport",
  "passport_number",
  "national_id",
  "bank_account",
  "bank_account_number",
  "bank_details",
  "iban",
  "swift",
  "other_client_data",
  "cross_client",
  "raw_document",
];

export function assertSafePayload(payload: Record<string, unknown>): void {
  const seen = new Set<string>();
  const walk = (obj: unknown, path: string) => {
    if (!obj || typeof obj !== "object") return;
    for (const k of Object.keys(obj as Record<string, unknown>)) {
      const lc = k.toLowerCase();
      if (V1_FORBIDDEN_WEBHOOK_PAYLOAD_FIELDS.includes(lc)) {
        seen.add(`${path}.${k}`);
      }
      walk((obj as Record<string, unknown>)[k], `${path}.${k}`);
    }
  };
  walk(payload, "$");
  if (seen.size > 0) {
    throw new Error(
      `forbidden_webhook_payload_field: ${Array.from(seen).join(", ")}`,
    );
  }
}

// ─── Environment match ──────────────────────────────────────────────────

export type V1WebhookEnvironment = "sandbox" | "production";

/**
 * Hard environment match. A sandbox endpoint may receive ONLY sandbox
 * events, and a production endpoint may receive ONLY production events.
 * Returns the reason code if mismatch — `dispatchV1Webhook` rejects with
 * that code before signing or POSTing anything.
 */
export function classifyEventForEnvironment(
  event: string,
  env: V1WebhookEnvironment,
):
  | { ok: true }
  | { ok: false; reason: "forbidden_event" | "sandbox_event_to_production" | "production_event_to_sandbox" | "unknown_event" } {
  if (isForbiddenV1WebhookEvent(event)) return { ok: false, reason: "forbidden_event" };
  const isSandbox = (V1_SANDBOX_WEBHOOK_EVENTS as readonly string[]).includes(event);
  const isProd = (V1_PRODUCTION_WEBHOOK_EVENTS as readonly string[]).includes(event);
  if (!isSandbox && !isProd) return { ok: false, reason: "unknown_event" };
  if (env === "sandbox") {
    // sandbox endpoints may only receive events from the sandbox catalogue
    if (!isSandbox) return { ok: false, reason: "production_event_to_sandbox" };
  } else {
    if (!isProd) return { ok: false, reason: "sandbox_event_to_production" };
  }
  return { ok: true };
}

// ─── Signing ────────────────────────────────────────────────────────────

/**
 * Canonical V1 webhook signing.
 *
 * Algorithm: HMAC-SHA256 over `${timestamp}.${payload}` using the
 * endpoint's webhook secret. Output is lowercase hex. The raw secret is
 * NEVER logged or returned — only the signature prefix is safe to log.
 *
 * Receivers verify by:
 *   1. recomputing HMAC-SHA256(timestamp + "." + raw_body, secret);
 *   2. comparing to X-Izenzo-Signature in constant time;
 *   3. rejecting if |now − timestamp| > 5 minutes (replay window).
 */
export async function signV1Webhook(
  timestamp: string,
  payload: string,
  secret: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${payload}`));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const V1_WEBHOOK_SIGNATURE_HEADER = "X-Izenzo-Signature";
export const V1_WEBHOOK_TIMESTAMP_HEADER = "X-Izenzo-Timestamp";

// ─── Retry schedule ─────────────────────────────────────────────────────

/**
 * V1 retry schedule (minutes after the previous attempt):
 *   initial → 1m → 5m → 30m → mark `webhook.delivery_failed`.
 *
 * Total attempts: 1 initial + 3 retries = 4. After the 4th failed
 * attempt the dispatcher writes a `webhook.delivery_failed` row and
 * emits the canonical audit event.
 */
export const V1_WEBHOOK_RETRY_SCHEDULE_MINUTES = [1, 5, 30] as const;
export const V1_WEBHOOK_MAX_ATTEMPTS = 1 + V1_WEBHOOK_RETRY_SCHEDULE_MINUTES.length;

export function nextRetryAt(attempt: number, now = new Date()): Date | null {
  // attempt is 1-indexed: attempt=1 is the initial delivery; on failure,
  // schedule attempt=2 at +1m, attempt=3 at +5m, attempt=4 at +30m.
  if (attempt < 1) return null;
  if (attempt > V1_WEBHOOK_RETRY_SCHEDULE_MINUTES.length) return null;
  const minutes = V1_WEBHOOK_RETRY_SCHEDULE_MINUTES[attempt - 1];
  return new Date(now.getTime() + minutes * 60_000);
}

// ─── Payload builders ───────────────────────────────────────────────────

export interface BuildSandboxPayloadInput {
  event_type: V1SandboxWebhookEvent;
  event_id: string;
  client_id: string;
  request_id?: string | null;
  sandbox_case_id?: string | null;
  extras?: Record<string, unknown>;
}

export interface BuildProductionPayloadInput {
  event_type: V1ProductionWebhookEvent;
  event_id: string;
  client_id: string;
  request_id?: string | null;
  endpoint?: string | null;
  status?: string | null;
  error_code?: string | null;
  usage_percent?: number | null;
  affected_endpoint?: string | null;
  extras?: Record<string, unknown>;
}

export function buildSandboxPayload(input: BuildSandboxPayloadInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    environment: "sandbox",
    test_event: true,
    event_id: input.event_id,
    event_type: input.event_type,
    client_id: input.client_id,
    request_id: input.request_id ?? null,
    timestamp: new Date().toISOString(),
  };
  if (input.sandbox_case_id) body.sandbox_case_id = input.sandbox_case_id;
  if (input.extras) Object.assign(body, input.extras);
  assertSafePayload(body);
  return body;
}

export function buildProductionPayload(input: BuildProductionPayloadInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    environment: "production",
    event_id: input.event_id,
    event_type: input.event_type,
    client_id: input.client_id,
    timestamp: new Date().toISOString(),
  };
  if (input.request_id) body.request_id = input.request_id;
  if (input.endpoint) body.endpoint = input.endpoint;
  if (input.status) body.status = input.status;
  if (input.error_code) body.error_code = input.error_code;
  if (typeof input.usage_percent === "number") body.usage_percent = input.usage_percent;
  if (input.affected_endpoint) body.affected_endpoint = input.affected_endpoint;
  if (input.extras) Object.assign(body, input.extras);
  // Production payloads must NEVER carry sandbox markers.
  if ("test_event" in body) delete (body as Record<string, unknown>).test_event;
  if ("sandbox_case_id" in body) delete (body as Record<string, unknown>).sandbox_case_id;
  assertSafePayload(body);
  return body;
}

// ─── Canonical audit names ──────────────────────────────────────────────

export const V1_WEBHOOK_AUDIT_NAMES = [
  "api.webhook.endpoint.created",
  "api.webhook.endpoint.updated",
  "api.webhook.endpoint.enabled",
  "api.webhook.endpoint.disabled",
  "api.webhook.test.sent",
  "api.webhook.delivery.succeeded",
  "api.webhook.delivery.failed",
  "api.webhook.delivery.retry_scheduled",
  "api.webhook.production.enabled",
  "api.webhook.production.blocked_until_sandbox_tested",
] as const;
export type V1WebhookAuditName = typeof V1_WEBHOOK_AUDIT_NAMES[number];

// ─── Production-enable gate (mirror of DB trigger) ───────────────────────

/**
 * Mirror of `api_webhook_endpoint_production_gate` for in-edge-function
 * pre-checks. Returns ok=false if no sandbox endpoint for `api_client_id`
 * has `sandbox_test_passed_at`. The DB trigger is the authoritative
 * server-side enforcer; this helper exists so the dispatcher can return
 * a clean error envelope before hitting the constraint.
 */
export async function assertSandboxTestPassedForClient(
  supabase: SupabaseClient,
  api_client_id: string,
): Promise<{ ok: true } | { ok: false; reason: "sandbox_test_required" }> {
  const { data } = await supabase
    .from("webhook_endpoints")
    .select("id")
    .eq("api_client_id", api_client_id)
    .eq("environment", "sandbox")
    .not("sandbox_test_passed_at", "is", null)
    .limit(1);
  if (!data || data.length === 0) return { ok: false, reason: "sandbox_test_required" };
  return { ok: true };
}

// ─── Dispatcher ─────────────────────────────────────────────────────────

export interface DispatchInput {
  endpoint: {
    id: string;
    url: string;
    environment: V1WebhookEnvironment;
    secret: string;
    api_client_id: string | null;
    org_id: string;
  };
  event_type: string;
  event_id: string;
  client_id: string;
  payload: Record<string, unknown>;
  request_id?: string | null;
}

export interface DispatchResult {
  ok: boolean;
  status_code?: number;
  reason?: string;
  signature_prefix?: string;
}

/**
 * Build the canonical headers for an outbound V1 webhook delivery. Used
 * by both the dispatcher and the test harness so we can prove the same
 * header shape regardless of caller.
 */
export function buildV1WebhookHeaders(
  signature: string,
  timestamp: string,
  event_id: string,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    [V1_WEBHOOK_SIGNATURE_HEADER]: signature,
    [V1_WEBHOOK_TIMESTAMP_HEADER]: timestamp,
    "X-Izenzo-Event-Id": event_id,
    "X-Izenzo-Webhook-Version": "v1",
  };
}
