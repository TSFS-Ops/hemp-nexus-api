// Shared health-probe helper for edge functions.
//
// Each function calls `handleHealthProbe(req, "function-name")` immediately
// after the CORS preflight short-circuit. If the request is a health probe
// (header `x-health-probe: 1` OR query `?__health=1`) the function responds
// 200 with a small JSON envelope and skips all auth / business logic.
//
// Probes deliberately bypass auth so the aggregator can verify deployment
// reachability with a service-role internal key. The body is non-sensitive:
//   { ok: true, fn, version, now, uptime_ms }
//
// Use only for liveness/readiness — never echo secrets.
import { withCors } from "./cors.ts";

const BOOT_AT = Date.now();

export const HEALTH_HEADER = "x-health-probe";

export function isHealthProbe(req: Request): boolean {
  try {
    if (req.headers.get(HEALTH_HEADER) === "1") return true;
    const u = new URL(req.url);
    if (u.searchParams.get("__health") === "1") return true;
  } catch { /* ignore */ }
  return false;
}

export function handleHealthProbe(
  req: Request,
  fnName: string,
  version: string = "1",
): Response | null {
  if (!isHealthProbe(req)) return null;
  const body = {
    ok: true,
    fn: fnName,
    version,
    now: new Date().toISOString(),
    uptime_ms: Date.now() - BOOT_AT,
  };
  return withCors(req, new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "x-health-probe-response": "1" },
  }));
}
