/**
 * Batch F — shared fetch wrapper with bounded timeout.
 *
 * Wraps the standard `fetch()` with an `AbortSignal.timeout`. Returns a
 * Response on success or throws a typed `ProviderTimeoutError` on timeout.
 * Other network/transport errors propagate as `ProviderNetworkError`.
 *
 * Use for every outbound call to a third-party provider so the function
 * never hangs to the Edge Function wall-clock limit.
 */

export class ProviderTimeoutError extends Error {
  readonly code = "PROVIDER_TIMEOUT";
  constructor(public readonly providerName: string, public readonly timeoutMs: number) {
    super(`${providerName} timed out after ${timeoutMs}ms`);
  }
}

export class ProviderNetworkError extends Error {
  readonly code = "PROVIDER_NETWORK_ERROR";
  constructor(public readonly providerName: string, public readonly cause: unknown) {
    super(`${providerName} network error: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  providerName: string,
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError" || String((err as Error)?.message ?? "").includes("timeout")) {
      throw new ProviderTimeoutError(providerName, timeoutMs);
    }
    throw new ProviderNetworkError(providerName, err);
  } finally {
    clearTimeout(timer);
  }
}

/** True for HTTP statuses we treat as provider failure (no verification). */
export function isProviderFailureStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
