/**
 * webhook-decision-log — structured, single-line JSON logs for every
 * security decision a webhook makes (signature verification, replay
 * protection, timestamp freshness).
 *
 * Why this exists
 * ───────────────
 * Operators investigating "client says webhook never arrived" need to
 * answer three questions, fast:
 *
 *   1. Did the request reach us at all? (boot/edge logs)
 *   2. Did it pass signature + freshness verification?
 *   3. Was it rejected by replay protection?
 *
 * Free-text `console.warn` messages mix decision data with English prose
 * and aren't reliably queryable in `function_edge_logs`. This helper
 * emits ONE structured line per decision with a stable schema:
 *
 *   {
 *     "evt": "webhook.decision",
 *     "fn": "auth-email-hook",          // edge function name
 *     "phase": "signature" | "replay" | "timestamp",
 *     "decision": "accept" | "reject",
 *     "reason": "ok" | "invalid_signature" | "stale_timestamp" |
 *               "replay_detected" | "missing_signature" |
 *               "guard_unavailable",
 *     "source": "lovable_email",        // optional (replay only)
 *     "signature_prefix": "abc12345",   // first 8 hex chars of SHA-256
 *     "timestamp_age_seconds": 14,      // optional
 *     "request_id": "uuid",             // correlation
 *     "ts": "2026-04-26T19:42:11.412Z"
 *   }
 *
 * Query example (analytics_query):
 *   select event_message from function_edge_logs
 *    where event_message like '%"evt":"webhook.decision"%'
 *      and event_message like '%"decision":"reject"%'
 *    order by timestamp desc
 *    limit 50;
 */

export type WebhookDecisionPhase = "signature" | "replay" | "timestamp";
export type WebhookDecisionOutcome = "accept" | "reject";

export type WebhookDecisionReason =
  | "ok"
  | "invalid_signature"
  | "missing_signature"
  | "stale_timestamp"
  | "missing_timestamp"
  | "invalid_timestamp"
  | "replay_detected"
  | "guard_unavailable"
  | "verification_error";

export interface WebhookDecisionEntry {
  /** The edge function name (e.g. "auth-email-hook"). */
  fn: string;
  /** Which gate produced this decision. */
  phase: WebhookDecisionPhase;
  /** accept = passed gate; reject = blocked. */
  decision: WebhookDecisionOutcome;
  /** Stable machine-readable reason code. */
  reason: WebhookDecisionReason;
  /** Logical webhook source name (e.g. "lovable_email"). */
  source?: string;
  /** First 8 hex chars of the SHA-256 of the signature header. Never the raw signature. */
  signaturePrefix?: string;
  /** Age (seconds) of the request timestamp, when available. */
  timestampAgeSeconds?: number;
  /** Correlation id (the function's own requestId, if it has one). */
  requestId?: string | null;
  /** Optional free-form metadata for ops (kept small, never secrets). */
  meta?: Record<string, unknown>;
}

/**
 * Emit a single JSON line on the appropriate console channel.
 * Rejections go to console.warn so they're visually distinct in the
 * function logs UI; acceptances go to console.info.
 */
export function logWebhookDecision(entry: WebhookDecisionEntry): void {
  const payload = {
    evt: "webhook.decision",
    fn: entry.fn,
    phase: entry.phase,
    decision: entry.decision,
    reason: entry.reason,
    ...(entry.source ? { source: entry.source } : {}),
    ...(entry.signaturePrefix ? { signature_prefix: entry.signaturePrefix } : {}),
    ...(typeof entry.timestampAgeSeconds === "number"
      ? { timestamp_age_seconds: Math.round(entry.timestampAgeSeconds) }
      : {}),
    ...(entry.requestId ? { request_id: entry.requestId } : {}),
    ...(entry.meta ? { meta: entry.meta } : {}),
    ts: new Date().toISOString(),
  };
  const line = JSON.stringify(payload);
  if (entry.decision === "reject") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

/**
 * Compute the same 8-char SHA-256 signature prefix used elsewhere so
 * decisions across phases (signature → replay) can be correlated.
 * Returns an empty string if the input is empty/undefined.
 */
export async function signaturePrefix(signature: string | null | undefined): Promise<string> {
  if (!signature) return "";
  const data = new TextEncoder().encode(signature);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
