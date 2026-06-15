/**
 * install-edge-invoke-shim
 * ────────────────────────
 * Single-chokepoint hardening for `supabase.functions.invoke()` calls.
 *
 * Why this exists
 *   The platform has dozens of legacy callers using `supabase.functions.invoke()`
 *   directly. Migrating each to `invokeEdgeFunction` was incremental and left
 *   gaps. This shim wraps the singleton's `invoke` method ONCE at boot so that
 *   every existing caller - without code changes - gets:
 *
 *     1. Pre-flight access-token freshness check (auto-refresh if <30s left).
 *     2. Friendly translation of 401/403/429/503 server statuses into the
 *        EdgeInvokeError messages defined in `edge-invoke.ts`.
 *
 *   Callers that already use `invokeEdgeFunction`/`fetchEdgeFunction` are
 *   unaffected (they call `auth.refreshSession()` themselves before reaching
 *   `invoke`).
 *
 * Safety
 *   The wrapper preserves the original signature and return shape exactly:
 *   `{ data, error }`. On a translated error we return `{ data: null, error }`
 *   with `error` being an `EdgeInvokeError` (which extends `Error`), so any
 *   caller that does `if (error) toast.error(error.message)` immediately
 *   surfaces the friendly copy.
 */
import { supabase } from "@/integrations/supabase/client";
import { EdgeInvokeError, refreshSessionOnce } from "@/lib/edge-invoke";

const REFRESH_SKEW_MS = 30_000;
const UUID_FUNCTION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/|$)/i;
const SERVER_UNAUTHORIZED_MESSAGE =
  "We could not verify your access for this action. Please refresh the page and try again.";

let installed = false;

export function installEdgeInvokeShim(): void {
  if (installed) return;
  installed = true;

  const fnApi = supabase.functions as unknown as {
    invoke: (name: string, opts?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  };
  const original = fnApi.invoke.bind(supabase.functions);

  const ensureFresh = async (): Promise<void> => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) return; // unauth or transient - let server respond
    const exp = data.session.expires_at;
    if (!exp) return;
    if (exp * 1000 - Date.now() < REFRESH_SKEW_MS) {
      await refreshSessionOnce();
    }
  };

  const translate = async (name: string, errLike: unknown): Promise<EdgeInvokeError> => {
    const ctx = (errLike as { context?: Response })?.context;
    let body = "";
    let status: number | undefined;
    if (ctx && typeof ctx.text === "function") {
      status = ctx.status;
      try { body = await ctx.clone().text(); } catch { /* ignore */ }
    }
    let parsed: { error?: string; code?: string; message?: string } | null = null;
    if (body) { try { parsed = JSON.parse(body); } catch { /* not JSON */ } }
    const serverMsg = parsed?.error || parsed?.message || "";
    const serverCode = parsed?.code || "";

    if (status === 401 || /unauthorized/i.test(serverMsg) || /unauthorized/i.test(body)) {
      return new EdgeInvokeError(
        SERVER_UNAUTHORIZED_MESSAGE,
        { status, code: "UNAUTHORIZED", serverBody: body },
      );
    }
    if (status === 403 || /forbidden/i.test(serverMsg)) {
      return new EdgeInvokeError(
        "You don't have permission to perform this action. Contact an administrator if you believe this is a mistake.",
        { status, code: "FORBIDDEN", serverBody: body },
      );
    }
    if (status === 429 || /rate.?limit/i.test(serverMsg)) {
      return new EdgeInvokeError(
        "You're doing that too quickly. Please wait a moment and try again.",
        { status, code: "RATE_LIMITED", serverBody: body },
      );
    }
    if (status === 503 || serverCode === "MAINTENANCE_MODE" || /maintenance/i.test(serverMsg)) {
      return new EdgeInvokeError(
        "The platform is in maintenance mode. Please try again shortly.",
        { status, code: "MAINTENANCE_MODE", serverBody: body },
      );
    }
    return new EdgeInvokeError(
      serverMsg ? `Could not complete request (${name}) - ${serverMsg}` : `Edge function ${name} failed`,
      { status, code: serverCode, serverBody: body },
    );
  };

  fnApi.invoke = async (name: string, opts?: Record<string, unknown>) => {
    if (UUID_FUNCTION_RE.test(name)) {
      return {
        data: null,
        error: new EdgeInvokeError(
          "This action could not be completed because the backend request was routed incorrectly. Please refresh and try again.",
          {
            status: 400,
            code: "INVALID_FUNCTION_PATH",
            serverBody: `Refused to call UUID as edge function name: ${name}`,
            context: name,
          },
        ),
      };
    }
    try { await ensureFresh(); } catch { /* don't block invoke on refresh hiccup */ }
    const res = await original(name, opts);
    if (res.error) {
      const friendly = await translate(name, res.error);
      return { data: null, error: friendly };
    }
    return res;
  };
}
