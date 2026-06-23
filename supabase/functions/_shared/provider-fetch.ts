/**
 * provider-fetch — bounded-timeout wrapper around `fetch()` for outbound
 * third-party HTTP calls (typically payment providers).
 *
 * WHY THIS EXISTS
 * ---------------
 * Edge Function invocations have a wall-clock limit. A hung TCP socket
 * to an external provider could block until that limit fires, with two
 * bad consequences:
 *   1. The function returns 5xx/timeout to the caller — which the
 *      original inconclusive-verify containment was written to handle,
 *      but only if we actually reach the catch block in time.
 *   2. A reconciliation tick could run out of budget mid-sweep, leaving
 *      other pending rows unverified that pass.
 *
 * Every outbound provider call site MUST go through this helper so
 * timeout/abort errors surface deterministically as a typed
 * `ProviderFetchTimeoutError` (a network-style failure, NOT a
 * definitive provider failure).
 *
 * Default timeout is 8000ms — well under any reasonable provider RTT
 * and far below the Edge Function wall-clock.
 *
 * PROVIDER-AGNOSTIC: nothing in this file is provider-specific. Any
 * caller passes its own `providerName` for error labelling.
 */

export const DEFAULT_PROVIDER_FETCH_TIMEOUT_MS = 8000;

export class ProviderFetchTimeoutError extends Error {
  readonly code = "PROVIDER_TIMEOUT";
  constructor(public readonly providerName: string, public readonly timeoutMs: number) {
    super(`${providerName} request timed out after ${timeoutMs}ms`);
    this.name = "ProviderFetchTimeoutError";
  }
}

export class ProviderFetchNetworkError extends Error {
  readonly code = "PROVIDER_NETWORK_ERROR";
  constructor(public readonly providerName: string, public readonly cause: unknown) {
    super(
      `${providerName} network error: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "ProviderFetchNetworkError";
  }
}

export interface ProviderFetchOptions {
  /** Abort after this many milliseconds. Defaults to 8000. */
  timeoutMs?: number;
  /** Provider label used in error messages. Defaults to "provider". */
  providerName?: string;
}

/**
 * `providerFetch(url, init, options)` — drop-in `fetch` replacement
 * with a bounded `AbortController` timeout.
 *
 * - On timeout: throws `ProviderFetchTimeoutError` (treat as inconclusive).
 * - On network/transport failure: throws `ProviderFetchNetworkError`
 *   (treat as inconclusive).
 * - Otherwise returns the raw `Response`. Callers remain responsible for
 *   inspecting `response.ok`, parsing JSON safely, and applying their
 *   own inconclusive-vs-definitive classification.
 *
 * Errors are NEVER swallowed.
 */
export async function providerFetch(
  url: string,
  init: RequestInit = {},
  options: ProviderFetchOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_FETCH_TIMEOUT_MS;
  const providerName = options.providerName ?? "provider";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "AbortError" || name === "TimeoutError") {
      throw new ProviderFetchTimeoutError(providerName, timeoutMs);
    }
    throw new ProviderFetchNetworkError(providerName, err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convenience predicate — true for the inconclusive provider errors
 * thrown by `providerFetch`. Callers MUST treat both as "pending
 * provider" (retryable, never definitive failure).
 */
export function isProviderInconclusiveError(err: unknown): boolean {
  return (
    err instanceof ProviderFetchTimeoutError ||
    err instanceof ProviderFetchNetworkError
  );
}
