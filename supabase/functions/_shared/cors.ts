// CORS configuration for Compliance Matching API
// Strict origin enforcement: only whitelisted production domains are allowed.
// Wildcard ('*') is permitted ONLY when ALLOWED_ORIGINS is explicitly set to '*' (dev/test).
//
// Stage 1 hardening (2026-05-01):
//  - Safe production fallback (PRODUCTION_ORIGINS) when ALLOWED_ORIGINS env is unset
//    or empty, so we never silently regress to '*'.
//  - New `withCors(req, response)` helper to attach CORS headers to any Response
//    without spreading manually at every call-site (eliminates the
//    "forgot the headers in this error path" failure mode).
//  - New `webhookCorsHeaders()` helper for server-to-server webhook handlers
//    that should NOT echo Allow-Origin (Paystack/Resend/Supabase Auth hooks).
//  - All previous exports (`isOriginAllowed`, `corsHeaders`, `handleCors`) are
//    preserved with backward-compatible signatures so the 66 functions that
//    already import them continue to work unchanged.

const BASE_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key, idempotency-key, x-request-id, x-internal-key, if-none-match',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Idempotent-Replay, X-Match-Duplicate, ETag',
  'Vary': 'Origin',
};

// Hardcoded production origins. Used as the safe default when the
// ALLOWED_ORIGINS secret is missing/empty so the platform NEVER falls open
// to '*' due to a misconfigured environment.
export const PRODUCTION_ORIGINS: readonly string[] = [
  'https://www.izenzo.co.za',
  'https://izenzo.co.za',
  'https://api.trade.izenzo.co.za',
] as const;

// Always-allowed Lovable preview/sandbox hosts (used by the in-app browser preview)
const LOVABLE_PREVIEW_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.lovableproject\.com$/i,
  /^https:\/\/[a-z0-9-]+\.lovable\.app$/i,
  /^https:\/\/[a-z0-9-]+\.sandbox\.lovable\.dev$/i,
];

const isLovablePreviewOrigin = (origin: string | null): boolean => {
  if (!origin) return false;
  return LOVABLE_PREVIEW_PATTERNS.some((re) => re.test(origin));
};

/**
 * Resolve the effective allow-list.
 *  - `null`/`undefined`/empty string → PRODUCTION_ORIGINS (safe default, never '*').
 *  - `'*'`                            → ['*'] (explicit dev override).
 *  - comma-separated list             → parsed list.
 */
export const resolveAllowedOrigins = (allowedOrigins?: string | null): string[] => {
  const raw = (allowedOrigins ?? '').trim();
  if (!raw) return [...PRODUCTION_ORIGINS];
  if (raw === '*') return ['*'];
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
};

export const isOriginAllowed = (allowedOrigins: string, origin: string | null): boolean => {
  const allowedList = resolveAllowedOrigins(allowedOrigins);
  if (allowedList.includes('*')) return true;
  if (!origin) return false;
  if (allowedList.includes(origin)) return true;
  return isLovablePreviewOrigin(origin);
};

export const corsHeaders = (allowedOrigins: string, origin: string | null = null) => {
  const allowedList = resolveAllowedOrigins(allowedOrigins);

  // Explicit wildcard (dev only)
  if (allowedList.includes('*')) {
    return {
      'Access-Control-Allow-Origin': '*',
      ...BASE_HEADERS,
    };
  }

  // Echo origin if whitelisted OR if it's a Lovable preview host
  if (origin && (allowedList.includes(origin) || isLovablePreviewOrigin(origin))) {
    return {
      'Access-Control-Allow-Origin': origin,
      ...BASE_HEADERS,
    };
  }

  // Origin not whitelisted - return restrictive headers (no Allow-Origin echo)
  return {
    'Access-Control-Allow-Origin': allowedList[0] || 'null',
    ...BASE_HEADERS,
  };
};

export const handleCors = (req: Request, allowedOrigins: string) => {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.get('origin');

    // Reject preflight from non-whitelisted origins
    if (!isOriginAllowed(allowedOrigins, origin)) {
      return new Response(null, {
        status: 403,
        headers: { 'Vary': 'Origin' },
      });
    }

    return new Response(null, {
      status: 204,
      headers: corsHeaders(allowedOrigins, origin),
    });
  }
  return null;
};

// ─────────────────────────────────────────────────────────────────────
// Stage 1 helpers — convenience wrappers for the upcoming edge-function
// migration. These read ALLOWED_ORIGINS from the environment internally
// so individual functions don't need to thread it through.
// ─────────────────────────────────────────────────────────────────────

/** Read ALLOWED_ORIGINS from the Deno env. Returns '' if unset (caller-friendly). */
const readAllowedOriginsEnv = (): string => {
  try {
    // deno-lint-ignore no-explicit-any
    const env = (globalThis as any).Deno?.env;
    return (env?.get?.('ALLOWED_ORIGINS') ?? '').toString();
  } catch {
    return '';
  }
};

/**
 * Preflight handler for browser-facing functions. Returns a Response if the
 * request is an OPTIONS preflight (allowed → 204 with headers, disallowed →
 * 403). Returns `null` for non-OPTIONS requests so the caller can continue.
 */
export const handleCorsPreflight = (req: Request): Response | null => {
  return handleCors(req, readAllowedOriginsEnv());
};

/**
 * Attach CORS response headers to an existing Response. Use this on ALL
 * responses (success and error) from browser-facing edge functions so we
 * never accidentally ship a response that the browser will block.
 *
 *   return withCors(req, new Response(JSON.stringify(data), { status: 200 }));
 *
 * Headers already present on the response are preserved; CORS headers are
 * additive and will overwrite any existing CORS headers on the response.
 */
export const withCors = (req: Request, response: Response): Response => {
  const origin = req.headers.get('origin');
  const headers = new Headers(response.headers);
  const cors = corsHeaders(readAllowedOriginsEnv(), origin);
  for (const [k, v] of Object.entries(cors)) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

/**
 * Headers for server-to-server webhook handlers (Paystack, Resend, Supabase
 * Auth hooks, internal cron callers). These endpoints are NOT called by
 * browsers, so they must not advertise an Access-Control-Allow-Origin at all
 * — we only emit Vary: Origin so any incidental CORS-aware client knows the
 * response varies by origin (which is none).
 *
 * Use the signature-validation layer (HMAC, INTERNAL_CRON_KEY, etc.) as the
 * actual security boundary for these endpoints.
 */
export const webhookCorsHeaders = (): Record<string, string> => {
  return { 'Vary': 'Origin' };
};
