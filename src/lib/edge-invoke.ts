/**
 * edge-invoke - single entry point for calling Supabase Edge Functions from the
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
import {
  recordSessionFailure,
  type TrackedSessionFailureCode,
} from "@/lib/session-failure-metrics";

/** Codes that should trigger the global SessionExpiredModal. */
const SESSION_DEAD_CODES = new Set(["UNAUTHORIZED", "NO_SESSION", "REFRESH_FAILED"]);
const SERVER_UNAUTHORIZED_MESSAGE =
  "We could not verify your access for this action. Please refresh the page and try again.";
const SESSION_EXPIRED_MESSAGE =
  "Your session has expired. Please sign out and sign back in, then try again.";

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
  /** Caller-supplied label (e.g. "download waiver packet") used for metrics context. */
  context?: string;
  constructor(
    message: string,
    opts: {
      status?: number;
      code?: string;
      serverBody?: string;
      requestId?: string;
      context?: string;
    } = {}
  ) {
    super(message);
    this.name = "EdgeInvokeError";
    this.status = opts.status;
    this.code = opts.code;
    this.serverBody = opts.serverBody;
    this.requestId = opts.requestId;
    this.context = opts.context;

    // Side-effect: surface a global, blocking re-auth modal whenever the
    // failure means the user's session is unrecoverable. This replaces the
    // easy-to-miss bottom-right toast that confused clients in the past
    // (incident 2026-04-24: client repeatedly clicked "Download waiver
    // pack" without noticing the corner toast).
    //
    // To avoid spurious modals when an edge function returns 401 for
    // resource-level reasons (e.g. a transient cold-boot, a momentary RLS
    // hiccup, or a function that just hasn't validated the JWT correctly
    // server-side), we **verify** the session is actually dead via a
    // lightweight `auth.getUser()` round-trip BEFORE firing the modal.
    // Only if the server confirms the JWT is invalid do we bounce the user.
    if (opts.code && SESSION_DEAD_CODES.has(opts.code)) {
      void verifyAndNotifySessionExpired(
        opts.code as "UNAUTHORIZED" | "NO_SESSION" | "REFRESH_FAILED",
        message,
        opts.requestId
      );
    }
    // Increment client-side counter for the two tracked edge-side codes.
    // NO_SESSION is intentionally excluded - it fires before any network
    // call (no session at all) and would inflate the "session died mid-
    // download" signal we actually care about.
    if (opts.code === "UNAUTHORIZED" || opts.code === "REFRESH_FAILED") {
      recordSessionFailure(opts.code as TrackedSessionFailureCode, {
        requestId: opts.requestId,
        context: opts.context,
      });
    }
  }
}

/**
 * Verifies the session is genuinely dead before triggering the global
 * SessionExpiredModal. Avoids spurious bounces when an edge function
 * returns 401 for non-auth reasons.
 *
 *   • NO_SESSION / REFRESH_FAILED - already verified locally; trust them.
 *   • UNAUTHORIZED - call auth.getUser(); fire only if server says invalid.
 */
async function verifyAndNotifySessionExpired(
  reason: "UNAUTHORIZED" | "NO_SESSION" | "REFRESH_FAILED",
  message: string,
  requestId?: string
): Promise<void> {
  if (reason !== "UNAUTHORIZED") {
    notifySessionExpired(reason, message, requestId);
    return;
  }
  try {
    const { data, error } = await supabase.auth.getUser();
    // If the server confirms a valid user → the 401 was resource-specific,
    // not session death. Suppress the modal; the caller's friendly toast
    // will still surface to the user.
    if (!error && data?.user) return;
    // Server confirms session is invalid → genuine expiry.
    await supabase.auth.signOut({ scope: "local" }).catch(() => { /* noop */ });
    notifySessionExpired(reason, message, requestId);
  } catch {
    // Network error during verification - be conservative and fire the
    // modal so the user can re-auth rather than being trapped in a 401 loop.
    notifySessionExpired(reason, message, requestId);
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

/**
 * Format an error for user-facing display, appending the correlation ID
 * when available so support can locate the failing invocation in logs.
 */
export function describeEdgeError(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof EdgeInvokeError) {
    return err.requestId ? `${err.message} (Ref: ${err.requestId})` : err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

// ── Token freshness ────────────────────────────────────────────────────────
const REFRESH_SKEW_MS = 30_000; // refresh if <30s remain on access token
type RefreshResponse = Awaited<ReturnType<typeof supabase.auth.refreshSession>>;
let sharedRefreshPromise: Promise<RefreshResponse> | null = null;

export function refreshSessionOnce(): Promise<RefreshResponse> {
  if (!sharedRefreshPromise) {
    sharedRefreshPromise = supabase.auth.refreshSession().finally(() => {
      sharedRefreshPromise = null;
    });
  }
  return sharedRefreshPromise;
}

async function ensureFreshAccessToken(opts: {
  requireSession: boolean;
  context?: string;
}): Promise<string | null> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new EdgeInvokeError(`Session check failed: ${sessionError.message}`, {
      context: opts.context,
    });
  }
  let session = sessionData.session;

  const isExpired = (s: typeof session): boolean => {
    if (!s?.expires_at) return false;
    return s.expires_at * 1000 - Date.now() < REFRESH_SKEW_MS;
  };

  if (!session) {
    if (opts.requireSession) {
      throw new EdgeInvokeError(
        SESSION_EXPIRED_MESSAGE,
        { status: 401, code: "NO_SESSION", context: opts.context }
      );
    }
    return null;
  }

  if (isExpired(session)) {
    // Try refresh up to 3 times, guarded by a module-level promise so two
    // concurrent intel panels don't rotate the same refresh token in parallel.
    // Without this lock, the losing request can surface a false "session
    // expired" toast while the browser still has a perfectly valid session.
    let refreshErr: { message?: string } | null = null;
    let refreshedSession: typeof session = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: refreshed, error } = await refreshSessionOnce();
      if (!error && refreshed.session) {
        refreshedSession = refreshed.session;
        refreshErr = null;
        break;
      }
      refreshErr = error;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      // Re-read storage in case another tab/request just refreshed for us.
      const { data: latest } = await supabase.auth.getSession();
      if (latest.session && !isExpired(latest.session)) {
        refreshedSession = latest.session;
        refreshErr = null;
        break;
      }
    }
    if (refreshErr || !refreshedSession) {
      throw new EdgeInvokeError(
        SESSION_EXPIRED_MESSAGE,
        { status: 401, code: "REFRESH_FAILED", context: opts.context }
      );
    }
    session = refreshedSession;
  }
  return session.access_token;
}

