import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const EngagementStatusSchema = z.enum([
  "notification_sent",
  "contacted",
  "accepted",
  "declined",
  "expired",
]);

const UpdateEngagementSchema = z.object({
  engagement_status: EngagementStatusSchema.optional(),
  counterparty_email: z.string().email().optional(),
  admin_notes: z.string().max(2000).optional(),
});

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  notification_sent: ["contacted", "expired"],
  contacted: ["accepted", "declined", "expired"],
  accepted: [],
  declined: [],
  expired: [],
};

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  const corsResponse = handleCors(req, allowedOrigins);
  if (corsResponse) return corsResponse;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const rawParts = url.pathname.split("/").filter(Boolean);
    const parts = [...rawParts];
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "poi-engagements") parts.shift();

    const engagementId = parts[0];

    // ── GET /poi-engagements — List engagements (admin only) ──
    if (req.method === "GET" && !engagementId) {
      requireRole(authCtx, "admin");

      await checkRateLimit(supabase, authCtx.orgId, null, "poi-engagements", "admin:engagements");

      const statusFilter = url.searchParams.get("status");
      const typeFilter = url.searchParams.get("type");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);

      let query = supabase
        .from("poi_engagements")
        .select(`
          *,
          matches:match_id (
            id, commodity, quantity_amount, quantity_unit,
            price_amount, price_currency, match_type,
            buyer_name, seller_name, org_id, created_at,
            buyer_org_id, seller_org_id
          ),
          initiator_org:org_id ( id, name ),
          counterparty_org:counterparty_org_id ( id, name )
        `)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (statusFilter) {
        query = query.eq("engagement_status", statusFilter);
      }
      if (typeFilter) {
        query = query.eq("counterparty_type", typeFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      return new Response(JSON.stringify({ engagements: data }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── GET /poi-engagements/by-match/:matchId — Get engagement for a match ──
    if (req.method === "GET" && engagementId === "by-match" && parts[1]) {
      const matchId = parts[1];
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(matchId)) {
        throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);
      }

      const { data, error } = await supabase
        .from("poi_engagements")
        .select("*")
        .eq("match_id", matchId)
        .maybeSingle();

      if (error) throw error;

      return new Response(JSON.stringify({ engagement: data }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── PATCH /poi-engagements/:id — Update engagement (admin only) ──
    if (req.method === "PATCH" && engagementId) {
      requireRole(authCtx, "admin");

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(engagementId)) {
        throw new ApiException("VALIDATION_ERROR", "Invalid engagement ID format", 400);
      }

      const body = await req.json();
      const parsed = UpdateEngagementSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiException("VALIDATION_ERROR", JSON.stringify(parsed.error.flatten().fieldErrors), 400);
      }

      // Fetch current engagement
      const { data: current, error: fetchErr } = await supabase
        .from("poi_engagements")
        .select("*")
        .eq("id", engagementId)
        .single();

      if (fetchErr || !current) {
        throw new ApiException("NOT_FOUND", "Engagement not found", 404);
      }

      const updates: Record<string, unknown> = {};

      // Validate status transition
      if (parsed.data.engagement_status) {
        const currentStatus = current.engagement_status;
        const allowed = VALID_STATUS_TRANSITIONS[currentStatus] || [];
        if (!allowed.includes(parsed.data.engagement_status)) {
          throw new ApiException(
            "INVALID_TRANSITION",
            `Cannot transition from '${currentStatus}' to '${parsed.data.engagement_status}'. Allowed: [${allowed.join(", ")}]`,
            400
          );
        }
        updates.engagement_status = parsed.data.engagement_status;

        if (parsed.data.engagement_status === "contacted") {
          updates.contacted_at = new Date().toISOString();
        }
        if (["accepted", "declined"].includes(parsed.data.engagement_status)) {
          updates.responded_at = new Date().toISOString();
        }
      }

      if (parsed.data.counterparty_email !== undefined) {
        updates.counterparty_email = parsed.data.counterparty_email;
      }
      if (parsed.data.admin_notes !== undefined) {
        updates.admin_notes = parsed.data.admin_notes;
      }

      const { data: updated, error: updateErr } = await supabase
        .from("poi_engagements")
        .update(updates)
        .eq("id", engagementId)
        .select()
        .single();

      if (updateErr) throw updateErr;

      // Audit log
      await supabase.from("admin_audit_logs").insert({
        admin_user_id: authCtx.userId,
        action: "engagement.updated",
        target_type: "poi_engagement",
        target_id: engagementId,
        details: {
          request_id: requestId,
          match_id: current.match_id,
          previous_status: current.engagement_status,
          new_status: updates.engagement_status || current.engagement_status,
          counterparty_email: updates.counterparty_email || null,
        },
      });

      console.log(`[${requestId}] Engagement ${engagementId} updated: ${current.engagement_status} → ${updates.engagement_status || "(no status change)"}`);

      return new Response(JSON.stringify({ engagement: updated }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    throw new ApiException("NOT_FOUND", "Endpoint not found", 404);
  } catch (error) {
    console.error(`[${requestId}] poi-engagements error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
