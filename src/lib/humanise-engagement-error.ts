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
}

const FALLBACK_HEADLINE = "Could not save contact details.";

/**
 * Order matters — we test for the most specific patterns first, then fall
 * back to broader server codes, then to the raw message, then to a neutral
 * default.
 */
export function humaniseEngagementError(input: unknown): HumanisedEngagementError {
  const raw = extractRawMessage(input);

  // ── 1. Known transition rejections from atomic_engagement_transition ──
  // The RPC returns strings of the form `invalid_target_status:<status>`.
  const targetMatch = raw.match(/invalid_target_status:([a-z_]+)/i);
  if (targetMatch) {
    return {
      headline:
        "We couldn't save the contact details because the engagement is in an unexpected state.",
      hint:
        "Refresh the page to pick up the latest engagement status, then try again. If it keeps happening, the engagement may need an admin to reset its state.",
      technical: raw,
    };
  }

  // ── 2. Application-layer transition guard (handler-level, not RPC) ──
  if (/INVALID_TRANSITION/i.test(raw)) {
    return {
      headline:
        "That status change isn't allowed from where the engagement is right now.",
      hint:
        "Refresh the row to see the current status. If you only meant to update the email or notes, reopen Add contact and save again — no status change is needed.",
      technical: raw,
    };
  }

  // ── 3. Schema/validation rejections from Zod on the edge function ──
  if (/VALIDATION_ERROR|invalid email|email.*invalid|too short|too long|254 characters/i.test(raw)) {
    return {
      headline: "The address or notes failed validation on the server.",
      hint:
        "Check the email is well-formed and under 254 characters, and that any notes are under 2,000 characters.",
      technical: raw,
    };
  }

  // ── 4. Idempotency replay collisions ──
  if (/Idempotency-Key|idempotency/i.test(raw)) {
    return {
      headline:
        "This save was already submitted moments ago and the platform is preventing a duplicate.",
      hint: "Refresh the row to see whether the previous save went through.",
      technical: raw,
    };
  }

  // ── 5. Engagement no longer exists / wrong id ──
  if (/NOT_FOUND|engagement_not_found|not found/i.test(raw)) {
    return {
      headline: "The engagement could not be found.",
      hint:
        "It may have been deleted or replaced. Close this dialog and reopen the engagement from the list.",
      technical: raw,
    };
  }

  // ── 6. Auth / RLS / permission failures ──
  if (/forbidden|unauthor|permission|RLS|not allowed/i.test(raw)) {
    return {
      headline: "You don't have permission to save changes on this engagement.",
      hint:
        "If you should have access, sign out and back in to refresh your session, or ask a platform admin to check your role.",
      technical: raw,
    };
  }

  // ── 7. Maintenance / service paused ──
  if (/maintenance|service.*paused|temporarily unavailable/i.test(raw)) {
    return {
      headline: "The engagements service is temporarily paused for maintenance.",
      hint: "Try again in a few minutes.",
      technical: raw,
    };
  }

  // ── 8. Network / transport / generic 5xx ──
  if (/non-2xx|5\d\d|network|fetch failed|TypeError/i.test(raw)) {
    return {
      headline: "The platform did not respond cleanly to the save request.",
      hint:
        "Check your connection and try again. If it keeps failing, the backend may be having a brief incident.",
      technical: raw || "non-2xx response",
    };
  }

  // ── 9. Anything else: surface the server's own message verbatim ──
  if (raw && raw.trim().length > 0) {
    return { headline: FALLBACK_HEADLINE, hint: raw, technical: raw };
  }

  return { headline: FALLBACK_HEADLINE, technical: "no server message" };
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
