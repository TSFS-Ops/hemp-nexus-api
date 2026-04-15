import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const EngagementStatusSchema = z.enum([
  "pending",
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
  contact_method: z.enum(["email", "phone", "linkedin", "whatsapp", "in_person", "other"]).optional(),
  contact_detail: z.string().max(500).optional(),
  contact_date: z.string().datetime().optional(),
});

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ["notification_sent", "contacted", "expired"],
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

    // ── GET /poi-engagements/:id/outreach-log — Immutable outreach history ──
    if (req.method === "GET" && engagementId && parts[1] === "outreach-log") {
      requireRole(authCtx, "admin");

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(engagementId)) {
        throw new ApiException("VALIDATION_ERROR", "Invalid engagement ID format", 400);
      }

      const { data: logs, error } = await supabase
        .from("engagement_outreach_logs")
        .select("*")
        .eq("engagement_id", engagementId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      return new Response(JSON.stringify({ logs: logs || [] }), {
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
          // ── SERVER-SIDE ENFORCEMENT: contact_method + contact_detail mandatory ──
          if (!parsed.data.contact_method) {
            throw new ApiException(
              "VALIDATION_ERROR",
              "contact_method is required when marking engagement as contacted",
              400
            );
          }
          if (!parsed.data.contact_detail) {
            throw new ApiException(
              "VALIDATION_ERROR",
              "contact_detail is required (email address, phone number, or LinkedIn URL)",
              400
            );
          }
          updates.contacted_at = new Date().toISOString();
          updates.contact_method = parsed.data.contact_method;
          if (parsed.data.contact_date) {
            updates.contact_date = parsed.data.contact_date;
          } else {
            updates.contact_date = new Date().toISOString();
          }
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
      if (parsed.data.contact_method !== undefined) {
        updates.contact_method = parsed.data.contact_method;
      }
      if (parsed.data.contact_date !== undefined) {
        updates.contact_date = parsed.data.contact_date;
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

      // ── Immutable outreach log (if status changed and contact details provided) ──
      if (updates.engagement_status && parsed.data.contact_method && parsed.data.contact_detail) {
        // Fetch admin profile for snapshot
        const { data: adminProfile } = await supabase
          .from("profiles")
          .select("email, full_name")
          .eq("id", authCtx.userId)
          .single();

        await supabase.from("engagement_outreach_logs").insert({
          engagement_id: engagementId,
          admin_user_id: authCtx.userId,
          admin_email: adminProfile?.email || "unknown",
          admin_name: adminProfile?.full_name || null,
          contact_method: parsed.data.contact_method,
          contact_detail: parsed.data.contact_detail,
          previous_status: current.engagement_status,
          new_status: updates.engagement_status as string,
          notes: parsed.data.admin_notes || null,
        });
      }

      console.log(`[${requestId}] Engagement ${engagementId} updated: ${current.engagement_status} → ${updates.engagement_status || "(no status change)"}`);

      return new Response(JSON.stringify({ engagement: updated }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── POST /poi-engagements/respond/:matchId — Counterparty accepts/declines ──
    if (req.method === "POST" && engagementId === "respond" && parts[1]) {
      const matchId = parts[1];
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(matchId)) {
        throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);
      }

      const body = await req.json();
      const ResponseSchema = z.object({
        action: z.enum(["accepted", "declined"]),
      });
      const parsed = ResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiException("VALIDATION_ERROR", "action must be 'accepted' or 'declined'", 400);
      }

      // Fetch the engagement for this match
      const { data: engagement, error: engErr } = await supabase
        .from("poi_engagements")
        .select("*")
        .eq("match_id", matchId)
        .maybeSingle();

      if (engErr) throw engErr;
      if (!engagement) {
        throw new ApiException("NOT_FOUND", "No engagement found for this match", 404);
      }

      // Verify the caller is the counterparty (their org_id matches counterparty_org_id,
      // or they are listed as buyer/seller on the match but are NOT the initiating org)
      const { data: matchData, error: matchErr } = await supabase
        .from("matches")
        .select("org_id, buyer_org_id, seller_org_id")
        .eq("id", matchId)
        .single();

      if (matchErr || !matchData) {
        throw new ApiException("NOT_FOUND", "Match not found", 404);
      }

      const isCounterparty =
        (engagement.counterparty_org_id && engagement.counterparty_org_id === authCtx.orgId) ||
        (matchData.org_id !== authCtx.orgId &&
          (matchData.buyer_org_id === authCtx.orgId || matchData.seller_org_id === authCtx.orgId));

      if (!isCounterparty) {
        throw new ApiException("FORBIDDEN", "Only the counterparty can respond to this engagement", 403);
      }

      // Validate status transition
      const currentStatus = engagement.engagement_status;
      const allowed = VALID_STATUS_TRANSITIONS[currentStatus] || [];
      if (!allowed.includes(parsed.data.action)) {
        throw new ApiException(
          "INVALID_TRANSITION",
          `Cannot transition from '${currentStatus}' to '${parsed.data.action}'. Allowed: [${allowed.join(", ")}]`,
          400
        );
      }

      const updates: Record<string, unknown> = {
        engagement_status: parsed.data.action,
        responded_at: new Date().toISOString(),
      };

      const { data: updated, error: updateErr } = await supabase
        .from("poi_engagements")
        .update(updates)
        .eq("id", engagement.id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      // Audit log
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        action: "engagement.counterparty_responded",
        entity_type: "poi_engagement",
        entity_id: engagement.id,
        actor_user_id: authCtx.userId,
        metadata: {
          request_id: requestId,
          match_id: matchId,
          previous_status: currentStatus,
          new_status: parsed.data.action,
        },
      });

      console.log(`[${requestId}] Counterparty ${authCtx.orgId} responded '${parsed.data.action}' on engagement ${engagement.id}`);

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
