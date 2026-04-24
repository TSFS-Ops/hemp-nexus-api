/**
 * edge-invoke — single entry point for calling Supabase Edge Functions from the
 * browser with hardened auth + friendly error translation.
 *
 * Why this exists
 * ───────────────
 * Two recurring failure modes leak raw developer-jargon to end users:
 *
 *   1. Stale access tokens. `supabase.functions.invoke()` and direct `fetch`
 *      calls happily send whatever JWT is in storage, so an expired token
 *      surfaces as `{"error":"Unauthorized"}` with no recovery path.
 *
 *   2. Unmapped server statuses. A 503 `MAINTENANCE_MODE`, a 403 from RLS, or
 *      a 429 rate-limit reaches the UI as `Edge Function returned a non-2xx
 *      status code`, which tells the user nothing.
 *
 * `invokeEdgeFunction` and `fetchEdgeFunction` solve both:
 *   • Pre-flight check on `expires_at`; auto-refresh if <30s remain.
 *   • If refresh fails, throw a clear "session expired" message.
 *   • If the server returns 401/403/429/503, translate to a friendly toast.
 *   • Otherwise, surface the server body so callers still get useful detail.
 */

import { supabase } from "@/integrations/supabase/client";
import { notifySessionExpired } from "@/lib/session-expiry-bus";

/** Codes that should trigger the global SessionExpiredModal. */
const SESSION_DEAD_CODES = new Set(["UNAUTHORIZED", "NO_SESSION", "REFRESH_FAILED"]);

// ── Public error type ──────────────────────────────────────────────────────
export class EdgeInvokeError extends Error {
  status?: number;
  code?: string;
  serverBody?: string;
  /**
   * Server-supplied correlation ID (from `x-request-id`, `sb-request-id`,
   * or `cf-ray` response headers; falls back to a parsed JSON body field
   * when present). Surface this in user-facing error UI so support can
   * locate the failing invocation in edge function logs.
   */
  requestId?: string;
  constructor(
    message: string,
    opts: { status?: number; code?: string; serverBody?: string; requestId?: string } = {}
  ) {
    super(message);
    this.name = "EdgeInvokeError";
    this.status = opts.status;
    this.code = opts.code;
    this.serverBody = opts.serverBody;
    this.requestId = opts.requestId;

    // Side-effect: surface a global, blocking re-auth modal whenever the
    // failure means the user's session is unrecoverable. This replaces the
    // easy-to-miss bottom-right toast that confused clients in the past
    // (incident 2026-04-24: client repeatedly clicked "Download waiver
    // pack" without noticing the corner toast).
    if (opts.code && SESSION_DEAD_CODES.has(opts.code)) {
      notifySessionExpired(
        opts.code as "UNAUTHORIZED" | "NO_SESSION" | "REFRESH_FAILED",
        message,
        opts.requestId
      );
    }
  }
}

/** Best-effort extraction of a correlation ID from an edge response. */
export function extractRequestId(
  headers: Headers | undefined,
  body: string | undefined
): string | undefined {
  if (headers) {
    const fromHeader =
      headers.get("x-request-id") ||
      headers.get("sb-request-id") ||
      headers.get("x-supabase-request-id") ||
      headers.get("cf-ray");
    if (fromHeader) return fromHeader;
  }
  if (body) {
    try {
      const parsed = JSON.parse(body) as { requestId?: string; request_id?: string };
      return parsed.requestId || parsed.request_id;
    } catch {
      /* not JSON */
    }
  }
  return undefined;
}

/** True when the error means the current session can't recover without re-auth. */
export function isSessionExpiredError(err: unknown): err is EdgeInvokeError {
  return err instanceof EdgeInvokeError && !!err.code && SESSION_DEAD_CODES.has(err.code);
}

// ── Token freshness ────────────────────────────────────────────────────────
const REFRESH_SKEW_MS = 30_000; // refresh if <30s remain on access token

async function ensureFreshAccessToken(opts: { requireSession: boolean }): Promise<string | null> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new EdgeInvokeError(`Session check failed: ${sessionError.message}`);
  }
  let session = sessionData.session;

  const isExpired = (s: typeof session): boolean => {
    if (!s?.expires_at) return false;
    return s.expires_at * 1000 - Date.now() < REFRESH_SKEW_MS;
  };

  if (!session) {
    if (opts.requireSession) {
      throw new EdgeInvokeError(
        "Your session has expired. Please sign out and sign back in, then try again.",
        { status: 401, code: "NO_SESSION" }
      );
    }
    return null;
  }

  if (isExpired(session)) {
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr || !refreshed.session) {
      throw new EdgeInvokeError(
        "Your session has expired. Please sign out and sign back in, then try again.",
        { status: 401, code: "REFRESH_FAILED" }
      );
    }
    session = refreshed.session;
  }
  return session.access_token;
}

