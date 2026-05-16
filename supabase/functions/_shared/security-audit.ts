/**
 * Batch N — central writer for API key / webhook security audit events.
 *
 * Misuse events are best-effort, fire-and-forget. We never block the
 * 401/403/429 response on the audit write; the caller has already decided
 * to reject. We never include the plaintext API key or webhook secret —
 * only a safe prefix where useful.
 *
 * Allowed actions (kept in sync with the test contract):
 *   api_key.revoked_use_attempt
 *   api_key.expired_use_attempt
 *   api_key.scope_denied
 *   api_key.ip_blocked
 *   api_key.origin_blocked
 *   api_key.rate_limited
 *   webhook.rate_limited
 *   webhook.signature_failure
 */
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export interface SecurityAuditInput {
  action:
    | "api_key.revoked_use_attempt"
    | "api_key.expired_use_attempt"
    | "api_key.scope_denied"
    | "api_key.ip_blocked"
    | "api_key.origin_blocked"
    | "api_key.rate_limited"
    | "webhook.rate_limited"
    | "webhook.signature_failure";
  orgId?: string | null;
  apiKeyId?: string | null;
  webhookEndpointId?: string | null;
  actorIp?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  endpoint?: string | null;
  extra?: Record<string, unknown>;
}

function getServiceClient(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Best-effort audit write. Never throws — failures are logged only.
 * Actor IP and user-agent are persisted under metadata to avoid a
 * schema migration on audit_logs.
 */
export async function writeSecurityAudit(
  input: SecurityAuditInput,
  supabase?: SupabaseClient,
): Promise<void> {
  try {
    const client = supabase ?? getServiceClient();
    if (!client) return;
    const entityType = input.webhookEndpointId
      ? "webhook"
      : input.apiKeyId
      ? "api_key"
      : "security";
    const entityId = input.webhookEndpointId ?? input.apiKeyId ?? null;
    await client.from("audit_logs").insert({
      org_id: input.orgId ?? null,
      actor_user_id: null,
      actor_api_key_id: input.apiKeyId ?? null,
      action: input.action,
      entity_type: entityType,
      entity_id: entityId,
      metadata: {
        actor_ip: input.actorIp ?? null,
        user_agent: input.userAgent ?? null,
        request_id: input.requestId ?? null,
        endpoint: input.endpoint ?? null,
        ...(input.extra ?? {}),
      },
    });
  } catch (e) {
    console.error("[security-audit] failed to write audit:", e);
  }
}

/** Extract the best-effort client IP from a Request. Mirrors auth.ts. */
export function extractClientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return null;
}

/** Extract the User-Agent header (truncated to 500 chars to bound logs). */
export function extractUserAgent(req: Request): string | null {
  const ua = req.headers.get("user-agent");
  if (!ua) return null;
  return ua.slice(0, 500);
}
