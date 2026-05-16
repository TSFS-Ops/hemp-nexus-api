/**
 * OPS-001 Stage 2 — Backend Sentry helper.
 *
 * Lightweight, dependency-free wrapper around Sentry's HTTP envelope endpoint
 * for Deno edge functions. Designed to:
 *
 *   - read SENTRY_BACKEND_DSN (preferred) or SENTRY_DSN from runtime env
 *   - no-op safely when the DSN is missing (never throw, never fail callers)
 *   - never transmit secrets, request bodies, auth headers, API keys, or
 *     tokens — only typed event/message fields the caller passes in
 *
 * Usage:
 *   import { captureException, captureMessage, sentryDsnConfigured } from
 *     "../_shared/sentry.ts";
 *   try { ... } catch (err) { await captureException(err, { tags: { fn: "x" } }); }
 */

export type SentryTags = Record<string, string | number | boolean>;
export type SentryLevel = "fatal" | "error" | "warning" | "info" | "debug";

export interface SentryEventOptions {
  level?: SentryLevel;
  tags?: SentryTags;
  /** Free-form, NON-SENSITIVE context. Callers must not pass secrets. */
  extra?: Record<string, unknown>;
  /** Logical source ("edge:idv-verify", etc). Stored as `server_name`. */
  source?: string;
}

export interface SentryDispatchResult {
  ok: boolean;
  status: number | null;
  /** event_id Sentry assigned, when the response contained one. */
  event_id: string | null;
  error: string | null;
  dsn_configured: boolean;
}

interface ParsedDsn {
  publicKey: string;
  projectId: string;
  ingestUrl: string;
}

function readDsn(): string | null {
  const dsn =
    Deno.env.get("SENTRY_BACKEND_DSN") ??
    Deno.env.get("SENTRY_DSN") ??
    null;
  return dsn && dsn.trim().length > 0 ? dsn.trim() : null;
}

export function sentryDsnConfigured(): boolean {
  return readDsn() !== null;
}

function parseDsn(dsn: string): ParsedDsn | null {
  // Format: https://<publicKey>@<host>[:port]/<projectId>
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\/+/, "").split("/").pop() ?? "";
    if (!publicKey || !projectId) return null;
    const ingestUrl = `${u.protocol}//${u.host}/api/${projectId}/envelope/`;
    return { publicKey, projectId, ingestUrl };
  } catch {
    return null;
  }
}

function sentryAuthHeader(publicKey: string): string {
  return [
    "Sentry sentry_version=7",
    "sentry_client=izenzo-backend/1.0",
    `sentry_key=${publicKey}`,
  ].join(", ");
}

/**
 * Internal: send a typed event payload through Sentry's envelope endpoint.
 * Returns a structured result — never throws.
 */
async function dispatchEnvelope(
  payload: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<SentryDispatchResult> {
  const dsn = readDsn();
  if (!dsn) {
    return {
      ok: false,
      status: null,
      event_id: null,
      error: "dsn_missing",
      dsn_configured: false,
    };
  }
  const parsed = parseDsn(dsn);
  if (!parsed) {
    return {
      ok: false,
      status: null,
      event_id: null,
      error: "dsn_invalid",
      dsn_configured: true,
    };
  }
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const event = { ...payload, event_id: eventId };
  const envelope = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");

  try {
    const res = await fetch(parsed.ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": sentryAuthHeader(parsed.publicKey),
      },
      body: envelope,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let returnedEventId: string | null = null;
    try {
      const body = (await res.json()) as { id?: string };
      if (typeof body?.id === "string") returnedEventId = body.id;
    } catch {
      // Sentry occasionally returns empty body on 200 — that's fine.
    }
    return {
      ok: res.ok,
      status: res.status,
      event_id: returnedEventId ?? eventId,
      error: res.ok ? null : `http_${res.status}`,
      dsn_configured: true,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      event_id: null,
      error: (err as Error).message || "fetch_failed",
      dsn_configured: true,
    };
  }
}

export async function captureMessage(
  message: string,
  opts: SentryEventOptions = {},
): Promise<SentryDispatchResult> {
  return dispatchEnvelope({
    message,
    level: opts.level ?? "info",
    tags: opts.tags ?? {},
    extra: opts.extra ?? {},
    server_name: opts.source ?? "edge",
    platform: "javascript",
    timestamp: Math.floor(Date.now() / 1000),
  });
}

export async function captureException(
  err: unknown,
  opts: SentryEventOptions = {},
): Promise<SentryDispatchResult> {
  const e = err instanceof Error ? err : new Error(String(err));
  return dispatchEnvelope({
    level: opts.level ?? "error",
    tags: opts.tags ?? {},
    extra: opts.extra ?? {},
    server_name: opts.source ?? "edge",
    platform: "javascript",
    timestamp: Math.floor(Date.now() / 1000),
    exception: {
      values: [
        {
          type: e.name || "Error",
          value: e.message || "unknown",
          stacktrace: e.stack ? { frames: [{ filename: "edge", function: e.stack.split("\n")[0] }] } : undefined,
        },
      ],
    },
  });
}

/**
 * Synthetic heartbeat ping for the sentry-heartbeat edge function.
 * Tagged so the team can filter it out of incident dashboards.
 */
export async function sendHeartbeatEvent(): Promise<SentryDispatchResult> {
  return captureMessage("izenzo.backend.sentry_heartbeat", {
    level: "info",
    tags: { kind: "heartbeat", source: "sentry-heartbeat" },
    source: "edge:sentry-heartbeat",
  });
}
