/**
 * admin-engagement-delivery-status
 * ────────────────────────────────
 * Read-only admin endpoint that returns per-engagement outreach email
 * delivery status, derived from `email_send_log`.
 *
 * Linkage: every outreach send queued by `poi-engagements/:id/send-outreach`
 * writes an `email_send_log` row with `idempotency_key` prefixed
 *   `outreach-send-<engagement_id>-…`
 * We look up the LATEST row per engagement_id (by created_at DESC) and map
 * the raw status to a small, stable vocabulary the UI/admin dashboards can
 * rely on without having to re-implement the dedupe rule.
 *
 * Mapped statuses:
 *   - queued       (email_send_log.status = 'pending')
 *   - sent
 *   - failed
 *   - dlq
 *   - bounced
 *   - complained
 *   - suppressed
 *   - not_linked   (no email_send_log row found for this engagement)
 *
 * UI-003/NOT-001/NOT-006 alignment: this endpoint is the single source of
 * truth for "did the outreach actually go out?". It NEVER claims an email
 * was sent unless the provider proved it.
 *
 * Auth: requires a valid Supabase user JWT belonging to a platform admin.
 *       This is read-only — no mutations, no side effects.
 *
 * Request shapes:
 *   GET  /admin-engagement-delivery-status?engagement_id=<uuid>
 *   GET  /admin-engagement-delivery-status?engagement_ids=<uuid>,<uuid>,...
 *   POST { "engagement_ids": ["<uuid>", "<uuid>", ...] }
 *
 * Response: { results: Array<DeliveryStatus> }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type MappedStatus =
  | "queued"
  | "sent"
  | "failed"
  | "dlq"
  | "bounced"
  | "complained"
  | "suppressed"
  | "not_linked";

interface DeliveryStatus {
  engagement_id: string;
  status: MappedStatus;
  raw_status: string | null;
  sent_at: string | null;
  error_message: string | null;
  message_id: string | null;
  /** Plain-English reason this engagement is in `not_linked` state. */
  not_linked_reason?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_IDS = 200;

function jsonResponse(req: Request, body: unknown, status = 200) {
  return withCors(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  );
}

function mapStatus(raw: string | null | undefined): MappedStatus {
  switch ((raw ?? "").toLowerCase()) {
    case "pending":
      return "queued";
    case "sent":
      return "sent";
    case "dlq":
      return "dlq";
    case "failed":
      return "failed";
    case "bounced":
      return "bounced";
    case "complained":
      return "complained";
    case "suppressed":
      return "suppressed";
    default:
      // Unknown raw status — treat as not_linked so callers don't render a
      // green/sent badge for an unrecognised value.
      return "not_linked";
  }
}

