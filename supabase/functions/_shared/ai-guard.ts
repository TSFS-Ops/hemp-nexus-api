/**
 * Batch F — AI Gateway guard.
 *
 * Single chokepoint for every outbound call to the Lovable AI Gateway.
 *
 * Responsibilities:
 *   1. Bounded timeout (10s default) so the function never hangs.
 *   2. Per-org cooldown read from `ai_provider_state` — refuse to hit the
 *      gateway while the cooldown window is active. Returns the typed
 *      result so the caller can persist a "quota/cooldown" state rather
 *      than retry.
 *   3. Per-org daily call meter (`ai_call_meter`) with hard ceiling.
 *      Returns `QUOTA_EXCEEDED` once tripped — no outbound call made.
 *   4. On 429 from the gateway, parse `Retry-After` and stamp the
 *      cooldown atomically.
 *   5. All other failures (timeout, 5xx, malformed) surface as
 *      `PROVIDER_ERROR` with the upstream status code preserved.
 *
 * The shared guard is intentionally narrow: callers still own the
 * request/response shape (model, messages, tool calls). The guard only
 * controls *whether* we may hit the network and what to do with the
 * outcome.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { fetchWithTimeout, ProviderTimeoutError, DEFAULT_PROVIDER_TIMEOUT_MS } from "./fetch-with-timeout.ts";

const AI_GATEWAY_BASE = "https://ai.gateway.lovable.dev/v1";
const AI_PROVIDER_KEY = "lovable_ai_gateway";

/** Sensible default cap per org/call-type/day. Adjust if a product number lands later. */
export const DEFAULT_DAILY_CAP_BY_CALL_TYPE: Record<string, number> = {
  counterparty_intel: 200,
  intel_crawl: 100,
  web_search: 200,
  draft_poi: 50,
  _default: 200,
};

export type AiGuardOutcome =
  | { kind: "ok"; body: unknown; status: 200 }
  | { kind: "quota_exceeded"; reason: "daily_cap"; cap: number; retryAfterSeconds: number }
  | { kind: "cooldown"; cooldownUntil: string; retryAfterSeconds: number }
  | { kind: "provider_error"; statusCode: number | null; message: string }
  | { kind: "not_configured" };

export interface CallOptions {
  org_id: string;
  call_type: keyof typeof DEFAULT_DAILY_CAP_BY_CALL_TYPE | string;
  endpoint?: string; // defaults to /chat/completions
  body: unknown;
  timeoutMs?: number;
  /** Override the default daily cap for this call_type. */
  dailyCap?: number;
}

function getApiKey(): string | null {
  return Deno.env.get("LOVABLE_API_KEY") ?? null;
}

/**
 * Check cooldown via the SECURITY DEFINER helper. Returns the cooldown
 * timestamp (UTC ISO string) when active, otherwise null.
 */
export async function readCooldown(admin: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await admin.rpc("ai_provider_in_cooldown", {
    p_org_id: orgId,
    p_provider: AI_PROVIDER_KEY,
  });
  if (error) {
    console.warn("[ai-guard] cooldown read failed", error);
    return null;
  }
  return (data as string | null) ?? null;
}

async function stampCooldown(
  admin: SupabaseClient,
  orgId: string,
  retryAfterSeconds: number,
  statusCode: number,
  status: string,
  message: string,
): Promise<string> {
  const cooldownUntil = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
  const { error } = await admin
    .from("ai_provider_state")
    .upsert(
      {
        org_id: orgId,
        provider: AI_PROVIDER_KEY,
        cooldown_until: cooldownUntil,
        last_status: status,
        last_status_code: statusCode,
        last_error: message.slice(0, 500),
        retry_after_seconds: retryAfterSeconds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,provider" },
    );
  if (error) console.warn("[ai-guard] cooldown upsert failed", error);
  return cooldownUntil;
}

function parseRetryAfter(headers: Headers): number {
  const raw = headers.get("retry-after");
  if (!raw) return 60;
  const asInt = parseInt(raw, 10);
  if (!Number.isNaN(asInt) && asInt > 0) return Math.min(asInt, 3600);
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    return Math.max(1, Math.min(3600, Math.ceil((asDate - Date.now()) / 1000)));
  }
  return 60;
}

/**
 * Single entry point. Performs all guard checks, then runs the request.
 * Returns a typed outcome; never throws on provider failure.
 */
