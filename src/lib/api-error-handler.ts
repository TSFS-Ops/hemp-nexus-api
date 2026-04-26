/**
 * Canonical API error → toast handler.
 *
 * Replaces 60+ scattered catch blocks with inconsistent error messages:
 *   catch (error) {
 *     console.error("...", error);
 *     if (isAuthError(error)) { toast.error("You must be logged in"); }
 *     else if (isApiError(error, 402)) { toast.error("Insufficient credits..."); }
 *     else { toast.error(error.message || "Failed to ..."); }
 *   }
 *
 * Usage:
 *   import { handleApiError } from "@/lib/api-error-handler";
 *   catch (error) { handleApiError(error, { fallback: "Failed to load matches" }); }
 */

import { toast } from "sonner";
import { isAuthError, isApiError } from "@/lib/api-client";
import { captureError } from "@/lib/sentry";

export interface ApiErrorOptions {
  /** Default message when no specific handler matches */
  errorMessage?: string;
  /** If true, suppress the toast entirely (for manual handling) */
  silent?: boolean;
}

/** Well-known HTTP status → user-friendly message */
const STATUS_MESSAGES: Record<number, string> = {
  401: "Session expired. Please sign in again.",
  402: "Insufficient credits. Please purchase credits on the Billing page to continue.",
  403: "You do not have permission to perform this action. This match may belong to a different organisation.",
  404: "The requested resource was not found.",
  409: "A conflict occurred. Please refresh and try again.",
  429: "Too many requests. Please wait a moment and retry.",
};

/**
 * Handle an error from an API call with consistent toast messaging.
 * Returns the error for optional chaining.
 */
export function handleApiError(
  error: unknown,
  options: ApiErrorOptions = {}
): void {
  if (options.silent) return;

  // Auth errors get a specific message
  if (isAuthError(error)) {
    toast.error("You must be logged in to perform this action.");
    return;
  }

  // R1: surface the role-of-truth invariant trigger as a readable message
  // instead of a raw Postgres "check_violation" string. The trigger fires
  // when buyer_org_id == seller_org_id or the creator org is missing from
  // both filled slots.
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (rawMessage.includes("matches_role_invariant")) {
    toast.error(
      "This trade can't be saved with your organisation on both sides. Please pick a different counterparty."
    );
    return;
  }

  // API errors: use status-specific message or the server's error message
  if (isApiError(error)) {
    const statusMessage = STATUS_MESSAGES[error.status];
    toast.error(statusMessage ?? error.message);
    return;
  }

  // Generic errors - report to Sentry
  if (error instanceof Error) {
    captureError(error, { handler: "handleApiError", fallback: options.errorMessage });
    toast.error(error.message || options.errorMessage || "An unexpected error occurred.");
    return;
  }
  toast.error(options.errorMessage || "An unexpected error occurred.");
}
