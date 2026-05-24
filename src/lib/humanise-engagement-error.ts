/**
 * humaniseEngagementError — translate opaque server error strings from the
 * `poi-engagements` PATCH endpoint (and the `atomic_engagement_transition`
 * RPC underneath it) into a plain-English admin-friendly explanation.
 *
 * Why this exists
 * ───────────────
 * The backend returns precise machine codes (`invalid_target_status:pending`,
 * `INVALID_TRANSITION`, `VALIDATION_ERROR`, `NOT_FOUND`, …). They are correct
 * for logs and tooling but unhelpful to the admin staring at the
 * AddContactDialog. This helper maps known patterns to short, action-oriented
 * sentences while preserving the raw code in a `technical` field for the
 * inline diagnostics block, so we never hide what actually happened.
 *
 * Pure, side-effect-free. Safe to import from any UI component.
 */

export interface HumanisedEngagementError {
  /** Short admin-readable headline. Always present. */
  headline: string;
  /** Optional next-step hint (one sentence). */
  hint?: string;
  /** Original server message / code, kept verbatim for the diagnostics row. */
  technical: string;
  /**
   * Backend-issued request/trace id (if the server returned one in the error
   * payload or response headers). Surfaced in the UI so admins can copy it
   * straight into a support ticket or log query.
   */
  requestId?: string;
}

const FALLBACK_HEADLINE = "Could not save contact details.";

/**
 * Order matters — we test for the most specific patterns first, then fall
 * back to broader server codes, then to the raw message, then to a neutral
 * default.
 */
export function humaniseEngagementError(input: unknown): HumanisedEngagementError {
  const raw = extractRawMessage(input);
  const requestId = extractRequestId(input);
  const withRid = <T extends HumanisedEngagementError>(e: T): T =>
    requestId ? { ...e, requestId } : e;

  // ── 0. D2a email-change-after-outreach refusal ──
  // The engagements PATCH refuses counterparty_email edits once outreach
  // logs exist; the only safe path is the cancel-for-email-change endpoint
  // followed by a replacement engagement.
  if (/EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE/i.test(raw)) {
    return withRid({
      headline:
        "Counterparty email cannot be edited silently after a Pending Engagement has been created. The existing engagement will be cancelled and a new engagement must be created with the corrected email. The original record will remain in the audit trail.",
      hint:
        "Use \"Cancel for email change\" on this engagement and create a replacement engagement with the corrected email. The original engagement remains in the audit trail.",
      technical: raw,
    });
  }

  // ── 1. Known transition rejections from atomic_engagement_transition ──
  // The RPC returns strings of the form `invalid_target_status:<status>`.
  const targetMatch = raw.match(/invalid_target_status:([a-z_]+)/i);
  if (targetMatch) {
    return withRid({
      headline:
        "We couldn't save the contact details because the engagement is in an unexpected state.",
      hint:
        "Refresh the page to pick up the latest engagement status, then try again. If it keeps happening, the engagement may need an admin to reset its state.",
      technical: raw,
    });
  }

  // ── 2. Application-layer transition guard (handler-level, not RPC) ──
  if (/INVALID_TRANSITION/i.test(raw)) {
    return withRid({
      headline:
        "That status change isn't allowed from where the engagement is right now.",
      hint:
        "Refresh the row to see the current status. If you only meant to update the email or notes, reopen Add contact and save again — no status change is needed.",
      technical: raw,
    });
  }

  // ── 3. Schema/validation rejections from Zod on the edge function ──
  if (/VALIDATION_ERROR|invalid email|email.*invalid|too short|too long|254 characters/i.test(raw)) {
    return withRid({
      headline: "The address or notes failed validation on the server.",
      hint:
        "Check the email is well-formed and under 254 characters, and that any notes are under 2,000 characters.",
      technical: raw,
    });
  }

  // ── 4. Idempotency replay collisions ──
  if (/Idempotency-Key|idempotency/i.test(raw)) {
    return withRid({
      headline:
        "This save was already submitted moments ago and the platform is preventing a duplicate.",
      hint: "Refresh the row to see whether the previous save went through.",
      technical: raw,
    });
  }

  // ── 5. Engagement no longer exists / wrong id ──
  if (/NOT_FOUND|engagement_not_found|not found/i.test(raw)) {
    return withRid({
      headline: "The engagement could not be found.",
      hint:
        "It may have been deleted or replaced. Close this dialog and reopen the engagement from the list.",
      technical: raw,
    });
  }

  // ── 6. Auth / RLS / permission failures ──
  if (/forbidden|unauthor|permission|RLS|not allowed/i.test(raw)) {
    return withRid({
      headline: "You don't have permission to save changes on this engagement.",
      hint:
        "If you should have access, sign out and back in to refresh your session, or ask a platform admin to check your role.",
      technical: raw,
    });
  }

  // ── 7. Maintenance / service paused ──
  if (/maintenance|service.*paused|temporarily unavailable/i.test(raw)) {
    return withRid({
      headline: "The engagements service is temporarily paused for maintenance.",
      hint: "Try again in a few minutes.",
      technical: raw,
    });
  }

  // ── 8. Network / transport / generic 5xx ──
  if (/non-2xx|5\d\d|network|fetch failed|TypeError/i.test(raw)) {
    return withRid({
      headline: "The platform did not respond cleanly to the save request.",
      hint:
        "Check your connection and try again. If it keeps failing, the backend may be having a brief incident.",
      technical: raw || "non-2xx response",
    });
  }

  // ── 9. Anything else: surface the server's own message verbatim ──
  if (raw && raw.trim().length > 0) {
    return withRid({ headline: FALLBACK_HEADLINE, hint: raw, technical: raw });
  }

  return withRid({ headline: FALLBACK_HEADLINE, technical: "no server message" });
}