// ── Status → friendly message translation ─────────────────────────────────
function translateError(status: number | undefined, body: string, fallbackMsg: string): EdgeInvokeError {
  // Try to extract a server-supplied error code/message from JSON body
  let parsed: { error?: string; code?: string; message?: string } | null = null;
  if (body) {
    try {
      parsed = JSON.parse(body);
    } catch {
      /* not JSON */
    }
  }
  const serverMsg = parsed?.error || parsed?.message || "";
  const serverCode = parsed?.code || "";

  if (status === 401 || /unauthorized/i.test(serverMsg) || /unauthorized/i.test(body)) {
    return new EdgeInvokeError(
      "Your session has expired. Please sign out and sign back in, then try again.",
      { status, code: "UNAUTHORIZED", serverBody: body }
    );
  }
  if (status === 403 || /forbidden/i.test(serverMsg)) {
    return new EdgeInvokeError(
      "You don't have permission to perform this action. Contact an administrator if you believe this is a mistake.",
      { status, code: "FORBIDDEN", serverBody: body }
    );
  }
  if (status === 429 || /rate.?limit/i.test(serverMsg)) {
    return new EdgeInvokeError(
      "You're doing that too quickly. Please wait a moment and try again.",
      { status, code: "RATE_LIMITED", serverBody: body }
    );
  }
  if (status === 503 || serverCode === "MAINTENANCE_MODE" || /maintenance/i.test(serverMsg)) {
    return new EdgeInvokeError(
      "The platform is in maintenance mode. Please try again shortly.",
      { status, code: "MAINTENANCE_MODE", serverBody: body }
    );
  }
  if (status === 404 || /not.?found/i.test(serverMsg)) {
    return new EdgeInvokeError(
      serverMsg || "The requested resource could not be found.",
      { status, code: "NOT_FOUND", serverBody: body }
    );
  }

  return new EdgeInvokeError(
    serverMsg ? `${fallbackMsg} — ${serverMsg}` : fallbackMsg,
    { status, code: serverCode, serverBody: body }
  );
}

// ── invokeEdgeFunction (wraps supabase.functions.invoke) ──────────────────
export interface InvokeEdgeOptions {
  /** Request body (JSON). */
  body?: unknown;
  /** HTTP method override. Defaults to POST when body present, GET otherwise. */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Extra headers to merge in. */
  headers?: Record<string, string>;
  /**
   * If true (default), require a logged-in session and refresh if needed.
   * Set to false for public functions that may be called pre-auth.
   */
  requireSession?: boolean;
  /** Human-readable label used in fallback error messages. */
  label?: string;
}

export async function invokeEdgeFunction<T = unknown>(
  functionName: string,
  options: InvokeEdgeOptions = {}
): Promise<T> {
  const { body, method, headers, requireSession = true, label } = options;
  await ensureFreshAccessToken({ requireSession });

  const { data, error } = await supabase.functions.invoke(functionName, {
    body: body as Record<string, unknown> | undefined,
    method,
    headers,
  });

  if (error) {
    const ctx = (error as { context?: Response }).context;
    let serverBody = "";
    let serverStatus: number | undefined;
    if (ctx && typeof ctx.text === "function") {
      serverStatus = ctx.status;
      try {
        serverBody = await ctx.clone().text();
      } catch {
        /* ignore */
      }
    }
    throw translateError(
      serverStatus,
      serverBody,
      label ? `Could not ${label}` : `Edge function ${functionName} failed`
    );
  }

  return data as T;
}

// ── fetchEdgeFunction (wraps native fetch for path-based calls) ───────────
export interface FetchEdgeOptions extends Omit<RequestInit, "headers" | "body"> {
  /** Request body. Will be JSON-stringified if not already a string/FormData. */
  body?: unknown;
  /** Extra headers to merge in. */
  headers?: Record<string, string>;
  /** If true (default), require + refresh session before call. */
  requireSession?: boolean;
  /** Human-readable label for error messages. */
  label?: string;
  /** Query string to append (?a=b&c=d). */
  query?: Record<string, string | number | boolean | undefined>;
}

export async function fetchEdgeFunction<T = unknown>(
  path: string,
  options: FetchEdgeOptions = {}
): Promise<T> {
  const { body, headers = {}, requireSession = true, label, query, ...rest } = options;
  const accessToken = await ensureFreshAccessToken({ requireSession });

  const trimmed = path.replace(/^\/+/, "");
  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  let url = `${baseUrl}/functions/v1/${trimmed}`;
  if (query) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }

  const finalHeaders: Record<string, string> = { ...headers };
  if (accessToken && !finalHeaders.Authorization && !finalHeaders.authorization) {
    finalHeaders.Authorization = `Bearer ${accessToken}`;
  }

  let serialisedBody: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (body instanceof FormData || typeof body === "string" || body instanceof Blob) {
      serialisedBody = body as BodyInit;
    } else {
      serialisedBody = JSON.stringify(body);
      if (!finalHeaders["Content-Type"] && !finalHeaders["content-type"]) {
        finalHeaders["Content-Type"] = "application/json";
      }
    }
  }

  const res = await fetch(url, {
    ...rest,
    headers: finalHeaders,
    body: serialisedBody,
  });

  if (!res.ok) {
    let serverBody = "";
    try {
      serverBody = await res.text();
    } catch {
      /* ignore */
    }
    throw translateError(
      res.status,
      serverBody,
      label ? `Could not ${label}` : `Request to ${trimmed} failed`
    );
  }

  // Some functions return 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  const text = await res.text();
  if (!text) return undefined as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}
