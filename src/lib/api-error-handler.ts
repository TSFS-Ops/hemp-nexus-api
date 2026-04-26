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
 *   catch (error) { handleApiError(error, { errorMessage: "Failed to load matches" }); }
 *
 * Trace IDs:
 *   When the backend returns a request_id (in the JSON envelope or the
 *   `x-request-id` response header), it is appended to the toast as a
 *   description with a one-click "Copy ID" action so the user can include
 *   the exact server-side trace in any support report.
 */

import { toast } from "sonner";
import { isAuthError, isApiError, ApiError } from "@/lib/api-client";
import { captureError } from "@/lib/sentry";

export interface ApiErrorOptions {
  /** Default message when no specific handler matches */
  errorMessage?: string;
  /** If true, suppress the toast entirely (for manual handling) */
  silent?: boolean;
  /**
   * Short label describing the operation that failed (e.g. "POI generation").
   * When a backend trace id is available, it is shown alongside this label
   * so the user knows which action the trace refers to when reporting it.
   */
  traceContext?: string;
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

/** Extract a backend trace id from an error if present. */
export function extractRequestId(error: unknown): string | null {
  if (error instanceof ApiError && error.requestId) return error.requestId;
  if (error && typeof error === "object" && "requestId" in error) {
    const id = (error as { requestId?: unknown }).requestId;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

/** Build the sonner options that append a trace id + Copy button to a toast. */
function withTraceOptions(requestId: string | null, traceContext?: string) {
  if (!requestId) return undefined;
  const label = traceContext ? `${traceContext} trace id` : "Trace id";
  return {
    description: `${label}: ${requestId}`,
    duration: 12_000,
    action: {
      label: "Copy ID",
      onClick: () => {
        try {
          navigator.clipboard?.writeText(requestId);
          toast.success("Trace id copied");
        } catch {
          toast.error("Could not copy trace id");
        }
      },
    },
  };
}

/**
 * Handle an error from an API call with consistent toast messaging.
 */
export function handleApiError(
  error: unknown,
  options: ApiErrorOptions = {}
): void {
  if (options.silent) return;

  const requestId = extractRequestId(error);
  const traceOpts = withTraceOptions(requestId, options.traceContext);

  // Auth errors get a specific message
  if (isAuthError(error)) {
    toast.error("You must be logged in to perform this action.", traceOpts);
    return;
  }

  // R1: surface the role-of-truth invariant trigger as a readable message
  // instead of a raw Postgres "check_violation" string.
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (rawMessage.includes("matches_role_invariant")) {
    toast.error(
      "This trade can't be saved with your organisation on both sides. Please pick a different counterparty.",
      traceOpts,
    );
    return;
  }

  // API errors: use status-specific message or the server's error message
  if (isApiError(error)) {
    const statusMessage = STATUS_MESSAGES[error.status];
    toast.error(statusMessage ?? error.message, traceOpts);
    return;
  }

  // Generic errors - report to Sentry
  if (error instanceof Error) {
    captureError(error, { handler: "handleApiError", fallback: options.errorMessage });
    toast.error(error.message || options.errorMessage || "An unexpected error occurred.", traceOpts);
    return;
  }
  toast.error(options.errorMessage || "An unexpected error occurred.", traceOpts);
}