// ── Status → friendly message translation ─────────────────────────────────
function translateError(
  status: number | undefined,
  body: string,
  fallbackMsg: string,
  requestId?: string,
  context?: string
): EdgeInvokeError {
  // Try to extract a server-supplied error code/message from JSON body
  let parsed: { error?: string; code?: string; message?: string; requestId?: string; request_id?: string } | null = null;
  if (body) {
    try {
      parsed = JSON.parse(body);
    } catch {
      /* not JSON */
    }
  }
  const serverMsg = parsed?.error || parsed?.message || "";
  const serverCode = parsed?.code || "";
  const rid = requestId || parsed?.requestId || parsed?.request_id;

  if (status === 401 || /unauthorized/i.test(serverMsg) || /unauthorized/i.test(body)) {
    // Do NOT clear local auth state here. Edge functions can return 401 for
    // function-specific auth bugs/permission paths while the browser session
    // is still valid. `verifyAndNotifySessionExpired()` performs a server
    // getUser() check first; only that confirmed-dead path signs out locally.
    return new EdgeInvokeError(
      SERVER_UNAUTHORIZED_MESSAGE,
      { status, code: "UNAUTHORIZED", serverBody: body, requestId: rid, context }
    );
  }
  if (status === 403 || /forbidden/i.test(serverMsg)) {
    return new EdgeInvokeError(
      "You don't have permission to perform this action. Contact an administrator if you believe this is a mistake.",
      { status, code: "FORBIDDEN", serverBody: body, requestId: rid, context }
    );
  }
  if (status === 429 || /rate.?limit/i.test(serverMsg)) {
    return new EdgeInvokeError(
      "You're doing that too quickly. Please wait a moment and try again.",
      { status, code: "RATE_LIMITED", serverBody: body, requestId: rid, context }
    );
  }
  if (status === 503 || serverCode === "MAINTENANCE_MODE" || /maintenance/i.test(serverMsg)) {
    return new EdgeInvokeError(
      "The platform is in maintenance mode. Please try again shortly.",
      { status, code: "MAINTENANCE_MODE", serverBody: body, requestId: rid, context }
    );
  }
  if (status === 404 || /not.?found/i.test(serverMsg)) {
    return new EdgeInvokeError(
      serverMsg || "The requested resource could not be found.",
      { status, code: "NOT_FOUND", serverBody: body, requestId: rid, context }
    );
  }

  return new EdgeInvokeError(
    serverMsg ? `${fallbackMsg} - ${serverMsg}` : fallbackMsg,
    { status, code: serverCode, serverBody: body, requestId: rid, context }
  );
}

// ── Transient-failure retry ───────────────────────────────────────────────
//
// Supabase Edge Runtime occasionally returns a 503 SUPABASE_EDGE_RUNTIME_ERROR
// or kills the TCP connection (surfacing in the browser as
// `TypeError: Failed to fetch`) when an isolate cold-boots under load. The
// failure is genuinely transient - the immediately-retried request succeeds
// (see network trace 2026-04-25T15:01:39Z poi-engagements 503 → 15:01:42Z 200).
//
// To prevent these blips from blanking out the UI, we retry idempotent calls
// (GET / no body) up to twice with short backoff. Mutating calls are NOT
// retried automatically because the original request may have partially
// succeeded server-side.
const TRANSIENT_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_BODY_CODES = ["SUPABASE_EDGE_RUNTIME_ERROR", "BOOT_ERROR", "WORKER_LIMIT"];
const UUID_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/|$)/i;

