/**
 * facilitation-health-probe — aggregator
 *
 * Platform-admin-only. Fans out lightweight GET probes (?__health=1) to every
 * facilitation-* edge function and returns a flat array describing reachability,
 * latency, and any error envelope. No mutations. No outreach.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { handleHealthProbe } from "../_shared/health.ts";

const FUNCTIONS: readonly string[] = [
  "facilitation-case-admin-action",
  "facilitation-case-eligible-owners",
  "facilitation-case-search-organisations",
  "facilitation-case-sla-evaluate",
  "facilitation-export-csv",
  "facilitation-export-evidence-pack",
  "facilitation-invite-unopened-detector",
  "facilitation-management-metrics",
  "facilitation-outreach-candidate-add",
  "facilitation-outreach-dnc-add",
  "facilitation-outreach-dnc-revoke",
  "facilitation-outreach-escalate",
  "facilitation-outreach-escalation-resolve",
  "facilitation-outreach-send",
  "facilitation-outreach-template-status",
  "facilitation-template-editor",
];

const TIMEOUT_MS = 5000;

function json(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

async function probe(baseUrl: string, anon: string, fn: string) {
  const url = `${baseUrl}/functions/v1/${fn}?__health=1`;
  const started = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctl.signal,
      headers: {
        "x-health-probe": "1",
        "apikey": anon,
        "Authorization": `Bearer ${anon}`,
      },
    });
    const latency_ms = Date.now() - started;
    const reqId = res.headers.get("x-request-id")
      ?? res.headers.get("sb-request-id")
      ?? res.headers.get("cf-ray");
    let body: unknown = null;
    let bodyText = "";
    try {
      bodyText = await res.text();
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      body = bodyText.slice(0, 240);
    }
    const ok = res.ok && typeof body === "object" && body !== null && (body as Record<string, unknown>).ok === true;
    return {
      fn,
      ok,
      status: res.status,
      latency_ms,
      request_id: reqId,
      version: (body as Record<string, unknown> | null)?.version ?? null,
      probe_response: (body as Record<string, unknown> | null)?.fn === fn,
      error: ok ? null : (typeof body === "object" && body !== null ? body : { raw: String(body).slice(0, 240) }),
    };
  } catch (err) {
    return {
      fn,
      ok: false,
      status: 0,
      latency_ms: Date.now() - started,
      request_id: null,
      version: null,
      probe_response: false,
      error: { message: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  const __hp = handleHealthProbe(req, "facilitation-health-probe");
  if (__hp) return __hp;

  if (req.method !== "GET" && req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

  // platform_admin gate
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(req, { error: "Unauthorized" }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: cerr } = await userClient.auth.getClaims(token);
  if (cerr || !claims?.claims?.sub) return json(req, { error: "Unauthorized" }, 401);

  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service);
  const userId = claims.claims.sub as string;
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "platform_admin" });
  if (!isAdmin) return json(req, { error: "Forbidden" }, 403);

  const probes = await Promise.all(FUNCTIONS.map((f) => probe(url, anon, f)));

  const summary = {
    total: probes.length,
    healthy: probes.filter((p) => p.ok).length,
    degraded: probes.filter((p) => !p.ok).length,
    checked_at: new Date().toISOString(),
  };

  return json(req, { summary, probes });
});
