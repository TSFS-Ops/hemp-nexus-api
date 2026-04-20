// CORS configuration for Compliance Matching API
// Strict origin enforcement: only whitelisted production domains are allowed.
// Wildcard ('*') is permitted ONLY when ALLOWED_ORIGINS is explicitly set to '*' (dev/test).

const BASE_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key, idempotency-key, x-request-id, x-internal-key',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Idempotent-Replay, X-Match-Duplicate',
  'Vary': 'Origin',
};

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

export const isOriginAllowed = (allowedOrigins: string, origin: string | null): boolean => {
  const allowedList = allowedOrigins.split(',').map(o => o.trim()).filter(Boolean);
  if (allowedList.includes('*')) return true;
  if (!origin) return false;
  if (allowedList.includes(origin)) return true;
  return isLovablePreviewOrigin(origin);
};

export const corsHeaders = (allowedOrigins: string, origin: string | null = null) => {
  const allowedList = allowedOrigins.split(',').map(o => o.trim()).filter(Boolean);

  // Explicit wildcard (dev only)
  if (allowedList.includes('*')) {
    return {
      'Access-Control-Allow-Origin': '*',
      ...BASE_HEADERS,
    };
  }

  // Strict mode: only echo origin if whitelisted; otherwise return first allowed (request will be rejected)
  if (origin && allowedList.includes(origin)) {
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

