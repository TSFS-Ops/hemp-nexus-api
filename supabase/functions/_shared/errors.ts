// Standard error response format for Compliance Matching API
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
  requestId: string;
}

export class ApiException extends Error {
  public code: string;
  public statusCode: number;
  public details?: Record<string, any>;

  constructor(
    code: string,
    message: string,
    statusCode: number = 400,
    details?: Record<string, any>
  ) {
    super(message);
    this.name = 'ApiException';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

// Convert database errors to ApiException (prevents info leakage)
export const handleDatabaseError = (error: any, requestId: string): never => {
  console.error(`[${requestId}] Database error:`, error);
  
  // Don't expose database implementation details
  throw new ApiException(
    'DATABASE_ERROR',
    'A database error occurred',
    500
  );
};

export const errorResponse = (
  error: ApiException | Error,
  requestId: string,
  headers: Record<string, string> = {}
): Response => {
  console.error(`[${requestId}] Error:`, error);

  if (error instanceof ApiException) {
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers
    };

    // Add Retry-After header for rate limit errors
    if (error.statusCode === 429 && error.details?.retryAfter) {
      responseHeaders['Retry-After'] = error.details.retryAfter.toString();
    }

    // Batch C Phase 3A: canonical CHALLENGE_OPEN response shape across ALL
    // edge functions. We deliberately diverge from the standard
    // `{code,message,details,requestId}` envelope so clients can rely on a
    // single, stable shape regardless of which surface emitted the 409.
    if (error.code === 'CHALLENGE_OPEN') {
      const d = error.details ?? {};
      const canonicalBody = {
        error: 'CHALLENGE_OPEN',
        code: 'CHALLENGE_OPEN',
        message: error.message,
        challenge_id: d.challenge_id ?? null,
        challenge_status: d.challenge_status ?? null,
        raised_at: d.raised_at ?? null,
        requestId,
      };
      return new Response(JSON.stringify(canonicalBody), {
        status: error.statusCode,
        headers: responseHeaders,
      });
    }

    const body: ApiError = {
      code: error.code,
      message: error.message,
      details: error.details,
      requestId,
    };

    return new Response(JSON.stringify(body), {
      status: error.statusCode,
      headers: responseHeaders,
    });
  }

  // Generic error — return a structured 500 with sanitized location context
  // so on-call engineers can correlate a requestId to a file:line without
  // exposing full stack traces or absolute paths to clients.
  const body: ApiError = {
    code: 'INTERNAL_ERROR',
    message: 'An internal error occurred',
    requestId,
    details: {
      errorName: (error && (error as Error).name) || 'Error',
      source: extractSourceLocation(error as Error),
    },
  };
  return new Response(JSON.stringify(body), {
    status: 500,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
};

/**
 * Parse the first in-repo frame from an Error stack and return a sanitized
 * `<file>:<line>[:<col>]` string. Strips absolute paths, query strings, and
 * any `file://` / `https://` scheme so we never leak deploy-host paths.
 *
 * Returns `null` if no frame can be parsed.
 */
export function extractSourceLocation(error: Error | undefined | null): string | null {
  if (!error || typeof error.stack !== 'string') return null;
  const lines = error.stack.split('\n');
  for (const raw of lines) {
    // V8 / Deno stack frames look like:
    //   "    at handler (file:///.../supabase/functions/poi-engagements/index.ts:441:15)"
    //   "    at file:///.../index.ts:441:15"
    const m = raw.match(/(?:\(|\bat\s+)(?:[a-z]+:\/\/[^\s)]*?\/)?([^\s/()]+\.[tj]sx?):(\d+)(?::(\d+))?\)?/i);
    if (m) {
      const file = m[1].split('?')[0];
      const line = m[2];
      const col = m[3];
      return col ? `${file}:${line}:${col}` : `${file}:${line}`;
    }
  }
  return null;
}
