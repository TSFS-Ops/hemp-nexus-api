import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import {
  cachedResponseToHttp,
  lookupIdempotentResponse,
  storeIdempotentResponse,
} from "../_shared/idempotency.ts";

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
  counterparty_email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, { message: "counterparty_email is too short" })
    .max(254, { message: "counterparty_email exceeds 254 characters" })
    .email({ message: "counterparty_email must be a valid email address" })
    .optional(),
  admin_notes: z.string().max(2000).optional(),
  // Admin-only reviewer/support-desk notes. Empty string = clear the field.
  support_notes: z.string().max(4000).optional(),
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
      // Default scope = "unknown" because this listing powers the unknown-counterparty
      // outreach console. Pass ?type=all (or any non-"unknown" value) to opt out.
      const scopedType = typeFilter ?? "unknown";
      if (scopedType !== "all") {
        query = query.eq("counterparty_type", scopedType);
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

    // ── POST /poi-engagements/:id/preview-outreach — Render the outreach email
    // for admin review BEFORE sending. Returns subject, suggested body parts, and
    // recipient + suppression status. Does NOT send and does NOT mutate state. ──
    if (req.method === "POST" && engagementId && parts[1] === "preview-outreach") {
      requireRole(authCtx, "admin");

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(engagementId)) {
        throw new ApiException("VALIDATION_ERROR", "Invalid engagement ID format", 400);
      }

      const { data: eng, error: engErr } = await supabase
        .from("poi_engagements")
        .select(`
          *,
          matches:match_id (
            id, commodity, quantity_amount, quantity_unit,
            price_amount, price_currency, match_type,
            buyer_name, seller_name, buyer_org_id, seller_org_id
          ),
          initiator_org:org_id ( id, name )
        `)
        .eq("id", engagementId)
        .single();

      if (engErr || !eng) {
        throw new ApiException("NOT_FOUND", "Engagement not found", 404);
      }

      const recipient = (eng.counterparty_email || "").trim().toLowerCase();
      if (!recipient) {
        throw new ApiException(
          "VALIDATION_ERROR",
          "This engagement has no counterparty email on file. Add one before previewing.",
          400
        );
      }

      const m = eng.matches as any;
      const initiatorOrgId = eng.org_id;
      let counterpartyRole: "buyer" | "seller" | null = null;
      if (m) {
        if (m.buyer_org_id === initiatorOrgId) counterpartyRole = "seller";
        else if (m.seller_org_id === initiatorOrgId) counterpartyRole = "buyer";
        else if (m.match_type === "bid") counterpartyRole = "seller";
        else if (m.match_type === "offer") counterpartyRole = "buyer";
      }

      const { data: suppressed } = await supabase
        .from("suppressed_emails")
        .select("id")
        .eq("email", recipient)
        .maybeSingle();

      const initiatorOrgName = (eng.initiator_org as any)?.name ?? null;
      const commodity = m?.commodity ?? null;
      const ref = String(engagementId).slice(0, 8);
      const subject =
        `Trade interest from a verified Izenzo counterparty${commodity ? ` — ${commodity}` : ""} [${ref}]`;
      const defaultMessage =
        `We understand from public records that your organisation may be active in this commodity ` +
        `and region. We would welcome a brief introductory conversation to share further context.`;

      return new Response(
        JSON.stringify({
          recipient,
          suppressed: !!suppressed,
          subject,
          template_data: {
            counterpartyName: null,
            commodity,
            counterpartyRole,
            quantityAmount: m?.quantity_amount ?? null,
            quantityUnit: m?.quantity_unit ?? null,
            priceAmount: m?.price_amount ?? null,
            priceCurrency: m?.price_currency ?? null,
            location: m?.location ?? null,
            jurisdiction: m?.jurisdiction ?? null,
            initiatorOrgName,
            customMessage: defaultMessage,
            matchId: eng.match_id,
          },
        }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // ── POST /poi-engagements/:id/send-outreach — Send the outreach email and
    // atomically transition state to 'contacted' with a full snapshot in the
    // immutable outreach log. ──
    if (req.method === "POST" && engagementId && parts[1] === "send-outreach") {
      requireRole(authCtx, "admin");

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(engagementId)) {
        throw new ApiException("VALIDATION_ERROR", "Invalid engagement ID format", 400);
      }

      const idempotencyKey = req.headers.get("Idempotency-Key") || `outreach-${engagementId}-${Date.now()}`;
      const idemOpts = {
        supabase,
        orgId: authCtx.orgId ?? "platform",
        endpoint: `POST /poi-engagements/${engagementId}/send-outreach`,
        idempotencyKey,
        requestId,
      };
      const cached = await lookupIdempotentResponse(idemOpts);
      if (cached) return cachedResponseToHttp(cached, headers);

      const SendSchema = z.object({
        subject: z.string().min(1).max(200),
        custom_message: z.string().max(5000).optional(),
        counterparty_name: z.string().max(200).optional(),
        recipient_override: z.string().email().optional(),
      });
      const parsed = SendSchema.safeParse(await req.json());
      if (!parsed.success) {
        throw new ApiException("VALIDATION_ERROR", JSON.stringify(parsed.error.flatten().fieldErrors), 400);
      }

      const { data: eng, error: engErr } = await supabase
        .from("poi_engagements")
        .select(`
          *,
          matches:match_id (
            id, commodity, quantity_amount, quantity_unit,
            price_amount, price_currency, match_type,
            buyer_org_id, seller_org_id
          ),
          initiator_org:org_id ( id, name )
        `)
        .eq("id", engagementId)
        .single();

      if (engErr || !eng) {
        throw new ApiException("NOT_FOUND", "Engagement not found", 404);
      }

      const recipient = (parsed.data.recipient_override || eng.counterparty_email || "").trim().toLowerCase();
      if (!recipient) {
        throw new ApiException("VALIDATION_ERROR", "No recipient email available", 400);
      }

      const currentStatus = eng.engagement_status;
      // Allow re-sending outreach when already 'contacted' (follow-up email).
      // Block only terminal states (accepted/declined/expired) where further
      // outreach is meaningless.
      const isFollowUp = currentStatus === "contacted";
      const allowed = VALID_STATUS_TRANSITIONS[currentStatus] || [];
      if (!isFollowUp && !allowed.includes("contacted")) {
        throw new ApiException(
          "INVALID_TRANSITION",
          `Cannot send outreach from state '${currentStatus}'. Allowed transitions: [${allowed.join(", ")}]`,
          400
        );
      }

      const { data: suppressed } = await supabase
        .from("suppressed_emails")
        .select("id")
        .eq("email", recipient)
        .maybeSingle();
      if (suppressed) {
        throw new ApiException(
          "RECIPIENT_SUPPRESSED",
          `Cannot send: ${recipient} is on the suppression list (previously bounced or unsubscribed). Use 'Mark contacted' to log a non-email outreach instead.`,
          409
        );
      }

      const m = eng.matches as any;
      const initiatorOrgId = eng.org_id;
      let counterpartyRole: "buyer" | "seller" | null = null;
      if (m) {
        if (m.buyer_org_id === initiatorOrgId) counterpartyRole = "seller";
        else if (m.seller_org_id === initiatorOrgId) counterpartyRole = "buyer";
        else if (m.match_type === "bid") counterpartyRole = "seller";
        else if (m.match_type === "offer") counterpartyRole = "buyer";
      }

      const { data: adminProfile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", authCtx.userId)
        .single();

      const templateData = {
        counterpartyName: parsed.data.counterparty_name || null,
        commodity: m?.commodity ?? null,
        counterpartyRole,
        quantityAmount: m?.quantity_amount ?? null,
        quantityUnit: m?.quantity_unit ?? null,
        priceAmount: m?.price_amount ?? null,
        priceCurrency: m?.price_currency ?? null,
        location: m?.location ?? null,
        jurisdiction: m?.jurisdiction ?? null,
        initiatorOrgName: (eng.initiator_org as any)?.name ?? null,
        adminName: adminProfile?.full_name || adminProfile?.email || "Izenzo Compliance Desk",
        customMessage: parsed.data.custom_message || "",
        matchId: eng.match_id,
      };

      const { data: sendResult, error: sendErr } = await supabase.functions.invoke(
        "send-transactional-email",
        {
          body: {
            templateName: "outreach-intent-to-trade",
            recipientEmail: recipient,
            idempotencyKey: `outreach-send-${engagementId}-${idempotencyKey}`,
            templateData,
          },
        }
      );

      if (sendErr || (sendResult && sendResult.success === false)) {
        const reason = (sendResult as any)?.reason || (sendErr as any)?.message || "send_failed";
        console.error(`[${requestId}] Outreach send failed for ${engagementId}:`, reason);
        throw new ApiException(
          "SEND_FAILED",
          `Email send failed: ${reason}. Engagement state was NOT changed.`,
          502
        );
      }

      const snapshotNotes = [
        `EMAIL SENT to ${recipient}`,
        `Subject: ${parsed.data.subject}`,
        parsed.data.custom_message ? `\nMessage:\n${parsed.data.custom_message}` : "",
        `\nReply-to: support@izenzo.co.za`,
      ].filter(Boolean).join("\n");

      const { data: txnResult, error: txnErr } = await supabase.rpc(
        "atomic_engagement_transition",
        {
          p_engagement_id: engagementId,
          p_actor_type: "admin",
          p_actor_user_id: authCtx.userId,
          p_actor_email: adminProfile?.email || "unknown",
          p_actor_name: adminProfile?.full_name || null,
          p_new_status: "contacted",
          p_entry_type: "contact_attempt",
          p_contact_method: "email",
          p_contact_detail: recipient,
          p_notes: snapshotNotes,
          p_audit_action: "engagement.outreach_email_sent",
          p_audit_org_id: null,
        }
      );

      if (txnErr) {
        console.error(`[${requestId}] Outreach SENT but state transition failed:`, txnErr);
        throw new ApiException(
          "PARTIAL_SUCCESS",
          "Email was sent but the engagement state could not be updated. Please refresh and verify.",
          500
        );
      }
      const txn = txnResult as { success: boolean; error?: string } | null;
      if (!txn?.success) {
        throw new ApiException("TRANSITION_FAILED", txn?.error || "Atomic transition failed", 500);
      }

      await supabase
        .from("poi_engagements")
        .update({
          contact_method: "email",
          contact_date: new Date().toISOString(),
        })
        .eq("id", engagementId);

      const { data: updated } = await supabase
        .from("poi_engagements")
        .select()
        .eq("id", engagementId)
        .single();

      console.log(`[${requestId}] Outreach email sent + state advanced for ${engagementId} → contacted`);

      const responseBody = {
        ok: true,
        engagement: updated,
        sent_to: recipient,
        subject: parsed.data.subject,
      };
      await storeIdempotentResponse(idemOpts, { status: 200, body: responseBody });
      return new Response(JSON.stringify(responseBody), {
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

      // ── Idempotency: short-circuit duplicate PATCHes (status transitions
      // and outreach-log inserts must never double-fire on retries) ──
      const idempotencyKey = req.headers.get("Idempotency-Key");
      const idemOpts = {
        supabase,
        orgId: authCtx.orgId ?? "platform",
        endpoint: `PATCH /poi-engagements/${engagementId}`,
        idempotencyKey,
        requestId,
      };
      const cached = await lookupIdempotentResponse(idemOpts);
      if (cached) return cachedResponseToHttp(cached, headers);

      const body = await req.json();
      const parsed = UpdateEngagementSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiException("VALIDATION_ERROR", JSON.stringify(parsed.error.flatten().fieldErrors), 400);
      }

      // ── Reject empty PATCH bodies — no-op writes pollute the immutable log ──
      const hasMeaningfulChange =
        parsed.data.engagement_status !== undefined ||
        parsed.data.counterparty_email !== undefined ||
        parsed.data.admin_notes !== undefined ||
        parsed.data.support_notes !== undefined ||
        parsed.data.contact_method !== undefined ||
        parsed.data.contact_date !== undefined;
      if (!hasMeaningfulChange) {
        throw new ApiException(
          "VALIDATION_ERROR",
          "Request must include at least one field to update (engagement_status, counterparty_email, admin_notes, support_notes, contact_method, or contact_date).",
          400
        );
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

      // Tracks the outcome of the email→org auto-resolution so we can surface
      // a non-fatal hint to admins (e.g. when the recipient is not yet registered).
      let bindingHint:
        | { status: "bound"; org_id: string; email: string }
        | { status: "no_match"; email: string; message: string }
        | { status: "already_bound"; org_id: string }
        | { status: "lookup_error"; email: string; message: string }
        | null = null;

      if (parsed.data.counterparty_email !== undefined) {
        // Schema already trims + lowercases, but normalise defensively in case
        // the schema is relaxed in future.
        const normalisedEmail = parsed.data.counterparty_email.trim().toLowerCase();
        updates.counterparty_email = normalisedEmail;

        // ── Auto-resolve email → registered org ──
        // If the supplied counterparty email already maps to a profile on the
        // platform, bind the engagement to that org so it surfaces in the
        // recipient's inbound queue (which filters by counterparty_org_id).
        // Only resolve when the row is currently unbound, to avoid silently
        // overwriting a deliberate prior binding.
        if (!current.counterparty_org_id) {
          const { data: matchedProfile, error: lookupErr } = await supabase
            .from("profiles")
            .select("org_id")
            .ilike("email", normalisedEmail)
            .not("org_id", "is", null)
            .limit(1)
            .maybeSingle();
          if (lookupErr) {
            console.warn(
              `[${requestId}] counterparty_email→org resolve failed (non-fatal):`,
              lookupErr.message,
            );
            bindingHint = {
              status: "lookup_error",
              email: normalisedEmail,
              message:
                "Email saved, but the platform could not check whether it matches a registered organisation. Please retry shortly.",
            };
          } else if (matchedProfile?.org_id) {
            updates.counterparty_org_id = matchedProfile.org_id;
            updates.counterparty_type = "known";
            bindingHint = {
              status: "bound",
              org_id: matchedProfile.org_id,
              email: normalisedEmail,
            };
            console.log(
              `[${requestId}] Auto-bound engagement ${engagementId} to org ${matchedProfile.org_id} via email ${normalisedEmail}`,
            );
          } else {
            bindingHint = {
              status: "no_match",
              email: normalisedEmail,
              message:
                "Email saved, but no registered organisation matches this address yet. The engagement will remain unbound until the recipient signs up or the email is corrected.",
            };
            console.log(
              `[${requestId}] No registered profile found for ${normalisedEmail}; engagement ${engagementId} remains unbound.`,
            );
          }
        } else {
          bindingHint = {
            status: "already_bound",
            org_id: current.counterparty_org_id,
          };
        }
      }
      if (parsed.data.admin_notes !== undefined) {
        updates.admin_notes = parsed.data.admin_notes;
      }
      // ── Admin-only support notes (auth gate: PATCH already requires admin role above) ──
      if (parsed.data.support_notes !== undefined) {
        // Empty string clears the field; non-empty stamps editor + timestamp.
        const trimmed = parsed.data.support_notes.trim();
        updates.support_notes = trimmed.length === 0 ? null : trimmed;
        updates.support_notes_updated_at = new Date().toISOString();
        updates.support_notes_updated_by = authCtx.userId;
      }
      if (parsed.data.contact_method !== undefined) {
        updates.contact_method = parsed.data.contact_method;
      }
      if (parsed.data.contact_date !== undefined) {
        updates.contact_date = parsed.data.contact_date;
      }

      // Snapshot admin identity at the moment of the action
      const { data: adminProfile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", authCtx.userId)
        .single();

      // Classify outreach log entry
      const isContactAttempt =
        updates.engagement_status === "contacted" &&
        !!parsed.data.contact_method &&
        !!parsed.data.contact_detail;

      let entryType: "contact_attempt" | "status_change" | "notes_edit" | "email_update";
      if (isContactAttempt) {
        entryType = "contact_attempt";
      } else if (updates.engagement_status) {
        entryType = "status_change";
      } else if (parsed.data.counterparty_email !== undefined) {
        entryType = "email_update";
      } else if (parsed.data.admin_notes !== undefined) {
        entryType = "notes_edit";
      } else {
        entryType = "status_change";
      }

      const targetStatus =
        (updates.engagement_status as string) || current.engagement_status;

      // ── Atomic transition: engagement update + outreach log + audit log in ONE transaction ──
      // Eliminates the orphan-row race; advisory lock serialises concurrent admin actions on the same row.
      const { data: txnResult, error: txnErr } = await supabase.rpc(
        "atomic_engagement_transition",
        {
          p_engagement_id: engagementId,
          p_actor_type: "admin",
          p_actor_user_id: authCtx.userId,
          p_actor_email: adminProfile?.email || "unknown",
          p_actor_name: adminProfile?.full_name || null,
          p_new_status: targetStatus,
          p_entry_type: entryType,
          p_contact_method: isContactAttempt ? parsed.data.contact_method : null,
          p_contact_detail: isContactAttempt ? parsed.data.contact_detail : null,
          p_notes:
            parsed.data.admin_notes ||
            (entryType === "email_update"
              ? `Counterparty email updated to ${parsed.data.counterparty_email}`
              : null),
          p_audit_action: "engagement.updated",
          p_audit_org_id: null,
        }
      );

      if (txnErr) throw txnErr;
      const txn = txnResult as { success: boolean; error?: string } | null;
      if (!txn?.success) {
        throw new ApiException("TRANSITION_FAILED", txn?.error || "Atomic transition failed", 500);
      }

      // Apply non-state field updates (counterparty_email, admin_notes, support_notes, contact_method, contact_date)
      // These are not part of the state machine and don't affect the audit chain.
      const sideUpdates: Record<string, unknown> = {};
      if (parsed.data.counterparty_email !== undefined) sideUpdates.counterparty_email = parsed.data.counterparty_email;
      // Carry the auto-resolved binding fields (set above when an email matched a registered profile)
      if (updates.counterparty_org_id !== undefined) sideUpdates.counterparty_org_id = updates.counterparty_org_id;
      if (updates.counterparty_type !== undefined) sideUpdates.counterparty_type = updates.counterparty_type;
      if (parsed.data.admin_notes !== undefined) sideUpdates.admin_notes = parsed.data.admin_notes;
      if (parsed.data.contact_method !== undefined) sideUpdates.contact_method = parsed.data.contact_method;
      if (parsed.data.contact_date !== undefined) sideUpdates.contact_date = parsed.data.contact_date;
      if (parsed.data.support_notes !== undefined) {
        sideUpdates.support_notes = updates.support_notes;
        sideUpdates.support_notes_updated_at = updates.support_notes_updated_at;
        sideUpdates.support_notes_updated_by = updates.support_notes_updated_by;
      }

      let updated: any = null;
      if (Object.keys(sideUpdates).length > 0) {
        const { data, error } = await supabase
          .from("poi_engagements")
          .update(sideUpdates)
          .eq("id", engagementId)
          .select()
          .single();
        if (error) throw error;
        updated = data;
      } else {
        const { data } = await supabase
          .from("poi_engagements")
          .select()
          .eq("id", engagementId)
          .single();
        updated = data;
      }

      console.log(`[${requestId}] Engagement ${engagementId} updated atomically: ${current.engagement_status} → ${targetStatus}`);

      // ── Admin audit log: explicit entry whenever support notes are created/updated/cleared ──
      if (parsed.data.support_notes !== undefined) {
        const previous = (current as { support_notes?: string | null }).support_notes ?? null;
        const next = (updates.support_notes as string | null) ?? null;
        if (previous !== next) {
          const action =
            previous === null && next !== null
              ? "engagement.support_notes.created"
              : next === null
                ? "engagement.support_notes.cleared"
                : "engagement.support_notes.updated";
          const ipAddress =
            req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            req.headers.get("x-real-ip") ||
            null;
          const { error: auditErr } = await supabase.from("admin_audit_logs").insert({
            admin_user_id: authCtx.userId,
            action,
            target_type: "poi_engagement",
            target_id: engagementId,
            ip_address: ipAddress,
            details: {
              match_id: (current as { match_id?: string | null }).match_id ?? null,
              previous_length: previous?.length ?? 0,
              new_length: next?.length ?? 0,
              admin_email: adminProfile?.email || "unknown",
              admin_name: adminProfile?.full_name || null,
              request_id: requestId,
            },
          });
          if (auditErr) {
            console.error(`[${requestId}] Failed to insert admin_audit_logs entry for support_notes:`, auditErr);
          }
        }
      }

      const responseBody = { engagement: updated };
      await storeIdempotentResponse(idemOpts, { status: 200, body: responseBody });
      return new Response(JSON.stringify(responseBody), {
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

      // ── Pre-flight: validate legal name BEFORE committing acceptance ──
      let bestName: string | null = null;
      if (parsed.data.action === "accepted") {
        const { data: counterpartyProfile } = await supabase
          .from("profiles")
          .select("full_name, org_id")
          .eq("org_id", authCtx.orgId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        const { data: counterpartyOrg } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", authCtx.orgId)
          .maybeSingle();

        const profileName = counterpartyProfile?.full_name?.trim();
        const orgName = counterpartyOrg?.name?.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        bestName =
          (profileName && !emailRegex.test(profileName) ? profileName : null) ||
          (orgName && !emailRegex.test(orgName) ? orgName : null);

        if (!bestName) {
          throw new ApiException(
            "PROFILE_INCOMPLETE",
            "Your profile name must be set to a legal name (not an email address) before you can accept a trade engagement. Please update your name on the Dashboard and try again.",
            400
          );
        }
      }

      // Snapshot responder identity
      const { data: responderProfile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", authCtx.userId)
        .single();

      // ── Atomic transition: engagement + outreach log + audit log in one transaction ──
      const { data: txnResult, error: txnErr } = await supabase.rpc(
        "atomic_engagement_transition",
        {
          p_engagement_id: engagement.id,
          p_actor_type: "counterparty",
          p_actor_user_id: authCtx.userId,
          p_actor_email: responderProfile?.email || null,
          p_actor_name: responderProfile?.full_name || null,
          p_new_status: parsed.data.action,
          p_entry_type: "status_change",
          p_contact_method: null,
          p_contact_detail: null,
          p_notes: `Counterparty self-serve response: ${parsed.data.action}`,
          p_audit_action: "engagement.counterparty_responded",
          p_audit_org_id: authCtx.orgId,
        }
      );

      if (txnErr) throw txnErr;
      const txn = txnResult as { success: boolean; error?: string } | null;
      if (!txn?.success) {
        throw new ApiException("TRANSITION_FAILED", txn?.error || "Atomic transition failed", 500);
      }

      // ── Post-commit: sync validated name to match record ──
      if (parsed.data.action === "accepted" && bestName) {
        if (matchData.buyer_org_id === authCtx.orgId) {
          await supabase.from("matches")
            .update({ buyer_name: bestName })
            .eq("id", matchId);
        } else if (matchData.seller_org_id === authCtx.orgId) {
          await supabase.from("matches")
            .update({ seller_name: bestName })
            .eq("id", matchId);
        }
      }

      const { data: updated } = await supabase
        .from("poi_engagements")
        .select()
        .eq("id", engagement.id)
        .single();

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
