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

const TARGETS: ReadonlyArray<{ host: string; url: string }> = [
  { host: "www.payfast.co.za", url: "https://www.payfast.co.za/eng/process" },
  { host: "payment.payfast.io", url: "https://payment.payfast.io/" },
];

const TIMEOUT_MS = 5000;

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
  // The card-capture host is the one that drives the customer-facing
  // "refused to connect" surface. If it fails, surface that distinctly
  // so the UI can be specific.
  const cardCapture = probes.find((p) => p.host === "payment.payfast.io") ?? null;
  const processHost = probes.find((p) => p.host === "www.payfast.co.za") ?? null;

  const status: "ok" | "degraded" | "unavailable" = reachable
    ? "ok"
    : processHost?.ok && !cardCapture?.ok
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
