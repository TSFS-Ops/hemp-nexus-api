// payfast-connectivity-probe
//
// Server-side reachability probe for PayFast's two customer-facing hosts:
//
//   1. https://www.payfast.co.za/eng/process     (signed-form POST target)
//   2. https://payment.payfast.io/                (hosted card-capture page —
//      the host that has been intermittently returning "refused to connect"
//      in customer browsers)
//
// The browser cannot probe these directly (no CORS, opaque responses), so
// this function does it from the edge runtime and reports a small,
// non-sensitive shape the checkout UI can use to render a friendly
// "provider temporarily unavailable" state BEFORE the customer is
// redirected away.
//
// This probe does NOT change any business state, never reads PayFast
// merchant secrets, and is safe to call from any authenticated client.
// It is connectivity-only — a healthy 2xx/3xx response from either host
// counts as reachable.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface HostProbe {
  host: string;
  url: string;
  ok: boolean;
  status: number | null;
  durationMs: number;
  error: string | null;
}

/**
 * Targets resolve from env overrides, then fall back to PayFast's
 * documented defaults. Override env vars (set via project secrets):
 *
 *   PAYFAST_PROBE_PROCESS_URL   default: https://www.payfast.co.za/eng/process
 *   PAYFAST_PROBE_HOSTED_URL    default: https://payment.payfast.io/
 *   PAYFAST_PROBE_TIMEOUT_MS    default: 5000  (min 500, max 30000)
 *
 * `PAYFAST_PROCESS_URL_LIVE` is honoured as a fallback so the probe and
 * checkout point at the same host without configuring twice.
 */
function envFirst(...names: string[]): string {
  for (const n of names) {
    const v = (Deno.env.get(n) ?? "").trim();
    if (v) return v;
  }
  return "";
}

function hostOf(url: string, fallback: string): string {
  try {
    return new URL(url).host;
  } catch {
    return fallback;
  }
}

const PROCESS_URL =
  envFirst("PAYFAST_PROBE_PROCESS_URL", "PAYFAST_PROCESS_URL_LIVE", "PAYFAST_PROCESS_URL")
  || "https://www.payfast.co.za/eng/process";
const HOSTED_URL =
  envFirst("PAYFAST_PROBE_HOSTED_URL", "PAYFAST_HOSTED_URL")
  || "https://payment.payfast.io/";

const TARGETS: ReadonlyArray<{ host: string; url: string }> = [
  { host: hostOf(PROCESS_URL, "www.payfast.co.za"), url: PROCESS_URL },
  { host: hostOf(HOSTED_URL, "payment.payfast.io"), url: HOSTED_URL },
];

const TIMEOUT_MS = (() => {
  const raw = Number.parseInt(Deno.env.get("PAYFAST_PROBE_TIMEOUT_MS") ?? "", 10);
  if (!Number.isFinite(raw)) return 5000;
  return Math.min(30000, Math.max(500, raw));
})();

async function probeHost(target: { host: string; url: string }): Promise<HostProbe> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // GET (not HEAD) — some PayFast hosts return 405 on HEAD.
    // We don't care about the body; redirect: "manual" so a 3xx still
    // counts as "host is reachable".
    const res = await fetch(target.url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "izenzo-connectivity-probe/1.0" },
    });
    const durationMs = Math.round(performance.now() - started);
    const status = res.status;
    // Anything from the host (1xx-5xx) means the TCP/TLS/HTTP path is
    // alive. The browser-side "refused to connect" is a connection
    // error, not an HTTP status.
    return {
      host: target.host,
      url: target.url,
      ok: status > 0 && status < 600,
      status,
      durationMs,
      error: null,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    const name = err instanceof Error ? err.name : "UnknownError";
    const message = err instanceof Error ? err.message : String(err);
    return {
      host: target.host,
      url: target.url,
      ok: false,
      status: null,
      durationMs,
      error: name === "AbortError" ? `timeout_${TIMEOUT_MS}ms` : `${name}: ${message}`.slice(0, 200),
    };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, reason: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const probes = await Promise.all(TARGETS.map(probeHost));
  const reachable = probes.every((p) => p.ok);
  // TARGETS[0] is the form-POST process host, TARGETS[1] is the
  // hosted card-capture host (the user-visible "refused to connect"
  // surface). Use the resolved hosts so env overrides classify
  // correctly.
  const processHost = probes[0] ?? null;
  const cardCapture = probes[1] ?? null;

  const status: "ok" | "degraded" | "unavailable" = reachable
    ? "ok"
    : processHost?.ok && cardCapture && !cardCapture.ok
      ? "degraded"
      : "unavailable";

  return new Response(
    JSON.stringify({
      ok: true,
      checkedAt: new Date().toISOString(),
      status,
      reachable,
      probes,
    }),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        // Allow brief edge caching so a checkout page render does not
        // hammer PayFast on every mount.
        "Cache-Control": "public, max-age=30",
      },
    },
  );
});
