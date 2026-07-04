/**
 * Batch V-UI-Fix — Extract an IDV blocker from a caught error.
 *
 * The backend returns HTTP 409 with a JSON body containing
 * `blocker_code: "IDV_..."` when a controlled action is blocked because
 * identity verification is unresolved. Callers throw ApiError (see
 * @/lib/api-client) whose `.status` and `.details` / `.code` carry the
 * blocker envelope. This helper isolates that shape so no page has to
 * introspect ApiError itself.
 *
 * Returns null when the error is not an IDV blocker. Never returns raw
 * provider payloads, stack traces, or private IDV data.
 */

import { ApiError } from "@/lib/api-client";

export interface IdvBlockerFromError {
  blocker_code: string;
  user_message: string | null;
}

function normaliseBlocker(
  code: unknown,
  message: unknown,
): IdvBlockerFromError | null {
  if (typeof code !== "string") return null;
  if (!code.startsWith("IDV_")) return null;
  return {
    blocker_code: code,
    user_message: typeof message === "string" ? message : null,
  };
}

/**
 * Inspect an unknown error. If it represents an IDV controlled-action
 * block (HTTP 409 + `blocker_code: IDV_...`), return the safe blocker
 * envelope. Otherwise return null.
 */
export function extractIdvBlockerFromError(
  err: unknown,
): IdvBlockerFromError | null {
  if (err instanceof ApiError) {
    if (err.status !== 409) return null;
    const details = (err.details ?? {}) as Record<string, unknown>;
    // Prefer top-level details.blocker_code, fall back to ApiError.code.
    const blocker =
      normaliseBlocker(details.blocker_code, details.user_message) ??
      normaliseBlocker(err.code, err.message);
    return blocker;
  }
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    if (rec.status !== 409) return null;
    return normaliseBlocker(rec.blocker_code, rec.user_message);
  }
  return null;
}