export async function guardedAiCall(
  admin: SupabaseClient,
  opts: CallOptions,
): Promise<AiGuardOutcome> {
  const apiKey = getApiKey();
  if (!apiKey) return { kind: "not_configured" };

  // 1. Cooldown gate
  const cooldownUntil = await readCooldown(admin, opts.org_id);
  if (cooldownUntil) {
    const retryAfterSeconds = Math.max(1, Math.ceil((new Date(cooldownUntil).getTime() - Date.now()) / 1000));
    return { kind: "cooldown", cooldownUntil, retryAfterSeconds };
  }

  // 2. Daily meter
  const cap = opts.dailyCap ?? DEFAULT_DAILY_CAP_BY_CALL_TYPE[opts.call_type] ?? DEFAULT_DAILY_CAP_BY_CALL_TYPE._default;
  const { data: meterResult, error: meterError } = await admin.rpc("ai_meter_check_and_increment", {
    p_org_id: opts.org_id,
    p_call_type: String(opts.call_type),
    p_daily_cap: cap,
  });
  if (meterError) {
    console.warn("[ai-guard] meter check failed; failing open to avoid blocking ops", meterError);
  } else if (typeof meterResult === "number" && meterResult === -1) {
    // Cap reached — also stamp a 1-hour cooldown so a refresh storm cannot
    // re-roll the cap repeatedly.
    await stampCooldown(admin, opts.org_id, 3600, 429, "quota_exceeded", `daily cap ${cap} reached`);
    return { kind: "quota_exceeded", reason: "daily_cap", cap, retryAfterSeconds: 3600 };
  }

  // 3. Real call
  const endpoint = opts.endpoint ?? "/chat/completions";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      "lovable_ai_gateway",
      `${AI_GATEWAY_BASE}${endpoint}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(opts.body),
      },
      timeoutMs,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ProviderTimeoutError) {
      // Treat timeout as transient provider degradation — short cooldown.
      await stampCooldown(admin, opts.org_id, 60, 504, "timeout", message);
    } else {
      await stampCooldown(admin, opts.org_id, 60, 0, "network_error", message);
    }
    return { kind: "provider_error", statusCode: err instanceof ProviderTimeoutError ? 504 : null, message };
  }

  if (resp.status === 429) {
    const retryAfterSeconds = parseRetryAfter(resp.headers);
    const cooldown = await stampCooldown(admin, opts.org_id, retryAfterSeconds, 429, "rate_limited", await resp.text().catch(() => ""));
    return { kind: "cooldown", cooldownUntil: cooldown, retryAfterSeconds };
  }

  if (resp.status >= 500) {
    const text = await resp.text().catch(() => "");
    await stampCooldown(admin, opts.org_id, 60, resp.status, "server_error", text);
    return { kind: "provider_error", statusCode: resp.status, message: text.slice(0, 500) };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { kind: "provider_error", statusCode: resp.status, message: text.slice(0, 500) };
  }

  let body: unknown;
  try {
    body = await resp.json();
  } catch (err) {
    return { kind: "provider_error", statusCode: resp.status, message: `malformed_response: ${(err as Error).message}` };
  }
  return { kind: "ok", body, status: 200 };
}

/** Typed error envelope helpers for HTTP responders. */
export function aiGuardEnvelope(o: AiGuardOutcome) {
  switch (o.kind) {
    case "cooldown":
      return {
        status: 429,
        body: {
          error: "AI_PROVIDER_COOLDOWN",
          message: "AI provider is on cooldown for this organization.",
          cooldown_until: o.cooldownUntil,
          retry_after_seconds: o.retryAfterSeconds,
        },
      };
    case "quota_exceeded":
      return {
        status: 429,
        body: {
          error: "QUOTA_EXCEEDED",
          message: `Daily AI call cap (${o.cap}) reached for this organization.`,
          retry_after_seconds: o.retryAfterSeconds,
        },
      };
    case "provider_error":
      return {
        status: 502,
        body: {
          error: "AI_PROVIDER_ERROR",
          message: o.message,
          upstream_status: o.statusCode,
        },
      };
    case "not_configured":
      return {
        status: 503,
        body: {
          error: "AI_NOT_CONFIGURED",
          message: "AI provider is not configured on this environment.",
        },
      };
    case "ok":
      return { status: 200, body: o.body };
  }
}
