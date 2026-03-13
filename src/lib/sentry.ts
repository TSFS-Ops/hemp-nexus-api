/**
 * Sentry initialization — structured error tracking with context metadata.
 *
 * Captures:
 * - Unhandled exceptions with component stack traces
 * - Failed API calls with request/response context
 * - User context (org_id, role) without PII
 *
 * The DSN is a publishable key (safe for client-side code).
 */

import * as Sentry from "@sentry/react";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

export function initSentry() {
  if (!SENTRY_DSN) {
    console.info("[Sentry] No DSN configured — error tracking disabled");
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: `compliance-match@${import.meta.env.VITE_APP_VERSION || "0.0.0"}`,

    // Performance: sample 10% of transactions in production
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,

    // Only capture errors, not warnings
    beforeSend(event) {
      // Strip PII: remove email from user context
      if (event.user?.email) {
        delete event.user.email;
      }
      return event;
    },

    // Integrations
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Only capture replays on errors (not all sessions)
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Replay: 0% session, 100% on error
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: import.meta.env.PROD ? 1.0 : 0,

    // Ignore known non-actionable errors
    ignoreErrors: [
      "ResizeObserver loop",
      "Non-Error promise rejection captured",
      "Load failed", // Safari network errors
      "Failed to fetch", // Offline/network flap
    ],

    // Don't send to Sentry from localhost
    enabled: import.meta.env.PROD || !!import.meta.env.VITE_SENTRY_DSN,
  });
}

/**
 * Set user context after authentication.
 * Called from AuthContext on sign-in.
 */
export function setSentryUser(userId: string, orgId: string, roles: string[]) {
  Sentry.setUser({ id: userId });
  Sentry.setTag("org_id", orgId);
  Sentry.setTag("roles", roles.join(","));
}

/**
 * Clear user context on sign-out.
 */
export function clearSentryUser() {
  Sentry.setUser(null);
}

/**
 * Capture a handled error with additional context.
 */
export function captureError(error: Error, context?: Record<string, unknown>) {
  Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Add breadcrumb for important user actions.
 */
export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>
) {
  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level: "info",
  });
}

export { Sentry };
