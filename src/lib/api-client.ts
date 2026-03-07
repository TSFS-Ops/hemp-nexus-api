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

  constructor(status: number, message: string, code?: string, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code ?? null;
    this.requestId = requestId ?? null;
  }

  /**
   * Parse the standard { error, code, request_id } envelope returned by
   * the shared `errorResponse` helper in Edge Functions.
   */
  static async fromResponse(res: Response): Promise<ApiError> {
    let message = res.statusText || `Request failed (${res.status})`;
    let code: string | undefined;
    let requestId: string | undefined;

    try {
      const body = await res.json();
      if (body.error) message = body.error;
      if (body.message) message = body.message;
      code = body.code;
      requestId = body.request_id;
    } catch {
      // body wasn't JSON – use statusText
    }

    return new ApiError(res.status, message, code, requestId);
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

  const { idempotencyKey, headers: initHeaders, ...restInit } = init ?? {};

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
    ...(initHeaders as Record<string, string> ?? {}),
  };

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const res = await fetch(url, {
    ...restInit,
    headers,
  });

  if (!res.ok) {
    throw await ApiError.fromResponse(res);
  }

  // Some edge functions return 204 No Content
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
