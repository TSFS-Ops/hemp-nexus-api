/**
 * client-analytics - minimal first-party event log for UI interactions.
 *
 * This is intentionally a *stand-in* for a heavier analytics SDK: there
 * is no PostHog / Segment / GA in this app, and we don't want to ship
 * one just to count clipboard clicks. So we follow the same pattern
 * `session-failure-metrics.ts` already established:
 *
 *   1. Accumulate a small JSON blob in localStorage so support / debug
 *      panels can read counters without a server round-trip.
 *   2. Dispatch a `window` CustomEvent on every track call so any future
 *      telemetry shipper (an `<AnalyticsBridge>` mounted at the root,
 *      a server-side `/events` endpoint, etc.) can subscribe LIVE
 *      without polling and without us having to refactor every call site.
 *   3. Console-info log so manual QA / support sessions see the trail.
 *
 * Adding a new event:
 *   - extend `ClientAnalyticsEvent` with the new payload type
 *   - add a constant to `CLIENT_ANALYTICS_EVENT_NAMES`
 *   - call `trackClientEvent({ name: …, payload: … })`
 */

const STORAGE_KEY = "izenzo:client-analytics:v1";
export const CLIENT_ANALYTICS_DOM_EVENT = "izenzo:client-analytics";

/**
 * Surface where a clipboard interaction originated. Lets us tell apart
 * the inline "Copy" button on the persistent error alert from the
 * "Copy Ref" action button on the transient sonner toast - both write
 * the same value but their UX flavour is different.
 */
export type CopyRefSurface = "alert" | "toast";

export type CopyRefOutcome =
  | "success"
  /** navigator.clipboard.writeText threw (permission denied, insecure context, no API). */
  | "denied"
  /** Caller tried to copy but no requestId was available. */
  | "no_ref";

export type DownloadErrorReportOutcome =
  | "success"
  /** Browser/Blob API unavailable or threw. */
  | "failed";

export const CLIENT_ANALYTICS_EVENT_NAMES = {
  COPY_REF: "wad.attest_error.copy_ref",
  DOWNLOAD_ERROR_REPORT: "wad.attest_error.download_report",
} as const;

export type ClientAnalyticsEvent =
  | {
      name: typeof CLIENT_ANALYTICS_EVENT_NAMES.COPY_REF;
      payload: {
        surface: CopyRefSurface;
        outcome: CopyRefOutcome;
        /** Whether a requestId was available at click time (kept separate
         *  from outcome="no_ref" because future surfaces may want both). */
        hasRef: boolean;
        /** Context label so the same event can be reused outside attest. */
        context?: string;
        /** Reason string for failures (e.g. error.name). */
        reason?: string;
      };
    }
  | {
      name: typeof CLIENT_ANALYTICS_EVENT_NAMES.DOWNLOAD_ERROR_REPORT;
      payload: {
        outcome: DownloadErrorReportOutcome;
        /** Whether a requestId was included in the report. */
        hasRef: boolean;
        /** Context label so the same event can be reused outside attest. */
        context?: string;
        /** Error kind classification copied from the alert. */
        errorKind?: string;
        /** Reason string for failures (e.g. error.name). */
        reason?: string;
      };
    };

export type ClientAnalyticsEventName = ClientAnalyticsEvent["name"];

interface CounterEntry {
  total: number;
  /** ISO timestamp of most recent occurrence. */
  lastAt: string;
  /** Last payload we saw - handy when triaging from the debug panel. */
  lastPayload: Record<string, unknown>;
}

type CountersState = Record<string, CounterEntry>;

function readState(): CountersState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CountersState) : {};
  } catch {
    return {};
  }
}

function writeState(state: CountersState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full / disabled - best-effort */
  }
}

/** Build a stable bucket key per (event-name, outcome) combination. */
function bucketKey(event: ClientAnalyticsEvent): string {
  const parts: string[] = [event.name];
  if ("outcome" in event.payload && event.payload.outcome) {
    parts.push(event.payload.outcome);
  }
  return parts.join(":");
}

/**
 * Track a UI interaction. Safe to call from any render path - no-ops on
 * the server, swallows storage errors, never throws.
 */
export function trackClientEvent(event: ClientAnalyticsEvent): void {
  if (typeof window === "undefined") return;

  const state = readState();
  const key = bucketKey(event);
  const prior = state[key];
  const now = new Date().toISOString();
  state[key] = {
    total: (prior?.total ?? 0) + 1,
    lastAt: now,
    lastPayload: { ...event.payload },
  };
  writeState(state);

  // eslint-disable-next-line no-console
  console.info(
    `[client-analytics] ${event.name}`,
    event.payload,
  );

  window.dispatchEvent(
    new CustomEvent<ClientAnalyticsEvent & { at: string }>(
      CLIENT_ANALYTICS_DOM_EVENT,
      { detail: { ...event, at: now } as ClientAnalyticsEvent & { at: string } },
    ),
  );
}

/** Read the counter snapshot - for support / debug panels. */
export function getClientAnalyticsCounters(): CountersState {
  return readState();
}

/** Reset all counters. */
export function resetClientAnalyticsCounters(): void {
  writeState({});
}
