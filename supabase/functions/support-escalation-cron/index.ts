/**
 * support-escalation-cron
 * -----------------------
 * Runs periodically via pg_cron. Bumps the priority of open support tickets
 * whose first-response or resolution SLA deadlines have been breached and
 * that have not yet been auto-escalated for that gate.
 *
 * Auth: internal-only. Requires header `x-internal-key` matching the
 * `INTERNAL_CRON_KEY` secret. No JWT / user auth.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    const internalKey = Deno.env.get("INTERNAL_CRON_KEY");
    if (!internalKey) {
      return json({ error: "config_error", message: "INTERNAL_CRON_KEY not set" }, 500);
    }
    if (req.headers.get("x-internal-key") !== internalKey) {
      return json({ error: "unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client = createClient(supabaseUrl, serviceKey);

    const startedAt = Date.now();
    const { data, error } = await client.rpc("escalate_overdue_support_tickets");
    if (error) {
      console.error("escalate_overdue_support_tickets failed", error);
      return json({ error: "rpc_failed", message: error.message }, 500);
    }

    const rows = (data ?? []) as Array<{
      ticket_id: string;
      gate: string;
      from_priority: string;
      to_priority: string;
    }>;
    const summary = {
      escalated_count: rows.length,
      first_response: rows.filter((r) => r.gate === "first_response").length,
      resolution: rows.filter((r) => r.gate === "resolution").length,
      duration_ms: Date.now() - startedAt,
      escalations: rows,
    };
    console.log("support-escalation-cron", summary);
    return json({ ok: true, ...summary }, 200);
  } catch (e) {
    console.error("support-escalation-cron unexpected error", e);
    return json({ error: "internal_error", message: (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