function assertFunctionPath(path: string, context?: string): void {
  if (!UUID_PATH_RE.test(path)) return;
  throw new EdgeInvokeError(
    "This action could not be completed because the backend request was routed incorrectly. Please refresh and try again.",
    {
      status: 400,
      code: "INVALID_FUNCTION_PATH",
      serverBody: `Refused to call UUID as edge function path: ${path}`,
      context,
    }
  );
}

function isTransientFetchError(err: unknown): boolean {
  if (err instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(err.message)) {
    return true;
  }
  return false;
}

function isTransientServerResponse(status: number | undefined, body: string): boolean {
  if (status && TRANSIENT_STATUSES.has(status)) {
    // Maintenance mode is an explicit 503 we do NOT want to retry - surface it.
    if (/maintenance/i.test(body)) return false;
    return true;
  }
  if (body && TRANSIENT_BODY_CODES.some((c) => body.includes(c))) return true;
  return false;
}

async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts: { retries: number; baseDelayMs: number; isTransient: (err: unknown) => boolean }
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === opts.retries || !opts.isTransient(err)) throw err;
      // Jittered backoff: 200ms, 600ms
      const delay = opts.baseDelayMs * (attempt + 1) + Math.random() * 100;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
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
  const metricsContext = label || functionName;
  assertFunctionPath(functionName, metricsContext);
  const accessToken = await ensureFreshAccessToken({ requireSession, context: metricsContext });

  const isIdempotent = !body && (!method || method === "GET");
  const finalHeaders: Record<string, string> = { ...(headers || {}) };
  if (accessToken && !finalHeaders.Authorization && !finalHeaders.authorization) {
    finalHeaders.Authorization = `Bearer ${accessToken}`;
  }

  const doInvoke = async (): Promise<T> => {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: body as Record<string, unknown> | undefined,
      method,
      headers: finalHeaders,
    });

    if (error) {
      const ctx = (error as { context?: Response }).context;
      let serverBody = "";
      let serverStatus: number | undefined;
      let requestId: string | undefined;
      if (ctx && typeof ctx.text === "function") {
        serverStatus = ctx.status;
        try {
          serverBody = await ctx.clone().text();
        } catch {
          /* ignore */
        }
        requestId = extractRequestId(ctx.headers, serverBody);
      }
      throw translateError(
        serverStatus,
        serverBody,
        label ? `Could not ${label}` : `Edge function ${functionName} failed`,
        requestId,
        metricsContext
      );
    }

    return data as T;
  };

  if (!isIdempotent) return doInvoke();

  return withTransientRetry(doInvoke, {
    retries: 2,
    baseDelayMs: 200,
    isTransient: (err) => {
      if (isTransientFetchError(err)) return true;
      if (err instanceof EdgeInvokeError) {
        return isTransientServerResponse(err.status, err.serverBody || "");
      }
      return false;
    },
  });
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
  const trimmedPath = path.replace(/^\/+/, "");
  const metricsContext = label || trimmedPath;
  assertFunctionPath(trimmedPath, metricsContext);
  const accessToken = await ensureFreshAccessToken({ requireSession, context: metricsContext });

  const trimmed = trimmedPath;
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
  // Always send the Supabase publishable/anon key as `apikey`. The Supabase
  // gateway requires this header on every /functions/v1/* request - without
  // it, a function with verify_jwt=true (the default) returns 401 at the
  // gateway, which the client surfaces as a misleading "session expired"
  // error. Sending it unconditionally is safe and matches what the JS SDK's
  // `supabase.functions.invoke` does under the hood.
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (anonKey && !finalHeaders.apikey && !finalHeaders.ApiKey) {
    finalHeaders.apikey = anonKey;
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

  const httpMethod = (rest.method || (serialisedBody ? "POST" : "GET")).toUpperCase();
  const isIdempotent = httpMethod === "GET" || httpMethod === "HEAD";

  const doFetch = async (): Promise<T> => {
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
      const requestId = extractRequestId(res.headers, serverBody);
      throw translateError(
        res.status,
        serverBody,
        label ? `Could not ${label}` : `Request to ${trimmed} failed`,
        requestId,
        metricsContext
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
  };

  if (!isIdempotent) return doFetch();

  return withTransientRetry(doFetch, {
    retries: 2,
    baseDelayMs: 200,
    isTransient: (err) => {
      if (isTransientFetchError(err)) return true;
      if (err instanceof EdgeInvokeError) {
        return isTransientServerResponse(err.status, err.serverBody || "");
      }
      return false;
    },
  });
}
