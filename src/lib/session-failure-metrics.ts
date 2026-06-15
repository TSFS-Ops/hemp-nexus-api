/**
 * session-failure-metrics - lightweight client-side counters for tracking
 * how often downloads / edge calls fail due to expired or unrecoverable
 * sessions.
 *
 * Why: previously we had no visibility into how frequently users hit the
 * SessionExpiredModal. Toasts were missed; expired-session loops went
 * unreported. These counters give us a first read on the size of the
 * problem without needing a third-party analytics SDK.
 *
 * Storage: a single JSON blob in localStorage under METRICS_KEY. We also
 * dispatch a `window` CustomEvent on every increment so admin/debug panels
 * (and future telemetry shippers) can subscribe live without polling.
 *
 * Tracked codes:
 *   - UNAUTHORIZED         - server returned 401
 *   - REFRESH_FAILED       - supabase.auth.refreshSession() rejected
 *   - HEALTH_CHECK_FAILED  - background session ping failed
 */

export type TrackedSessionFailureCode =
  | "UNAUTHORIZED"
  | "REFRESH_FAILED"
  | "HEALTH_CHECK_FAILED";

export interface SessionFailureCounter {
  count: number;
  /** ISO timestamp of the most recent occurrence. */
  lastAt: string | null;
  /** Most recent edge-function correlation ID (if any). */
  lastRequestId: string | null;
  /** Most recent contextual label, e.g. the action being attempted. */
  lastContext: string | null;
}

export type SessionFailureCounters = Record<
  TrackedSessionFailureCode,
  SessionFailureCounter
>;

const METRICS_KEY = "izenzo:session-failure-metrics:v1";
export const SESSION_FAILURE_METRIC_EVENT = "izenzo:session-failure-metric";

const EMPTY: SessionFailureCounter = {
  count: 0,
  lastAt: null,
  lastRequestId: null,
  lastContext: null,
};

function emptyCounters(): SessionFailureCounters {
  return {
    UNAUTHORIZED: { ...EMPTY },
    REFRESH_FAILED: { ...EMPTY },
    HEALTH_CHECK_FAILED: { ...EMPTY },
  };
}

function readRaw(): SessionFailureCounters {
  if (typeof window === "undefined") return emptyCounters();
  try {
    const raw = window.localStorage.getItem(METRICS_KEY);
    if (!raw) return emptyCounters();
    const parsed = JSON.parse(raw) as Partial<SessionFailureCounters>;
    return {
      UNAUTHORIZED: { ...EMPTY, ...(parsed.UNAUTHORIZED ?? {}) },
      REFRESH_FAILED: { ...EMPTY, ...(parsed.REFRESH_FAILED ?? {}) },
      HEALTH_CHECK_FAILED: { ...EMPTY, ...(parsed.HEALTH_CHECK_FAILED ?? {}) },
    };
  } catch {
    return emptyCounters();
  }
}

function writeRaw(state: SessionFailureCounters): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(METRICS_KEY, JSON.stringify(state));
  } catch {
    /* storage full / disabled - counters are best-effort */
  }
}

export interface RecordOptions {
  /** Server correlation ID returned by edge-invoke (optional). */
  requestId?: string;
  /**
   * What the user was trying to do, e.g. "download waiver packet".
   * Helps distinguish download flows from generic auth pings.
   */
  context?: string;
}

/**
 * Increment the counter for `code` and dispatch a live event.
 * Safe to call from any code path (no-ops outside the browser).
 */
export function recordSessionFailure(
  code: TrackedSessionFailureCode,
  opts: RecordOptions = {}
): void {
  if (typeof window === "undefined") return;
  const state = readRaw();
  const bucket = state[code];
  bucket.count += 1;
  bucket.lastAt = new Date().toISOString();
  bucket.lastRequestId = opts.requestId ?? bucket.lastRequestId;
  bucket.lastContext = opts.context ?? bucket.lastContext;
  writeRaw(state);

  // Dev console signal - easy to spot in support sessions.
  // eslint-disable-next-line no-console
  console.info(
    `[session-failure-metrics] ${code} (#${bucket.count})` +
      (opts.context ? ` - ${opts.context}` : "") +
      (opts.requestId ? ` [ref ${opts.requestId}]` : "")
  );

  window.dispatchEvent(
    new CustomEvent<{
      code: TrackedSessionFailureCode;
      counter: SessionFailureCounter;
      context?: string;
      requestId?: string;
    }>(SESSION_FAILURE_METRIC_EVENT, {
      detail: { code, counter: { ...bucket }, context: opts.context, requestId: opts.requestId },
    })
  );
}

/** Read the current counter snapshot (for debug panels / support). */
export function getSessionFailureCounters(): SessionFailureCounters {
  return readRaw();
}

/** Reset all counters - useful for QA, support sessions, or after a fix ships. */
export function resetSessionFailureCounters(): void {
  writeRaw(emptyCounters());
}
