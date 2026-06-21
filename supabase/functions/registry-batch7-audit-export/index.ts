/**
 * Batch 7 — Admin-only export of all Batch 7 registry claim, evidence,
 * conflict, correction, and outreach-block decisions.
 *
 * Authenticated user must have platform_admin role (enforced inside
 * the SECURITY DEFINER RPC admin_list_batch7_audit_events).
 *
 * Supports JSON (default) and CSV via ?format=csv. All exports include
 * the requestId correlation field extracted from the event payload.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY")!;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    }));
  }

  // Use the user-scoped client so RLS + has_role check inside the RPC apply.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Verify the caller is authenticated.
  const { data: userResult, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userResult.user) {
    return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    }));
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "json").toLowerCase();
  const fromIso = url.searchParams.get("from");
  const toIso   = url.searchParams.get("to");
  const limit   = Math.min(Number(url.searchParams.get("limit") ?? "500"), 5000);

  const { data, error } = await userClient.rpc("admin_list_batch7_audit_events", {
    p_from: fromIso || undefined,
    p_to:   toIso   || undefined,
    p_limit: limit,
  });
  if (error) {
    // forbidden via 42501 raised inside the RPC
    const code = (error as any).code === "42501" ? 403 : 500;
    return withCors(req, new Response(JSON.stringify({ error: error.message }), {
      status: code, headers: { "Content-Type": "application/json" },
    }));
  }

  const rows = data ?? [];

  // Audit the export itself.
  await svc.from("event_store").insert({
    event_name: "registry_batch7_audit_exported",
    aggregate_id: userResult.user.id,
    aggregate_type: "registry_batch7_audit_export",
    actor_id: userResult.user.id,
    payload: { format, row_count: rows.length, from: fromIso, to: toIso },
  }).catch(() => {});

  if (format === "csv") {
    const header = "occurred_at,event_name,aggregate_type,aggregate_id,actor_id,request_id,payload\n";
    const body = rows.map((r: any) => [
      r.occurred_at, r.event_name, r.aggregate_type, r.aggregate_id,
      r.actor_id ?? "", r.request_id ?? "", JSON.stringify(r.payload ?? {}),
    ].map(csvEscape).join(",")).join("\n");
    return withCors(req, new Response(header + body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="batch7-audit-${new Date().toISOString().slice(0,10)}.csv"`,
      },
    }));
  }

  return withCors(req, new Response(JSON.stringify({ ok: true, count: rows.length, rows }), {
    status: 200, headers: { "Content-Type": "application/json" },
  }));
});