/**
 * Best-effort extraction of a backend trace/request id. Looks at the standard
 * places our edge functions and supabase-js attach it: the parsed JSON body
 * (`request_id` / `requestId` / `trace_id`), and the `context.headers` of a
 * FunctionsHttpError (`x-request-id`, `sb-request-id`, `x-trace-id`).
 */
function extractRequestId(err: unknown): string | undefined {
  if (!err || typeof err === "string") return undefined;
  const anyErr = err as Record<string, any>;
  const fromBody =
    anyErr?.context?.bodyJson?.request_id ??
    anyErr?.context?.bodyJson?.requestId ??
    anyErr?.context?.bodyJson?.trace_id ??
    anyErr?.context?.body?.request_id ??
    anyErr?.context?.body?.requestId ??
    anyErr?.request_id ??
    anyErr?.requestId ??
    anyErr?.trace_id;
  if (typeof fromBody === "string" && fromBody.length > 0) return fromBody;
  const headers = anyErr?.context?.headers;
  if (headers && typeof headers === "object") {
    const get = (k: string) =>
      typeof headers.get === "function" ? headers.get(k) : (headers as any)[k];
    const h =
      get("x-request-id") || get("sb-request-id") || get("x-trace-id");
    if (typeof h === "string" && h.length > 0) return h;
  }
  return undefined;
}

/**
 * Best-effort extraction of a usable string from the various error shapes the
 * supabase-js v2 functions client throws. Never throws — falls back to "".
 */
function extractRawMessage(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    // Some FunctionsHttpError payloads attach the body to .context already.
    const ctx = (err as any).context;
    const ctxJson = ctx?.bodyJson?.message ?? ctx?.body?.message;
    if (typeof ctxJson === "string" && ctxJson.length > 0) return ctxJson;
    return err.message ?? "";
  }
  if (typeof err === "object") {
    const anyErr = err as Record<string, any>;
    if (typeof anyErr.message === "string") return anyErr.message;
    if (typeof anyErr.error === "string") return anyErr.error;
    try {
      return JSON.stringify(anyErr);
    } catch {
      return "";
    }
  }
  return String(err);
}