function parseIds(req: Request, url: URL): { ids: string[]; error?: string } {
  const collected: string[] = [];
  const single = url.searchParams.get("engagement_id");
  if (single) collected.push(single);
  const many = url.searchParams.get("engagement_ids");
  if (many) {
    for (const part of many.split(",")) {
      const t = part.trim();
      if (t) collected.push(t);
    }
  }
  // Dedupe + validate.
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of collected) {
    const v = raw.trim().toLowerCase();
    if (!UUID_RE.test(v)) {
      return { ids: [], error: `Invalid engagement_id: ${raw}` };
    }
    if (!seen.has(v)) {
      seen.add(v);
      ids.push(v);
    }
  }
  return { ids };
}

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Auth ────────────────────────────────────────────────────────────
    const authHeader =
      req.headers.get("Authorization") ?? req.headers.get("authorisation");
    if (!authHeader) {
      return jsonResponse(req, { error: "Unauthorised" }, 401);
    }
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user: caller }, error: authError } =
      await supabaseAdmin.auth.getUser(token);
    if (authError || !caller) {
      return jsonResponse(req, { error: "Invalid token" }, 401);
    }
    const { data: isAdmin, error: roleErr } = await supabaseAdmin.rpc(
      "is_admin",
      { user_id: caller.id },
    );
    if (roleErr) {
      console.error("[admin-engagement-delivery-status] is_admin RPC failed:", roleErr);
      return jsonResponse(req, { error: "Authorisation check failed" }, 500);
    }
    if (!isAdmin) {
      return jsonResponse(req, { error: "Admin access required" }, 403);
    }

    // ── Parse engagement IDs ────────────────────────────────────────────
    const url = new URL(req.url);
    let ids: string[] = [];

    if (req.method === "GET") {
      const parsed = parseIds(req, url);
      if (parsed.error) return jsonResponse(req, { error: parsed.error }, 400);
      ids = parsed.ids;
    } else if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        const text = await req.text();
        if (text.trim()) body = JSON.parse(text);
      } catch {
        return jsonResponse(req, { error: "Invalid JSON body" }, 400);
      }
      const raw = body.engagement_ids;
      if (!Array.isArray(raw)) {
        return jsonResponse(
          req,
          { error: "Body must include engagement_ids: string[]" },
          400,
        );
      }
      const seen = new Set<string>();
      for (const r of raw) {
        if (typeof r !== "string") {
          return jsonResponse(
            req,
            { error: "engagement_ids entries must be strings" },
            400,
          );
        }
        const v = r.trim().toLowerCase();
        if (!UUID_RE.test(v)) {
          return jsonResponse(
            req,
            { error: `Invalid engagement_id: ${r}` },
            400,
          );
        }
        if (!seen.has(v)) {
          seen.add(v);
          ids.push(v);
        }
      }
    } else {
      return jsonResponse(req, { error: "Method not allowed" }, 405);
    }

    if (ids.length === 0) {
      return jsonResponse(req, { error: "No engagement_id(s) provided" }, 400);
    }
    if (ids.length > MAX_IDS) {
      return jsonResponse(
        req,
        { error: `Too many engagement_ids (max ${MAX_IDS})` },
        400,
      );
    }

    // ── Verify engagements exist (so "not_linked" means "no outreach yet",
    //    and unknown IDs return a clear not_linked_reason). ─────────────
    const { data: engagementRows, error: engErr } = await supabaseAdmin
      .from("poi_engagements")
      .select("id")
      .in("id", ids);

    if (engErr) {
      console.error(
        "[admin-engagement-delivery-status] failed to verify engagements:",
        engErr,
      );
      return jsonResponse(
        req,
        { error: "Failed to verify engagements" },
        500,
      );
    }
    const knownIds = new Set((engagementRows ?? []).map((r) => String(r.id)));

    // ── Look up latest email_send_log row per engagement_id by prefix ──
    // We issue one query per engagement (small N, capped at MAX_IDS) with a
    // tight LIMIT 1 ordered by created_at DESC. This keeps each query
    // index-friendly and avoids having to fetch + group every outreach row
    // ever logged.
    const lookups = await Promise.all(
      ids.map(async (id): Promise<DeliveryStatus> => {
        if (!knownIds.has(id)) {
          return {
            engagement_id: id,
            status: "not_linked",
            raw_status: null,
            sent_at: null,
            error_message: null,
            message_id: null,
            not_linked_reason: "Engagement not found",
          };
        }

        const { data, error } = await supabaseAdmin
          .from("email_send_log")
          .select("status, created_at, error_message, message_id")
          .like("idempotency_key", `outreach-send-${id}-%`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error(
            `[admin-engagement-delivery-status] lookup failed for ${id}:`,
            error,
          );
          return {
            engagement_id: id,
            status: "not_linked",
            raw_status: null,
            sent_at: null,
            error_message: null,
            message_id: null,
            not_linked_reason: "Email log lookup failed",
          };
        }

        if (!data) {
          return {
            engagement_id: id,
            status: "not_linked",
            raw_status: null,
            sent_at: null,
            error_message: null,
            message_id: null,
            not_linked_reason:
              "No outreach email has been queued for this engagement",
          };
        }

        const raw = (data as { status: string | null }).status ?? null;
        const mapped = mapStatus(raw);
        return {
          engagement_id: id,
          status: mapped,
          raw_status: raw,
          sent_at:
            mapped === "sent"
              ? String((data as { created_at: string }).created_at)
              : null,
          error_message:
            (data as { error_message: string | null }).error_message ?? null,
          message_id:
            (data as { message_id: string | null }).message_id ?? null,
          ...(mapped === "not_linked"
            ? {
                not_linked_reason: `Unrecognised email_send_log status: ${raw ?? "null"}`,
              }
            : {}),
        };
      }),
    );

    return jsonResponse(req, { results: lookups }, 200);
  } catch (err) {
    console.error("[admin-engagement-delivery-status] unhandled:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
});
