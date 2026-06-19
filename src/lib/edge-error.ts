/**
 * Extracts a structured error body from `supabase.functions.invoke()` errors.
 *
 * The Supabase JS SDK wraps non-2xx edge-function responses in a
 * `FunctionsHttpError` whose `.message` is always the unhelpful string
 * "Edge Function returned a non-2xx status code". The real JSON body
 * (with `code`, `error`, `message`, `details`) lives on `error.context`
 * which is a `Response` instance.
 *
 * Without this helper, MFA_REQUIRED / NOT_PLATFORM_ADMIN / validation
 * failures surface to users as the generic non-2xx string, which Daniel
 * reported as "nothing happens" during UAT.
 */
export interface ParsedEdgeError {
  status: number | null;
  code: string | null;
  message: string;
  requestId: string | null;
  details?: unknown;
}


const FRIENDLY: Record<string, string> = {
  MFA_REQUIRED:
    "Multi-factor authentication is required. Enrol an authenticator and sign in again to perform this action.",
  NOT_PLATFORM_ADMIN: "You must be signed in as a platform administrator.",
  REASON_REQUIRED: "A reason of at least 20 characters is required.",
  INVALID_BODY: "The submitted form is invalid. Please check the fields and try again.",
  REFUND_ALREADY_PENDING: "A refund request is already pending for this purchase.",
  PURCHASE_NOT_FOUND: "Purchase not found.",
  NO_ORG: "Your account is not linked to an organisation.",
  BILLING_HOLD_ACTIVE: "Your organisation has an active billing hold. Contact support.",
  BLOCKED_CREDITS_USED:
    "Credits from this purchase have already been used, so a refund cannot be requested.",
  BLOCKED_EXPIRED:
    "This purchase is outside the refund window and cannot be refunded.",
  LEGAL_HOLD_ALREADY_ACTIVE:
    "An active legal hold already exists for this scope.",
};

export async function parseEdgeError(error: unknown): Promise<ParsedEdgeError> {
  let status: number | null = null;
  let body: { code?: string; error?: string; message?: string; details?: unknown } | null = null;

  const ctx = (error as { context?: Response | { status?: number; json?: () => Promise<unknown> } })?.context;
  if (ctx && typeof ctx === "object") {
    if ("status" in ctx && typeof (ctx as { status?: number }).status === "number") {
      status = (ctx as { status: number }).status;
    }
    try {
      // Response can only be read once; clone if available.
      const r = ctx as Response;
      const reader = typeof r.clone === "function" ? r.clone() : r;
      if (typeof (reader as Response).json === "function") {
        body = (await (reader as Response).json()) as typeof body;
      }
    } catch {
      // ignore parse errors - fall through to message
    }
  }

  const code = body?.code ?? null;
  const friendly = code && FRIENDLY[code];
  const fallback =
    body?.message ||
    body?.error ||
    (error instanceof Error ? error.message : "Unexpected error");
  const message = friendly ?? fallback;

  return { status, code, message, details: body?.details };
}
