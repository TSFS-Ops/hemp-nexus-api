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
  functionName: string | null;
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
  let requestId: string | null = null;
  let functionName: string | null = null;
  let body: { code?: string; error?: string; message?: string; details?: unknown; request_id?: string; requestId?: string } | null = null;

  const ctx = (error as { context?: Response | { status?: number; url?: string; headers?: Headers; json?: () => Promise<unknown> } })?.context;
  if (ctx && typeof ctx === "object") {
    if ("status" in ctx && typeof (ctx as { status?: number }).status === "number") {
      status = (ctx as { status: number }).status;
    }
    const url = (ctx as { url?: string }).url;
    if (typeof url === "string") {
      // Supabase function URLs look like: https://<ref>.supabase.co/functions/v1/<name>[?...]
      const m = url.match(/\/functions\/v1\/([^/?#]+)/);
      if (m) functionName = m[1];
    }
    const hdrs = (ctx as { headers?: Headers }).headers;
    if (hdrs && typeof hdrs.get === "function") {
      requestId =
        hdrs.get("x-request-id") ||
        hdrs.get("x-supabase-request-id") ||
        hdrs.get("sb-request-id") ||
        hdrs.get("cf-ray") ||
        null;
    }
    try {
      const r = ctx as Response;
      const reader = typeof r.clone === "function" ? r.clone() : r;
      if (typeof (reader as Response).json === "function") {
        body = (await (reader as Response).json()) as typeof body;
      }
    } catch {
      // ignore parse errors - fall through to message
    }
  }

  if (!requestId && body) {
    requestId = body.request_id ?? body.requestId ?? null;
  }

  const code = body?.code ?? null;
  const friendly = code && FRIENDLY[code];
  const fallback =
    body?.message ||
    body?.error ||
    (error instanceof Error ? error.message : "Unexpected error");
  const message = friendly ?? fallback;

  return { status, code, message, requestId, functionName, details: body?.details };
}


