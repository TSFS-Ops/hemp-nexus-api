/**
 * Centralized API client for Edge Function calls.
 *
 * Replaces the scattered pattern of:
 *   const { data: { session } } = await supabase.auth.getSession();
 *   if (!session) { toast.error("..."); return; }
 *   const res = await fetch(`${VITE_SUPABASE_URL}/functions/v1/...`, {
 *     headers: { Authorization: `Bearer ${session.access_token}` },
 *   });
 *   const json = await res.json();
 *   if (!res.ok) throw ...;
 *
 * Usage:
 *   import { apiFetch, AuthRequiredError } from "@/lib/api-client";
 *   const data = await apiFetch<MyType>("match/123/settle", { method: "POST" });
 */

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/** Thrown when no active session exists. UI layers can catch this specifically. */
export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required. Please sign in.");
    this.name = "AuthRequiredError";
  }
}

/** Thrown when the Edge Function returns a non-2xx response. */
export class ApiError extends Error {
  status: number;
  code: string | null;
  requestId: string | null;
  details: Record<string, unknown> | null;

  constructor(
    status: number,
    message: string,
    code?: string,
    requestId?: string,
    details?: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code ?? null;
    this.requestId = requestId ?? null;
    this.details = details ?? null;
  }

  /**
   * Parse the standard { error, code, request_id, details } envelope returned by
   * the shared `errorResponse` helper in Edge Functions.
   */
  static async fromResponse(res: Response): Promise<ApiError> {
    let message = res.statusText || `Request failed (${res.status})`;
    let code: string | undefined;
    let requestId: string | undefined;
    let details: Record<string, unknown> | null = null;

    // Prefer the response header so we still surface a trace id even when the
    // body is empty / not JSON (e.g. gateway 5xx, CORS preflight failure).
    requestId =
      res.headers.get("x-request-id") ||
      res.headers.get("sb-request-id") ||
      res.headers.get("x-correlation-id") ||
      undefined;

    try {
      const body = await res.json();
      // Handle nested envelope: { error: { code, message } } (governance-docs style)
      if (body.error && typeof body.error === 'object') {
        message = body.error.message || body.error.code || JSON.stringify(body.error);
        code = body.error.code;
      } else if (body.error && typeof body.error === 'string') {
        message = body.error;
      }
      if (body.message) message = body.message;
      if (body.code) code = body.code;
      if (body.details && typeof body.details === 'object') details = body.details;
      // Body envelope wins over the header when both are present.
      requestId = body.request_id || body.requestId || body.correlation_id || requestId;
    } catch {
      // body wasn't JSON, fall back to the header-derived requestId (if any).
    }

    return new ApiError(res.status, message, code, requestId, details);
  }
}

/**
 * Generate a unique idempotency key for a given action.
 * Combines a prefix with a crypto-random UUID so every user click
 * produces a key that is unique but also human-debuggable.
 */
export function generateIdempotencyKey(prefix = "ik"): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export interface ApiFetchOptions extends RequestInit {
  /** When set, sent as the Idempotency-Key header. */
  idempotencyKey?: string;
}

/**
 * Fetch an Edge Function with automatic session injection and error parsing.
 *
 * @param path  - Function path (e.g. "match/123/settle")
 * @param init  - Standard RequestInit overrides + optional idempotencyKey
 * @returns Parsed JSON response body of type T
 * @throws AuthRequiredError if no session exists
 * @throws ApiError if response is non-2xx
 */
export async function apiFetch<T = unknown>(
  path: string,
  init?: ApiFetchOptions
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new AuthRequiredError();

  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  const url = `${baseUrl}/functions/v1/${path}`;

  const { idempotencyKey, headers: initHeaders, signal: externalSignal, ...restInit } = init ?? {};

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
    ...(initHeaders as Record<string, string> ?? {}),
  };

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  // 15-second timeout guard - prevents indefinite hangs on slow/dead networks
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  // If caller provided a signal, forward abort to our controller
  if (externalSignal) {
    externalSignal.addEventListener("abort", () => controller.abort());
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...restInit,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(0, "Request timed out. Please check your connection and try again.", "TIMEOUT");
    }
    throw new ApiError(0, "Network error. Please check your connection and try again.", "NETWORK_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    // Global 401 handler - but ONLY treat the session as truly dead after a
    // server-side `auth.getUser()` round-trip confirms the JWT is invalid.
    // Some edge functions return 401 for resource-specific reasons (e.g. an
    // RLS path that hasn't been authorised yet) while the browser session is
    // still perfectly valid; previously this signed the user out mid-flow
    // - the "paperclip" forced-sign-out pattern. See edge-invoke.ts for the
    // sibling guard that protects `supabase.functions.invoke()` callers.
    if (res.status === 401) {
      let sessionConfirmedDead = false;
      try {
        const { data, error } = await supabase.auth.getUser();
        sessionConfirmedDead = !!error || !data?.user;
      } catch {
        // Network error verifying - be conservative and assume dead so the
        // user can re-auth rather than loop on 401s.
        sessionConfirmedDead = true;
      }

      if (sessionConfirmedDead) {
        // Dispatch session-expiry event so useDraftPersistence hooks can emergency-save
        window.dispatchEvent(new CustomEvent("izenzo:session-expiry"));

        const currentPath = window.location.pathname + window.location.search;
        const returnTo = encodeURIComponent(currentPath);

        toast.error("Your session has expired. Redirecting to sign in…", {
          description: "Form fields you were editing have been saved to this browser. You may need to re-select any attached files after signing back in.",
          duration: Infinity,
        });

        // Match AuthContext's 4-second delay so user can read the toast
        setTimeout(() => {
          window.location.href = `/auth?returnTo=${returnTo}`;
        }, 4000);

        // Throw so calling code stops execution immediately
        throw new AuthRequiredError();
      }
      // Session is still valid - surface the 401 as a normal API error so the
      // caller can show a contextual message (e.g. "you don't have access to
      // this match"), instead of force-bouncing to /auth.
    }
    throw await ApiError.fromResponse(res);
  }

  // Some edge functions return 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

/**
 * Public variant of apiFetch, does NOT require auth.
 * Uses the anon key for pre-auth endpoints (e.g. liquidity-check).
 */
export async function apiFetchPublic<T = unknown>(
  path: string,
  init?: Omit<ApiFetchOptions, "idempotencyKey">
): Promise<T> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `${baseUrl}/functions/v1/${path}`;

  const { headers: initHeaders, ...restInit } = init ?? {};

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: anonKey,
    ...(initHeaders as Record<string, string> ?? {}),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  let res: Response;
  try {
    res = await fetch(url, { ...restInit, headers, signal: controller.signal });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(0, "Request timed out.", "TIMEOUT");
    }
    throw new ApiError(0, "Network error.", "NETWORK_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) throw await ApiError.fromResponse(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * Convenience: check if an error is an auth error so the UI can redirect.
 */
export function isAuthError(err: unknown): err is AuthRequiredError {
  return err instanceof AuthRequiredError;
}

/**
 * Convenience: check if an error is an API error with a specific HTTP status.
 */
export function isApiError(err: unknown, status?: number): err is ApiError {
  if (!(err instanceof ApiError)) return false;
  return status === undefined || err.status === status;
}
