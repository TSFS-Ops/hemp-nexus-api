import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { validateInput } from "../_shared/validation.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import {
  cachedResponseToHttp,
  lookupIdempotentResponse,
  storeIdempotentResponse,
} from "../_shared/idempotency.ts";
import { checkMaintenanceMode, logDecision, tryBypass } from "../_shared/test-mode-bypass.ts";
import { checkOrgLegitimacy, getActiveGovernanceProfile, ORG_NOT_VERIFIED_CODE } from "../_shared/legitimacy.ts";
import { clampSubject } from "../_shared/email-subject.ts";
import { dispatchD4bAdminAlert } from "../_shared/batch-d-admin-notify.ts";
import { dispatchD4cInitiatorAlert } from "../_shared/batch-d-initiator-notify.ts";
import { evaluateCounterpartyEmailBinding } from "../_shared/binding-resolver.ts";
// Batch A — single source of truth for contact-completeness gating.
// Mirror of `src/lib/contact-completeness.ts`. Both files MUST stay in
// lockstep; the regression tests pin both surfaces.
import {
  getContactState,
  isOutreachBlocked,
  contactBlockReason,
  contactBlockCode,
  contactStateLabel,
  type ContactState,
} from "../_shared/contact-completeness.ts";
import {
  isCounterpartySide,
  describeMatchSide,
} from "../_shared/engagement-counterparty.ts";

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
  // Batch A — counterparty contact-completeness fields.
  // contact_type: "organisation" | "named_individual" | null (clear).
  // Empty string normalises to null so the UI can clear it.
  contact_type: z
    .union([z.enum(["organisation", "named_individual"]), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === null ? null : v ?? undefined)),
  contact_name: z
    .union([z.string().trim().max(200, { message: "contact_name exceeds 200 characters" }), z.null()])
    .optional()
    .transform((v) => (v === null ? null : v === undefined ? undefined : v)),
});

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ["notification_sent", "contacted", "expired"],
  notification_sent: ["contacted", "expired"],
  contacted: ["accepted", "declined", "expired"],
  accepted: [],
  declined: [],
  expired: [],
};

// ── D2a — outreach gate ───────────────────────────────────────────────
// Independent of the broader progression guard. Outreach (preview/send)
// must be blocked when the engagement is recorded as disputed by the
// named counterparty, OR when the contact requires a binding review
// (multiple candidate identities / shared mailbox). This is intentionally
// narrower than `assertEngagementAllowsProgression` — we deliberately do
// NOT block on cancelled_email_change here because the cancel flow is
// itself the resolution path; outreach on a cancelled row is impossible
// (no active engagement_status target) and is handled by separate gates.
type OutreachGateCode = "DISPUTED_BEING_NAMED" | "BINDING_REVIEW_PENDING";
function evaluateOutreachGate(
  eng: Record<string, unknown>,
): { code: OutreachGateCode; message: string } | null {
  const status = eng.engagement_status as string | null | undefined;
  if (status === "disputed_being_named") {
    return {
      code: "DISPUTED_BEING_NAMED",
      message:
        "This engagement has been recorded as disputed by the named counterparty. Outreach is blocked until the dispute is resolved.",
    };
  }
  const operationalState = eng.operational_state as string | null | undefined;
  const bindingCandidates = eng.binding_candidates;
  const bindingResolution = eng.binding_resolution as string | null | undefined;
  const bindingPending =
    operationalState === "binding_review_required" ||
    (bindingCandidates != null && bindingResolution == null);
  if (bindingPending) {
    return {
      code: "BINDING_REVIEW_PENDING",
      message:
        "Counterparty contact requires a binding review (multiple candidate identities or a shared mailbox). Outreach is blocked until an admin resolves the binding.",
    };
  }
  return null;
}

/**
 * Batch A — fields the helper needs from the joined match row to derive
 * the organisation-name fallback (matches.buyer_name / seller_name when
 * the corresponding *_org_id is null).
 */
const MATCH_CONTACT_SELECT = "buyer_name,seller_name,buyer_org_id,seller_org_id";

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

    // Structured request-entry log so we can correlate every poi-engagements
    // call (especially the email-sending branches that have been failing
    // intermittently for clients) with downstream decision logs.
    console.log(
      `[request] ${JSON.stringify({
        tag: "poi-engagements",
        requestId,
        method: req.method,
        path: parts.join("/"),
        engagementId: engagementId ?? null,
        actorUserId: authCtx.userId ?? null,
        orgId: authCtx.orgId ?? null,
        ts: new Date().toISOString(),
      })}`,
    );

    // Maintenance gate — only enforced for state-mutating + email-sending POSTs.
    // GETs (list/preview/log) are allowed through so admins can still
    // diagnose during a maintenance window.
    if (req.method === "POST") {
      const maintenance = await checkMaintenanceMode(supabase, {
        source: "poi-engagements",
        requestId,
        actorUserId: authCtx.userId ?? null,
        orgId: authCtx.orgId ?? null,
        action: parts[1] ?? "create_or_update",
      });
      if (maintenance.blocked) {
        return new Response(
          JSON.stringify({
            error: "Service temporarily unavailable — platform is in maintenance mode.",
            code: "MAINTENANCE_MODE",
            request_id: requestId,
          }),
          { status: 503, headers: { ...headers, "Content-Type": "application/json" } },
        );
      }
    }


    // ── GET /poi-engagements — List engagements (admin only) ──
    if (req.method === "GET" && !engagementId) {
      requireRole(authCtx, "platform_admin");

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

    // ── GET /poi-engagements/by-match/:matchId — Engagement read-model ──
    // Batch B Phase 1: returns the canonical envelope
    //   { current_engagement, latest_historical_engagement, history,
    //     read_model: "v1", engagement (legacy alias) }
    // so every consumer can stop assuming one-row-per-match BEFORE the
    // schema is unlocked in Phase 2. Today (UNIQUE(match_id) still in
    // place) the resolver collapses to the historical behaviour: a single
    // active row becomes `current_engagement`, a single terminal row
    // becomes `latest_historical_engagement`, and `engagement` mirrors
    // whichever was returned. See
    // supabase/functions/_shared/engagement-read-model.ts for selection
    // rules. Do NOT re-introduce `.maybeSingle()` here.
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
        .order("created_at", { ascending: false });

      if (error) throw error;

      const { resolveEngagementReadModel, legacyEngagementAlias } = await import(
        "../_shared/engagement-read-model.ts"
      );
      const model = resolveEngagementReadModel((data ?? []) as never[]);

      return new Response(
        JSON.stringify({
          ...model,
          // Legacy alias — drop once every client consumes
          // `current_engagement` (tracked in Batch B Phase 5 cleanup).
          engagement: legacyEngagementAlias(model),
        }),
        {
          status: 200,
          headers: { ...headers, "Content-Type": "application/json" },
        },
      );
    }

    // ── GET /poi-engagements/:id/outreach-log — Immutable outreach history ──
    if (req.method === "GET" && engagementId && parts[1] === "outreach-log") {
      requireRole(authCtx, "platform_admin");

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
      requireRole(authCtx, "platform_admin");

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

      // ── D2a outreach gate (preview) ──
      // Block disputed + binding-review BEFORE the contact-completeness
      // check so a disputed/binding-pending row never even renders a
      // preview body. No audit row on preview blocks (no side-effect to
      // attribute) — the send-outreach path writes the audit on block.
      {
        const gate = evaluateOutreachGate(eng as Record<string, unknown>);
        if (gate) {
          throw new ApiException(gate.code, gate.message, 409);
        }
      }


      // Single source of truth: the helper decides whether outreach is allowed.
      // email_missing      → CONTACT_EMAIL_MISSING
      // contact_incomplete → CONTACT_INCOMPLETE
      // organisation_contact / named_individual_contact → allowed
      const previewState = getContactState(eng as any, (eng.matches as any) ?? null);
      if (isOutreachBlocked(previewState)) {
        const code = contactBlockCode(previewState)!;
        const reason = contactBlockReason(previewState)!;
        try {
          await supabase.from("audit_logs").insert({
            org_id: (eng as { org_id: string }).org_id,
            actor_user_id: authCtx.userId,
            action: "contact.incomplete_detected",
            entity_type: "poi_engagement",
            entity_id: engagementId,
            metadata: {
              actor_role: "platform_admin",
              surface: "preview-outreach",
              state: previewState,
              code,
              request_id: requestId,
            },
          });
        } catch (_e) { /* non-fatal */ }
        throw new ApiException(code, reason, 422);
      }
      const recipient = (eng.counterparty_email || "").trim().toLowerCase();

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
      // Subject is built from `base` (+ optional commodity fragment) and is
      // clamped through the shared `clampSubject` helper so the trailing
      // `[ref]` trace marker (required for inbound reply correlation) is
      // always preserved verbatim. This is the single source of truth for
      // the platform's 200-char subject contract.
      const base = "Trade interest from a verified Izenzo counterparty";
      const tail = ` [${ref}]`;
      const middle = commodity ? ` — ${String(commodity).trim().replace(/\s+/g, " ")}` : "";
      const subject = clampSubject(`${base}${middle}`, tail);
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
      requireRole(authCtx, "platform_admin");

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(engagementId)) {
        throw new ApiException("VALIDATION_ERROR", "Invalid engagement ID format", 400);
      }

      // ── Validate body FIRST so we can derive a stable idempotency key from
      // its content. Previously we fell back to `Date.now()` whenever the
      // client omitted the Idempotency-Key header, which made every retry
      // generate a fresh key and silently bypass dedupe. The Supabase JS SDK
      // does not surface a header API on functions.invoke(), so admins
      // double-clicking "Send" or browsers retrying on transient network
      // failure could fire two real emails. The fix: hash the request body
      // so identical retries collide on the same key, while a deliberate
      // re-send (different subject/body) still produces a new send.
      const SendSchema = z.object({
        subject: z.string().min(1).max(200),
        custom_message: z.string().max(5000).optional(),
        counterparty_name: z.string().max(200).optional(),
        recipient_override: z.string().email().optional(),
      });
      const rawBody = await req.text();
      let parsedBody: unknown;
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        throw new ApiException("VALIDATION_ERROR", "Body must be valid JSON", 400);
      }
      const parsed = SendSchema.safeParse(parsedBody);
      if (!parsed.success) {
        throw new ApiException("VALIDATION_ERROR", JSON.stringify(parsed.error.flatten().fieldErrors), 400);
      }

      // Stable key: SHA-256 of the canonical body. Same body + same engagement
      // = same key = idempotent. Different body = new send (admin chose to
      // re-send with edits). Header still wins when the client provides one.
      const headerKey = req.headers.get("Idempotency-Key");
      let idempotencyKey: string;
      if (headerKey && headerKey.trim().length > 0) {
        idempotencyKey = headerKey.trim();
      } else {
        const canonical = JSON.stringify({
          subject: parsed.data.subject,
          custom_message: parsed.data.custom_message ?? null,
          counterparty_name: parsed.data.counterparty_name ?? null,
          recipient_override: parsed.data.recipient_override ?? null,
        });
        const hashBuf = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(canonical)
        );
        const hashHex = Array.from(new Uint8Array(hashBuf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        idempotencyKey = `outreach-${engagementId}-${hashHex.slice(0, 32)}`;
      }
      const idemOpts = {
        supabase,
        orgId: authCtx.orgId ?? "platform",
        endpoint: `POST /poi-engagements/${engagementId}/send-outreach`,
        idempotencyKey,
        requestId,
      };
      const cached = await lookupIdempotentResponse(idemOpts);
      if (cached) return cachedResponseToHttp(cached, headers);

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

      // ── D2a outreach gate (send) ──
      // Block disputed + binding-review BEFORE legitimacy / suppression /
      // email send. Audit-on-block via engagement_outreach_logs so the
      // refusal is captured in the immutable history with the originating
      // request_id. entry_type='system_action' is the canonical generic
      // event type allowed by the live CHECK constraint.
      {
        const gate = evaluateOutreachGate(eng as Record<string, unknown>);
        if (gate) {
          const adminLookup = await supabase
            .from("profiles")
            .select("email, full_name")
            .eq("id", authCtx.userId)
            .maybeSingle();
          const adminEmail = (adminLookup.data as { email?: string } | null)?.email ?? "unknown";
          const adminName = (adminLookup.data as { full_name?: string | null } | null)?.full_name ?? null;
          try {
            await supabase.from("engagement_outreach_logs").insert({
              engagement_id: engagementId,
              actor_type: "admin",
              admin_user_id: authCtx.userId,
              admin_email: adminEmail,
              admin_name: adminName,
              previous_status: (eng as { engagement_status: string }).engagement_status,
              new_status: (eng as { engagement_status: string }).engagement_status,
              entry_type: "system_action",
              notes: JSON.stringify({
                event: "outreach_blocked",
                guard_code: gate.code,
                surface: "send-outreach",
                request_id: requestId,
              }),
            });
          } catch (logErr) {
            console.warn(`[${requestId}] Failed to write outreach-blocked log row (non-fatal):`, logErr);
          }
          throw new ApiException(gate.code, gate.message, 409);
        }
      }


      // Block before any side effects (legitimacy, suppression, send) so a
      // bad contact record never reaches the email pipeline. recipient_override
      // can satisfy email_missing — re-evaluate against the override when set.
      {
        const overrideEmail = parsed.data.recipient_override?.trim().toLowerCase();
        const engForCheck = overrideEmail
          ? { ...(eng as any), counterparty_email: overrideEmail }
          : (eng as any);
        const sendState = getContactState(engForCheck, (eng.matches as any) ?? null);
        if (isOutreachBlocked(sendState)) {
          const code = contactBlockCode(sendState)!;
          const reason = contactBlockReason(sendState)!;
          try {
            await supabase.from("audit_logs").insert({
              org_id: (eng as { org_id: string }).org_id,
              actor_user_id: authCtx.userId,
              action: "contact.incomplete_detected",
              entity_type: "poi_engagement",
              entity_id: engagementId,
              metadata: {
                actor_role: "platform_admin",
                surface: "send-outreach",
                state: sendState,
                code,
                request_id: requestId,
              },
            });
          } catch (_e) { /* non-fatal */ }
          throw new ApiException(code, reason, 422);
        }
      }

      // ── LEGITIMACY GATE (David & Daniel: "easy entry, hard legitimacy") ──
      // The initiator org is about to project Izenzo's name to a counterparty
      // via email. Block the send if the initiator org is not formally
      // approved to trade — UNLESS the tenant posture is `wad_only`, in
      // which case verification is deferred to WaD execution.
      // Admins acting on behalf of an unverified tenant are also blocked —
      // the gate is on the org, not on the actor's role.
      const initiatorOrgIdForGate = (eng as { org_id: string }).org_id;
      const outreachGovernanceProfile = await getActiveGovernanceProfile(supabase, initiatorOrgIdForGate);
      const outreachLegitimacy = await checkOrgLegitimacy(supabase, initiatorOrgIdForGate, "outreach");
      if (!outreachLegitimacy.allowed) {
        // Test-mode bypass: admin-controlled "kyb" flag short-circuits the
        // legitimacy gate so unverified orgs can still send outreach in
        // non-prod environments. Production tier is locked out inside
        // tryBypass. Mirrors the symmetry already in match/index.ts and
        // pois/index.ts so the TEST MODE banner's KYB promise is truthful
        // across every counterparty-facing surface.
        const bypassed = await tryBypass(supabase, {
          gate: "kyb",
          source: "poi-engagements/send-outreach",
          orgId: initiatorOrgIdForGate,
          actorUserId: authCtx.userId ?? null,
          requestId,
          details: {
            callsite: "outreach",
            engagement_id: engagementId,
            legitimacy_reason: outreachLegitimacy.reason,
            gate_position: outreachLegitimacy.gatePosition,
          },
        });
        if (!bypassed) {
          logDecision("maintenance", {
            source: "poi-engagements/send-outreach",
            decision: "block",
            requestId,
            actorUserId: authCtx.userId ?? null,
            orgId: authCtx.orgId ?? null,
            reason: `org_not_verified:${outreachLegitimacy.reason}`,
            details: {
              engagement_id: engagementId,
              initiator_org_id: initiatorOrgIdForGate,
              trade_approval_status: outreachLegitimacy.status,
              valid_until: outreachLegitimacy.validUntil,
              // ── Step 3: forensic audit memory ──
              gate_position: outreachLegitimacy.gatePosition,
              governance_profile_id: outreachGovernanceProfile.profileId,
            },
          });
          throw new ApiException(ORG_NOT_VERIFIED_CODE, outreachLegitimacy.message, 403);
        }
      }

      const recipient = (parsed.data.recipient_override || eng.counterparty_email || "").trim().toLowerCase();
      if (!recipient) {
        throw new ApiException("VALIDATION_ERROR", "No recipient email available", 400);
      }

      const currentStatus = eng.engagement_status;
      // Outreach emails are allowed in two modes:
      //   1. Forward-progressing send: state currently allows the transition
      //      to 'contacted' (e.g. pending → contacted, notification_sent →
      //      contacted). State will be advanced to 'contacted'.
      //   2. Follow-up send: state is already 'contacted' or has reached a
      //      post-engagement state (accepted / declined / expired) but the
      //      admin still legitimately needs to email the counterparty (e.g.
      //      thank-you, next steps, dispute clarification). State is NOT
      //      changed — only the outreach log + audit entry are recorded.
      const POST_ENGAGEMENT_STATES = ["contacted", "accepted", "declined", "expired"];
      const isFollowUp = POST_ENGAGEMENT_STATES.includes(currentStatus);
      const allowed = VALID_STATUS_TRANSITIONS[currentStatus] || [];

      // Decision log: explain exactly why the email was (or wasn't) gated.
      logDecision("maintenance", {
        source: "poi-engagements/send-outreach",
        decision: !isFollowUp && !allowed.includes("contacted") ? "block" : "allow",
        requestId,
        actorUserId: authCtx.userId ?? null,
        orgId: authCtx.orgId ?? null,
        reason: isFollowUp ? "follow_up" : (allowed.includes("contacted") ? "transition_ok" : "invalid_transition"),
        details: {
          engagement_id: engagementId,
          current_status: currentStatus,
          recipient,
          allowed_transitions: allowed,
        },
      });

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
        logDecision("maintenance", {
          source: "poi-engagements/send-outreach",
          decision: "block",
          requestId,
          actorUserId: authCtx.userId ?? null,
          orgId: authCtx.orgId ?? null,
          reason: "recipient_suppressed",
          details: { engagement_id: engagementId, recipient },
        });
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

      // For forward-progressing sends, advance the state via the atomic RPC.
      // For post-engagement follow-ups (accepted/declined/expired), the email
      // is logged to the immutable outreach log + audit log without changing
      // the engagement state.
      const isPostEngagementFollowUp =
        currentStatus === "accepted" ||
        currentStatus === "declined" ||
        currentStatus === "expired";

      if (!isPostEngagementFollowUp) {
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

        // ── Step 3: snapshot the gate posture in force at the moment the
        // outreach was actually dispatched. The atomic RPC above wrote its
        // own state-transition audit row; this companion row records the
        // governance posture so the historical decision is reconstructible.
        try {
          await supabase.from("audit_logs").insert({
            org_id: eng.org_id,
            actor_user_id: authCtx.userId,
            action: "engagement.outreach_governance_snapshot",
            entity_type: "poi_engagement",
            entity_id: engagementId,
            metadata: {
              recipient,
              request_id: requestId,
              gate_position: outreachLegitimacy.gatePosition,
              governance_profile_id: outreachGovernanceProfile.profileId,
            },
          });
        } catch (snapErr) {
          console.warn(`[${requestId}] Failed to write governance snapshot audit row:`, snapErr);
        }
      } else {
        // Post-engagement follow-up: log to outreach_logs + audit_logs without
        // changing engagement state.
        await supabase.from("engagement_outreach_logs").insert({
          engagement_id: engagementId,
          actor_type: "admin",
          admin_user_id: authCtx.userId,
          admin_email: adminProfile?.email || null,
          admin_name: adminProfile?.full_name || null,
          previous_status: currentStatus,
          new_status: currentStatus,
          entry_type: "post_engagement_followup",
          contact_method: "email",
          contact_detail: recipient,
          notes: snapshotNotes,
        });
        await supabase.from("audit_logs").insert({
          org_id: eng.org_id,
          actor_user_id: authCtx.userId,
          action: "engagement.outreach_followup_email_sent",
          entity_type: "poi_engagement",
          entity_id: engagementId,
          metadata: {
            recipient,
            current_status: currentStatus,
            subject: parsed.data.subject,
            request_id: requestId,
            // ── Step 3: forensic audit memory ──
            gate_position: outreachLegitimacy.gatePosition,
            governance_profile_id: outreachGovernanceProfile.profileId,
          },
        });
        console.log(
          `[${requestId}] Post-engagement follow-up email sent for ${engagementId} (status remains ${currentStatus})`
        );
      }

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

    // ── PATCH /poi-engagements/:id — Update engagement ──
    // Batch A (06 May 2026): platform_admin retains full edit rights.
    // org_admin may ONLY update contact_type / contact_name AND ONLY for
    // engagements that belong to their own organisation. All other fields
    // and any cross-org attempt are rejected with FORBIDDEN + audit-logged
    // as `contact.assignment_blocked`. Normal org members remain denied.
    if (req.method === "PATCH" && engagementId) {
      const isPlatformAdmin = authCtx.roles.includes("platform_admin");
      const isOrgAdmin = authCtx.roles.includes("org_admin");
      if (!isPlatformAdmin && !isOrgAdmin) {
        throw new ApiException("FORBIDDEN", "Insufficient permissions", 403);
      }

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(engagementId)) {
        throw new ApiException("VALIDATION_ERROR", "Invalid engagement ID format", 400);
      }

      // ── Idempotency: short-circuit duplicate PATCHes (status transitions
      // and outreach-log inserts must never double-fire on retries).
      // Header is REQUIRED (hard-mode) — admins re-clicking accept/decline
      // must collide on the key, not generate a fresh state transition.
      const idempotencyKey = req.headers.get("Idempotency-Key");
      if (!idempotencyKey) {
        throw new ApiException(
          "VALIDATION_ERROR",
          "Idempotency-Key header is required",
          400,
        );
      }
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
      // Use the shared validator so failures return the canonical
      // { code: "VALIDATION_ERROR", message, details: { errors: [...] }, requestId }
      // shape via errorResponse() — same contract as every other endpoint.
      // `parsed` keeps the same shape the rest of the handler expects:
      //   { success: true, data: <validated> }
      // so downstream code stays untouched.
      const parsed = {
        success: true as const,
        data: validateInput(UpdateEngagementSchema, body),
      };

      // ── Reject empty PATCH bodies — no-op writes pollute the immutable log ──
      const hasMeaningfulChange =
        parsed.data.engagement_status !== undefined ||
        parsed.data.counterparty_email !== undefined ||
        parsed.data.admin_notes !== undefined ||
        parsed.data.support_notes !== undefined ||
        parsed.data.contact_method !== undefined ||
        parsed.data.contact_date !== undefined ||
        parsed.data.contact_type !== undefined ||
        parsed.data.contact_name !== undefined;
      if (!hasMeaningfulChange) {
        throw new ApiException(
          "VALIDATION_ERROR",
          "Request must include at least one field to update (engagement_status, counterparty_email, contact_type, contact_name, admin_notes, support_notes, contact_method, or contact_date).",
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

      // ── Batch A — MT-009 Option C contact-edit gate (signed 06 May 2026) ──
      //
      // CORRECTED 06 May 2026: the original `engagement.org_id === authCtx.orgId`
      // rule was wrong. `engagement.org_id` is the INITIATOR org. The contact
      // record on this row represents the COUNTERPARTY side of the match
      // (the side opposite the initiator). The initiator must NEVER be allowed
      // to edit the counterparty's contact details — that would let one side
      // write the other side's contact, which is exactly what MT-009 forbids.
      //
      // Authoritative rule (matches Daniel Davies' clarification — MT-009 Option C, Option B widening 2026-05-06):
      //   • platform_admin → may edit any field on any engagement.
      //   • org_admin      → may edit ONLY contact_type / contact_name /
      //                      counterparty_email AND ONLY when their org is the
      //                      counterparty side of the match (counterparty_org_id
      //                      match OR registered buyer/seller side opposite the
      //                      initiator). Outreach (preview/send) and
      //                      notifications remain platform_admin-only.
      //   • everyone else  → blocked.
      //
      // Side identification uses the shared `isCounterpartySide` helper, which
      // is the same predicate used by POST /respond/:matchId.
      if (!isPlatformAdmin && isOrgAdmin) {
        const touchedContactField =
          parsed.data.contact_type !== undefined ||
          parsed.data.contact_name !== undefined ||
          parsed.data.counterparty_email !== undefined;
        const onlyContactFields =
          parsed.data.engagement_status === undefined &&
          parsed.data.admin_notes === undefined &&
          parsed.data.support_notes === undefined &&
          parsed.data.contact_method === undefined &&
          parsed.data.contact_date === undefined &&
          touchedContactField;

        // Fetch the parent match so the helper can compare against
        // buyer_org_id / seller_org_id. Cheap targeted select; no join.
        const { data: matchRow } = await supabase
          .from("matches")
          .select("org_id, buyer_org_id, seller_org_id")
          .eq("id", current.match_id)
          .maybeSingle();

        const isOwnSide = isCounterpartySide(authCtx.orgId, current as any, matchRow);
        const side = describeMatchSide(authCtx.orgId, matchRow);

        if (!isOwnSide || !onlyContactFields) {
          const reason = !isOwnSide
            ? (side === null ? "not_on_match" : "wrong_side_or_initiator")
            : "non_contact_field_attempt";
          // Best-effort audit; never block the 403 on audit failure.
          try {
            await supabase.from("audit_logs").insert({
              org_id: current.org_id,
              actor_user_id: authCtx.userId,
              action: "contact.assignment_blocked",
              entity_type: "poi_engagement",
              entity_id: engagementId,
              metadata: {
                actor_role: "org_admin",
                actor_org_id: authCtx.orgId ?? null,
                initiator_org_id: current.org_id,
                counterparty_org_id: (current as { counterparty_org_id?: string | null }).counterparty_org_id ?? null,
                buyer_org_id: matchRow?.buyer_org_id ?? null,
                seller_org_id: matchRow?.seller_org_id ?? null,
                actor_match_side: side,
                reason,
                attempted_fields: Object.keys(parsed.data).filter(
                  (k) => (parsed.data as Record<string, unknown>)[k] !== undefined,
                ),
                request_id: requestId,
              },
            });
          } catch (_e) { /* swallow — audit must never mask the FORBIDDEN */ }
          throw new ApiException(
            "FORBIDDEN",
            !isOwnSide
              ? "You may only edit contact details for the side of the match your organisation is on."
              : "Organisation admins may only edit counterparty_email, contact_type and contact_name on engagements.",
            403,
          );
        }
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
        | {
            status: "binding_review_required";
            email: string;
            reason_codes: string[];
            candidate_count: number;
          }
        | null = null;
      // Tracks whether THIS PATCH transitions the engagement INTO
      // binding_review_required for the first time. The D4b admin
      // alert fires once at the initial-entry transition only, never
      // on subsequent PATCHes that find the row already in review.
      let bindingReviewInitialEntry: {
        candidates: unknown;
        reason_codes: string[];
        candidate_count: number;
      } | null = null;

      if (parsed.data.counterparty_email !== undefined) {
        // Schema already trims + lowercases, but normalise defensively in case
        // the schema is relaxed in future.
        const normalisedEmail = parsed.data.counterparty_email.trim().toLowerCase();
        const prevEmailNorm = ((current as { counterparty_email?: string | null }).counterparty_email ?? "")
          .toString().trim().toLowerCase();

        // ── D2a — refuse unsafe in-place email changes ──
        // Once outreach has begun (status past 'pending') OR any prior
        // contact_attempt has been logged, an admin must use the
        // cancel-for-email-change + recreate flow rather than mutate the
        // recipient on the live row. This protects the immutable outreach
        // history from "the email we contacted" silently changing.
        if (normalisedEmail !== prevEmailNorm) {
          const isPendingStatus = current.engagement_status === "pending";
          let hasContactAttempt = false;
          if (isPendingStatus) {
            const { count } = await supabase
              .from("engagement_outreach_logs")
              .select("id", { count: "exact", head: true })
              .eq("engagement_id", engagementId)
              .eq("entry_type", "contact_attempt");
            hasContactAttempt = (count ?? 0) > 0;
          }
          if (!isPendingStatus || hasContactAttempt) {
            try {
              await supabase.from("audit_logs").insert({
                org_id: current.org_id,
                actor_user_id: authCtx.userId,
                action: "engagement.email_change_refused",
                entity_type: "poi_engagement",
                entity_id: engagementId,
                metadata: {
                  reason: !isPendingStatus
                    ? "engagement_not_pending"
                    : "contact_attempt_exists",
                  current_status: current.engagement_status,
                  previous_email: prevEmailNorm || null,
                  attempted_email: normalisedEmail,
                  request_id: requestId,
                },
              });
            } catch (e) {
              console.warn(`[${requestId}] email_change_refused audit insert failed (non-fatal):`, e);
            }
            throw new ApiException(
              "EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE",
              "This engagement has already been used for outreach. To change the counterparty email, cancel this engagement and create a replacement.",
              409,
            );
          }
        }

        updates.counterparty_email = normalisedEmail;


        // ── Resolve email → registered org (Batch D production resolver) ──
        // Multi-profile lookup that distinguishes safe single-org auto-bind
        // from ambiguous cases (multi-org, shared mailbox, domain-only).
        // Ambiguous cases enter the binding_review_required operational
        // state and fire a one-shot D4b admin alert (initial entry only).
        // Only runs when the row is currently unbound — never overwrites
        // a deliberate prior binding.
        if (!current.counterparty_org_id) {
          const decision = await evaluateCounterpartyEmailBinding(
            supabase,
            normalisedEmail,
          );
          if (decision.kind === "lookup_error") {
            console.warn(
              `[${requestId}] counterparty_email→org resolve failed (non-fatal):`,
              decision.message,
            );
            bindingHint = {
              status: "lookup_error",
              email: normalisedEmail,
              message:
                "Email saved, but the platform could not check whether it matches a registered organisation. Please retry shortly.",
            };
          } else if (decision.kind === "safe_bind") {
            updates.counterparty_org_id = decision.org_id;
            updates.counterparty_type = "known";
            bindingHint = {
              status: "bound",
              org_id: decision.org_id,
              email: normalisedEmail,
            };
            console.log(
              `[${requestId}] Auto-bound engagement ${engagementId} to org ${decision.org_id} via email ${normalisedEmail}`,
            );
          } else if (decision.kind === "binding_review_required") {
            // Persist binding-review state. Only mark this as an
            // "initial entry" if the row was NOT already in the
            // binding_review_required operational state — repeated
            // PATCHes must not duplicate the D4b admin alert.
            const previousOperationalState =
              ((current as { operational_state?: string | null })
                .operational_state ?? null) as string | null;
            const isAlreadyInReview =
              previousOperationalState === "binding_review_required";
            const candidatesPayload = {
              version: 1,
              computed_at: new Date().toISOString(),
              submitted_email: normalisedEmail,
              reason_codes: decision.reason_codes,
              candidates: decision.candidates,
            };
            updates.operational_state = "binding_review_required";
            updates.operational_state_set_by = authCtx.userId;
            updates.operational_state_set_at = new Date().toISOString();
            updates.binding_candidates = candidatesPayload;
            // counterparty_org_id intentionally left NULL.
            bindingHint = {
              status: "binding_review_required",
              email: normalisedEmail,
              reason_codes: decision.reason_codes,
              candidate_count: decision.candidates.length,
            };
            if (!isAlreadyInReview) {
              bindingReviewInitialEntry = {
                candidates: candidatesPayload,
                reason_codes: decision.reason_codes,
                candidate_count: decision.candidates.length,
              };
            }
            console.log(
              `[${requestId}] Engagement ${engagementId} entered binding_review_required (${decision.reason_codes.join(",")}, ${decision.candidates.length} candidates); initial_entry=${!isAlreadyInReview}`,
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

      // ── Branch: real state transition vs. side-field-only edit ──
      // When the PATCH only touches counterparty_email / admin_notes /
      // support_notes / contact_method / contact_date (no engagement_status
      // in the parsed body), there is no state change. Calling
      // atomic_engagement_transition with p_new_status = current.status used
      // to be a same-status pass-through — correct, but it acquired the
      // engagement's advisory lock and re-validated the status enum on every
      // notes/email save, serialising unrelated admin edits.
      //
      // To avoid that overhead we now write the audit + outreach-log rows
      // directly here for the side-field path, and only invoke the RPC when a
      // real status transition is requested. The shape of the audit/outreach
      // rows is intentionally identical to what `atomic_engagement_transition`
      // would have written for a same-status call (see the migration that
      // introduced the `pending` allow-list entry), so the audit ledger is
      // byte-for-byte compatible with prior writes.
      const isRealStateTransition = parsed.data.engagement_status !== undefined;

      if (isRealStateTransition) {
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
            // Audit log: classify "mark contacted" actions distinctly so they
            // appear in the platform-wide audit ledger with method + saved
            // contact detail (carried via the outreach log row referenced by
            // log_id in the audit metadata). For other PATCH operations
            // (status flips, email updates, notes edits) we keep the generic
            // 'engagement.updated' action.
            p_audit_action: isContactAttempt
              ? "engagement.marked_contacted"
              : "engagement.updated",
            p_audit_org_id: current.org_id,
          }
        );

        if (txnErr) throw txnErr;
        const txn = txnResult as { success: boolean; error?: string } | null;
        if (!txn?.success) {
          throw new ApiException("TRANSITION_FAILED", txn?.error || "Atomic transition failed", 500);
        }
      } else {
        // ── Side-field-only path: no RPC, no advisory lock ──
        // Mirror the rows the RPC would have written for a same-status call.
        const noopNotes =
          parsed.data.admin_notes ||
          (entryType === "email_update"
            ? `Counterparty email updated to ${parsed.data.counterparty_email}`
            : null);
        const { data: logRow, error: logErr } = await supabase
          .from("engagement_outreach_logs")
          .insert({
            engagement_id: engagementId,
            actor_type: "admin",
            admin_user_id: authCtx.userId,
            admin_email: adminProfile?.email || "unknown",
            admin_name: adminProfile?.full_name || null,
            entry_type: entryType,
            contact_method: null,
            contact_detail: null,
            previous_status: current.engagement_status,
            new_status: current.engagement_status,
            notes: noopNotes,
          })
          .select("id")
          .single();
        if (logErr) throw logErr;
        const { error: auditErr } = await supabase.from("audit_logs").insert({
          org_id: current.org_id,
          actor_user_id: authCtx.userId,
          action: "engagement.updated",
          entity_type: "poi_engagement",
          entity_id: engagementId,
          metadata: {
            previous_status: current.engagement_status,
            new_status: current.engagement_status,
            log_id: logRow?.id ?? null,
            // Mark this as the side-field path so we can distinguish it from
            // genuine no-op same-status transitions in the audit ledger.
            no_state_change: true,
            entry_type: entryType,
          },
        });
        if (auditErr) throw auditErr;
        console.log(
          `[${requestId}] Engagement ${engagementId} side-field PATCH (${entryType}); status remains ${current.engagement_status}; RPC skipped`
        );
      }

      // Apply non-state field updates (counterparty_email, admin_notes, support_notes, contact_method, contact_date)
      // These are not part of the state machine and don't affect the audit chain.
      const sideUpdates: Record<string, unknown> = {};
      if (parsed.data.counterparty_email !== undefined) {
        // Persist the normalised (trim/lowercase) form, not the raw input.
        sideUpdates.counterparty_email =
          (updates.counterparty_email as string | undefined) ??
          parsed.data.counterparty_email.trim().toLowerCase();
      }
      // Carry the auto-resolved binding fields (set above when an email matched a registered profile)
      if (updates.counterparty_org_id !== undefined) sideUpdates.counterparty_org_id = updates.counterparty_org_id;
      if (updates.counterparty_type !== undefined) sideUpdates.counterparty_type = updates.counterparty_type;
      // Batch D — production binding-review path. When the resolver
      // detects ambiguity it sets these on `updates`; we propagate
      // them here so the row enters the binding_review_required
      // operational state in the same write as the email update.
      if (updates.operational_state !== undefined) sideUpdates.operational_state = updates.operational_state;
      if (updates.operational_state_set_by !== undefined) sideUpdates.operational_state_set_by = updates.operational_state_set_by;
      if (updates.operational_state_set_at !== undefined) sideUpdates.operational_state_set_at = updates.operational_state_set_at;
      if (updates.binding_candidates !== undefined) sideUpdates.binding_candidates = updates.binding_candidates;
      if (parsed.data.admin_notes !== undefined) sideUpdates.admin_notes = parsed.data.admin_notes;
      if (parsed.data.contact_method !== undefined) sideUpdates.contact_method = parsed.data.contact_method;
      if (parsed.data.contact_date !== undefined) sideUpdates.contact_date = parsed.data.contact_date;
      // Batch A — contact-completeness fields. Empty string was already
      // normalised to null by the Zod schema; undefined means "leave alone".
      if (parsed.data.contact_type !== undefined) sideUpdates.contact_type = parsed.data.contact_type;
      if (parsed.data.contact_name !== undefined) {
        const cn = parsed.data.contact_name;
        sideUpdates.contact_name = cn === null ? null : (cn.trim() === "" ? null : cn.trim());
      }
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

      // ── Batch D — binding-review initial-entry side-effects ──
      // Fires exactly once when the engagement first transitions into
      // binding_review_required. Subsequent PATCHes that find the row
      // already in review take the `isAlreadyInReview` short-circuit
      // above and skip this block entirely.
      // The D4b admin alert helper targets the platform admin mailbox
      // + Slack only; no counterparty/org-admin/external recipient is
      // derived here. Outreach log uses entry_type='system_action'
      // (existing CHECK value, no constraint change).
      if (bindingReviewInitialEntry) {
        try {
          await supabase.from("engagement_outreach_logs").insert({
            engagement_id: engagementId,
            actor_type: "system",
            previous_status: current.engagement_status,
            new_status: current.engagement_status,
            entry_type: "system_action",
            notes: JSON.stringify({
              event: "binding_review_required",
              reason_codes: bindingReviewInitialEntry.reason_codes,
              candidate_count: bindingReviewInitialEntry.candidate_count,
              request_id: requestId,
            }),
          });
        } catch (logErr) {
          console.warn(
            `[${requestId}] binding_review_required outreach log insert failed (non-fatal):`,
            logErr,
          );
        }
        try {
          await supabase.from("audit_logs").insert({
            org_id: current.org_id,
            actor_user_id: authCtx.userId,
            action: "engagement.binding_review_required",
            entity_type: "poi_engagement",
            entity_id: engagementId,
            metadata: {
              reason_codes: bindingReviewInitialEntry.reason_codes,
              candidate_count: bindingReviewInitialEntry.candidate_count,
              previous_operational_state:
                ((current as { operational_state?: string | null }).operational_state) ?? null,
              source: "poi-engagements:patch_resolver",
              request_id: requestId,
            },
          });
        } catch (e) {
          console.warn(
            `[${requestId}] binding_review_required audit insert failed (non-fatal):`,
            e,
          );
        }
        try {
          await dispatchD4bAdminAlert(supabase, {
            eventType: "engagement.binding_review_required",
            engagementId,
            engagement: {
              engagement_status: updated?.engagement_status ?? null,
              operational_state: "binding_review_required",
              org_id: current.org_id,
            },
            sourceFunction: "poi-engagements:patch_initial_entry",
          });
        } catch (notifyErr) {
          console.warn(
            `[${requestId}] D4b binding_review_required admin alert failed (non-fatal):`,
            notifyErr,
          );
        }
      }

      // ── Batch A — emit contact.assigned / contact.updated audit row ──
      // Fires when contact_type, contact_name, or counterparty_email actually
      // changed value. First-time assignment (all previous fields null/empty)
      // → assigned; any subsequent change → updated. actor_role is derived
      // from the authenticated context, never from the request body.
      if (
        parsed.data.contact_type !== undefined ||
        parsed.data.contact_name !== undefined ||
        parsed.data.counterparty_email !== undefined
      ) {
        const prevType = (current as { contact_type?: string | null }).contact_type ?? null;
        const prevName = ((current as { contact_name?: string | null }).contact_name ?? "").toString().trim() || null;
        const prevEmail = ((current as { counterparty_email?: string | null }).counterparty_email ?? "").toString().trim().toLowerCase() || null;
        const nextType = (sideUpdates.contact_type as string | null | undefined) ?? prevType ?? null;
        const nextNameRaw = sideUpdates.contact_name as string | null | undefined;
        const nextName = nextNameRaw === undefined ? prevName : (nextNameRaw === null ? null : nextNameRaw);
        const nextEmail = parsed.data.counterparty_email !== undefined
          ? parsed.data.counterparty_email.trim().toLowerCase()
          : prevEmail;
        const changed = prevType !== nextType || prevName !== nextName || prevEmail !== nextEmail;
        if (changed) {
          const wasUnset = !prevType && !prevName && !prevEmail;
          const action = wasUnset ? "contact.assigned" : "contact.updated";
          const actorRole = isPlatformAdmin ? "platform_admin" : "org_admin";
          try {
            await supabase.from("audit_logs").insert({
              org_id: current.org_id,
              actor_user_id: authCtx.userId,
              action,
              entity_type: "poi_engagement",
              entity_id: engagementId,
              metadata: {
                actor_role: actorRole,
                actor_org_id: authCtx.orgId ?? null,
                previous: { contact_type: prevType, contact_name: prevName, counterparty_email: prevEmail },
                next: { contact_type: nextType, contact_name: nextName, counterparty_email: nextEmail },
                request_id: requestId,
              },
            });
          } catch (e) {
            console.warn(`[${requestId}] Failed to insert ${action} audit row (non-fatal):`, e);
          }
        }
      }

      // ── Audit ledger enrichment for "mark contacted" ──
      // The atomic RPC writes a generic engagement.updated/marked_contacted
      // row (status_only). For contact_attempt entries we additionally
      // persist the chosen method and the saved contact detail (email /
      // phone / WhatsApp / LinkedIn URL / etc.) directly into audit_logs
      // metadata, so the platform-wide audit ledger is self-contained and
      // does not require a join to engagement_outreach_logs to answer
      // "which channel did the admin use, and what address was recorded?".
      // Non-fatal: a failure here MUST NOT undo the state transition that
      // already committed inside the RPC, hence the swallow-and-log.
      if (isContactAttempt) {
        try {
          await supabase.from("audit_logs").insert({
            org_id: current.org_id,
            actor_user_id: authCtx.userId,
            action: "engagement.contact_recorded",
            entity_type: "poi_engagement",
            entity_id: engagementId,
            metadata: {
              previous_status: current.engagement_status,
              new_status: targetStatus,
              contact_method: parsed.data.contact_method,
              contact_detail: parsed.data.contact_detail,
              counterparty_email: updated?.counterparty_email ?? null,
              admin_email: adminProfile?.email ?? null,
              admin_name: adminProfile?.full_name ?? null,
              request_id: requestId,
            },
          });
        } catch (auditErr) {
          console.error(
            `[${requestId}] Failed to insert engagement.contact_recorded audit row (non-fatal):`,
            auditErr,
          );
        }
      }

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

      const responseBody: Record<string, unknown> = { engagement: updated };
      if (bindingHint) responseBody.binding = bindingHint;
      await storeIdempotentResponse(idemOpts, { status: 200, body: responseBody });
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── POST /poi-engagements/:id/dispute — Admin records a dispute ──
    // D2a (Option C): the named counterparty has told Izenzo (via the
    // tokenised link OR via an out-of-band channel like phone/email) that
    // they are not the right counterparty. Two truthful sources are
    // supported:
    //   • dispute_source='counterparty_token' → token_hash REQUIRED
    //   • dispute_source='admin_report'       → token_hash MAY be omitted
    // The CHECK constraint poi_engagements_dispute_required_fields
    // enforces both shapes server-side; this endpoint mirrors them and
    // refuses inconsistent payloads BEFORE the UPDATE.
    if (req.method === "POST" && engagementId && parts[1] === "dispute") {
      requireRole(authCtx, "platform_admin");

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(engagementId)) {
        throw new ApiException("VALIDATION_ERROR", "Invalid engagement ID format", 400);
      }

      const idempotencyKey = req.headers.get("Idempotency-Key");
      if (!idempotencyKey) {
        throw new ApiException("VALIDATION_ERROR", "Idempotency-Key header is required", 400);
      }
      const idemOpts = {
        supabase,
        orgId: authCtx.orgId ?? "platform",
        endpoint: `POST /poi-engagements/${engagementId}/dispute`,
        idempotencyKey,
        requestId,
      };
      const cached = await lookupIdempotentResponse(idemOpts);
      if (cached) return cachedResponseToHttp(cached, headers);

      const DisputeSchema = z.object({
        reason: z.string().trim().min(10).max(1000),
        dispute_source: z.enum(["counterparty_token", "admin_report"]),
        token_hash: z.string().trim().min(1).max(256).optional().nullable(),
      }).superRefine((val, ctx) => {
        if (val.dispute_source === "counterparty_token") {
          if (!val.token_hash || val.token_hash.trim().length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["token_hash"],
              message: "token_hash is required when dispute_source='counterparty_token'",
            });
          }
        }
      });
      const body = await req.json().catch(() => ({}));
      const parsed = DisputeSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiException(
          "VALIDATION_ERROR",
          JSON.stringify(parsed.error.flatten().fieldErrors),
          400,
        );
      }

      const { data: current, error: fetchErr } = await supabase
        .from("poi_engagements")
        .select("*")
        .eq("id", engagementId)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!current) {
        throw new ApiException("NOT_FOUND", "Engagement not found", 404);
      }
      if (current.engagement_status === "disputed_being_named") {
        throw new ApiException(
          "ALREADY_DISPUTED",
          "This engagement has already been recorded as disputed.",
          409,
        );
      }

      const { data: adminProfile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", authCtx.userId)
        .maybeSingle();

      const nowIso = new Date().toISOString();
      const tokenHash =
        parsed.data.dispute_source === "counterparty_token"
          ? parsed.data.token_hash!.trim()
          : null;

      const { data: updated, error: updErr } = await supabase
        .from("poi_engagements")
        .update({
          engagement_status: "disputed_being_named",
          operational_state: "disputed_being_named",
          operational_state_set_by: authCtx.userId,
          operational_state_set_at: nowIso,
          disputed_at: nowIso,
          dispute_source: parsed.data.dispute_source,
          disputed_by_token_hash: tokenHash,
          dispute_reason: parsed.data.reason,
          dispute_metadata: {
            previous_status: current.engagement_status,
            actor_user_id: authCtx.userId,
            source: parsed.data.dispute_source,
            recorded_at: nowIso,
            request_id: requestId,
          },
        })
        .eq("id", engagementId)
        .select()
        .single();
      if (updErr) throw updErr;

      try {
        await supabase.from("engagement_outreach_logs").insert({
          engagement_id: engagementId,
          actor_type: "admin",
          admin_user_id: authCtx.userId,
          admin_email: adminProfile?.email ?? "unknown",
          admin_name: adminProfile?.full_name ?? null,
          previous_status: current.engagement_status,
          new_status: "disputed_being_named",
          entry_type: "dispute_raised",
          notes: JSON.stringify({
            event: "dispute_raised",
            dispute_source: parsed.data.dispute_source,
            has_token_hash: !!tokenHash,
            reason: parsed.data.reason,
            request_id: requestId,
          }),
        });
      } catch (logErr) {
        console.warn(`[${requestId}] dispute_raised log insert failed (non-fatal):`, logErr);
      }
      try {
        await supabase.from("audit_logs").insert({
          org_id: current.org_id,
          actor_user_id: authCtx.userId,
          action: "engagement.dispute_raised",
          entity_type: "poi_engagement",
          entity_id: engagementId,
          metadata: {
            dispute_source: parsed.data.dispute_source,
            has_token_hash: !!tokenHash,
            previous_status: current.engagement_status,
            request_id: requestId,
          },
        });
      } catch (e) {
        console.warn(`[${requestId}] dispute audit insert failed (non-fatal):`, e);
      }

      // D4b: admin-only alert for dispute_raised. Best-effort; never
      // fails the request. Recipient is hard-coded to the platform
      // admin mailbox + Slack inside the helper — no counterparty,
      // org-admin, or external recipient is derived here.
      try {
        await dispatchD4bAdminAlert(supabase, {
          eventType: "engagement.disputed_being_named",
          engagementId,
          engagement: {
            engagement_status: updated.engagement_status,
            operational_state: updated.operational_state,
            org_id: current.org_id,
          },
          sourceFunction: "poi-engagements:dispute_raised",
        });
      } catch (notifyErr) {
        console.warn(`[${requestId}] D4b admin alert failed (non-fatal):`, notifyErr);
      }

      const responseBody = { engagement: updated };
      await storeIdempotentResponse(idemOpts, { status: 200, body: responseBody });
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── POST /poi-engagements/:id/cancel-for-email-change — Admin cancels ──
    // D2a: when the recorded counterparty email turns out to be wrong and
    // outreach has already begun (so PATCH /counterparty_email is refused),
    // the only safe path is to cancel the live engagement and create a
    // replacement. This endpoint performs the cancel half only —
    // replacement creation is intentionally out of scope for D2a.
    if (req.method === "POST" && engagementId && parts[1] === "cancel-for-email-change") {
      requireRole(authCtx, "platform_admin");

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(engagementId)) {
        throw new ApiException("VALIDATION_ERROR", "Invalid engagement ID format", 400);
      }

      const idempotencyKey = req.headers.get("Idempotency-Key");
      if (!idempotencyKey) {
        throw new ApiException("VALIDATION_ERROR", "Idempotency-Key header is required", 400);
      }
      const idemOpts = {
        supabase,
        orgId: authCtx.orgId ?? "platform",
        endpoint: `POST /poi-engagements/${engagementId}/cancel-for-email-change`,
        idempotencyKey,
        requestId,
      };
      const cached = await lookupIdempotentResponse(idemOpts);
      if (cached) return cachedResponseToHttp(cached, headers);

      const CancelSchema = z.object({
        new_email: z
          .string()
          .trim()
          .toLowerCase()
          .min(3)
          .max(254)
          .email(),
        reason: z.string().trim().max(1000).optional(),
      });
      const body = await req.json().catch(() => ({}));
      const parsed = CancelSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiException(
          "VALIDATION_ERROR",
          JSON.stringify(parsed.error.flatten().fieldErrors),
          400,
        );
      }

      const { data: current, error: fetchErr } = await supabase
        .from("poi_engagements")
        .select("*")
        .eq("id", engagementId)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!current) {
        throw new ApiException("NOT_FOUND", "Engagement not found", 404);
      }
      if (current.engagement_status === "cancelled_email_change") {
        throw new ApiException(
          "ALREADY_CANCELLED",
          "This engagement has already been cancelled for an email change.",
          409,
        );
      }

      const { data: adminProfile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", authCtx.userId)
        .maybeSingle();

      const nowIso = new Date().toISOString();
      const oldEmail = ((current as { counterparty_email?: string | null }).counterparty_email ?? "")
        .toString().trim().toLowerCase() || null;

      // Satisfy poi_engagements_cancellation_required_fields:
      //   cancelled_at + cancelled_reason (non-empty) + cancelled_by_user_id
      const { data: updated, error: updErr } = await supabase
        .from("poi_engagements")
        .update({
          engagement_status: "cancelled_email_change",
          operational_state: "cancelled_for_email_change",
          operational_state_set_by: authCtx.userId,
          operational_state_set_at: nowIso,
          cancelled_at: nowIso,
          cancelled_reason: "email_change",
          cancelled_by_user_id: authCtx.userId,
        })
        .eq("id", engagementId)
        .select()
        .single();
      if (updErr) throw updErr;

      try {
        await supabase.from("engagement_outreach_logs").insert({
          engagement_id: engagementId,
          actor_type: "admin",
          admin_user_id: authCtx.userId,
          admin_email: adminProfile?.email ?? "unknown",
          admin_name: adminProfile?.full_name ?? null,
          previous_status: current.engagement_status,
          new_status: "cancelled_email_change",
          entry_type: "cancelled",
          notes: JSON.stringify({
            event: "cancelled_for_email_change",
            old_email: oldEmail,
            new_email: parsed.data.new_email,
            reason: parsed.data.reason ?? null,
            request_id: requestId,
          }),
        });
      } catch (logErr) {
        console.warn(`[${requestId}] cancelled log insert failed (non-fatal):`, logErr);
      }
      try {
        await supabase.from("audit_logs").insert({
          org_id: current.org_id,
          actor_user_id: authCtx.userId,
          action: "engagement.cancelled_for_email_change",
          entity_type: "poi_engagement",
          entity_id: engagementId,
          metadata: {
            previous_status: current.engagement_status,
            old_email: oldEmail,
            new_email: parsed.data.new_email,
            reason: parsed.data.reason ?? null,
            request_id: requestId,
          },
        });
      } catch (e) {
        console.warn(`[${requestId}] cancel audit insert failed (non-fatal):`, e);
      }

      const responseBody = { engagement: updated };
      await storeIdempotentResponse(idemOpts, { status: 200, body: responseBody });
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── POST /poi-engagements/:id/resolve-binding — D2b admin resolver ──
    // D2b: when an engagement is parked in `binding_review_required` (or
    // has `binding_candidates` populated with no `binding_resolution`),
    // a platform admin reviews the candidate identities and explicitly
    // records one of three outcomes:
    //   • confirmed_canonical          → bind to selected_org_id, clear
    //                                    operational_state, allow progression
    //   • deferred_no_review_needed    → record decision, clear
    //                                    operational_state, allow progression
    //   • rejected                     → record decision, KEEP
    //                                    operational_state=binding_review_required
    //                                    so outreach/progression remain blocked
    // Audit row is written to engagement_outreach_logs with the full
    // structured payload (event, resolution, selected_org_id, admin_notes,
    // previous_operational_state, request_id) JSON-encoded into `notes`
    // because that table has no `metadata` column.
    if (req.method === "POST" && engagementId && parts[1] === "resolve-binding") {
      requireRole(authCtx, "platform_admin");

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(engagementId)) {
        throw new ApiException("VALIDATION_ERROR", "Invalid engagement ID format", 400);
      }

      const idempotencyKey = req.headers.get("Idempotency-Key");
      if (!idempotencyKey) {
        throw new ApiException("VALIDATION_ERROR", "Idempotency-Key header is required", 400);
      }
      const idemOpts = {
        supabase,
        orgId: authCtx.orgId ?? "platform",
        endpoint: `POST /poi-engagements/${engagementId}/resolve-binding`,
        idempotencyKey,
        requestId,
      };
      const cached = await lookupIdempotentResponse(idemOpts);
      if (cached) return cachedResponseToHttp(cached, headers);

      const ResolveSchema = z
        .object({
          resolution: z.enum([
            "confirmed_canonical",
            "rejected",
            "deferred_no_review_needed",
          ]),
          selected_org_id: z.string().uuid().optional().nullable(),
          notes: z.string().trim().min(20).max(1000),
        })
        .superRefine((val, ctx) => {
          if (val.resolution === "confirmed_canonical") {
            if (!val.selected_org_id) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["selected_org_id"],
                message:
                  "selected_org_id is required when resolution='confirmed_canonical'",
              });
            }
          } else if (val.selected_org_id) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["selected_org_id"],
              message:
                "selected_org_id must be omitted unless resolution='confirmed_canonical'",
            });
          }
        });

      const body = await req.json().catch(() => ({}));
      const parsed = ResolveSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiException(
          "VALIDATION_ERROR",
          JSON.stringify(parsed.error.flatten().fieldErrors),
          400,
        );
      }

      const { data: current, error: fetchErr } = await supabase
        .from("poi_engagements")
        .select("*")
        .eq("id", engagementId)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!current) {
        throw new ApiException("NOT_FOUND", "Engagement not found", 404);
      }

      const previousOperationalState =
        (current as { operational_state?: string | null }).operational_state ?? null;
      const bindingCandidates = (current as { binding_candidates?: unknown }).binding_candidates ?? null;
      const bindingResolution =
        (current as { binding_resolution?: string | null }).binding_resolution ?? null;

      // Already-resolved must be checked BEFORE the "in binding review"
      // gate, otherwise a row that has been confirmed_canonical / deferred
      // (op_state cleared, binding_resolution set) would be rejected as
      // NOT_PENDING instead of the correct ALREADY_RESOLVED.
      if (bindingResolution != null) {
        throw new ApiException(
          "BINDING_REVIEW_ALREADY_RESOLVED",
          "This engagement's binding review has already been resolved.",
          409,
        );
      }
      const inBindingReview =
        previousOperationalState === "binding_review_required" ||
        (bindingCandidates != null && bindingResolution == null);
      if (!inBindingReview) {
        throw new ApiException(
          "BINDING_REVIEW_NOT_PENDING",
          "This engagement is not awaiting a binding review.",
          409,
        );
      }

      const { data: adminProfile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", authCtx.userId)
        .maybeSingle();

      const nowIso = new Date().toISOString();

      // Build the update payload according to the chosen resolution.
      const updatePayload: Record<string, unknown> = {
        binding_resolution: parsed.data.resolution,
        operational_state_set_by: authCtx.userId,
        operational_state_set_at: nowIso,
      };
      if (parsed.data.resolution === "confirmed_canonical") {
        updatePayload.counterparty_org_id = parsed.data.selected_org_id;
        updatePayload.operational_state = null;
      } else if (parsed.data.resolution === "deferred_no_review_needed") {
        updatePayload.operational_state = null;
      } else {
        // rejected — keep the row blocked.
        updatePayload.operational_state = "binding_review_required";
      }

      const { data: updated, error: updErr } = await supabase
        .from("poi_engagements")
        .update(updatePayload)
        .eq("id", engagementId)
        .select()
        .single();
      if (updErr) throw updErr;

      try {
        await supabase.from("engagement_outreach_logs").insert({
          engagement_id: engagementId,
          actor_type: "admin",
          admin_user_id: authCtx.userId,
          admin_email: adminProfile?.email ?? "unknown",
          admin_name: adminProfile?.full_name ?? null,
          previous_status: current.engagement_status,
          new_status: current.engagement_status,
          entry_type: "binding_review_resolved",
          notes: JSON.stringify({
            event: "binding_review_resolved",
            resolution: parsed.data.resolution,
            selected_org_id: parsed.data.selected_org_id ?? null,
            admin_notes: parsed.data.notes,
            previous_operational_state: previousOperationalState,
            request_id: requestId,
          }),
        });
      } catch (logErr) {
        console.warn(`[${requestId}] binding_review_resolved log insert failed (non-fatal):`, logErr);
      }
      try {
        await supabase.from("audit_logs").insert({
          org_id: current.org_id,
          actor_user_id: authCtx.userId,
          action: "engagement.binding_review_resolved",
          entity_type: "poi_engagement",
          entity_id: engagementId,
          metadata: {
            resolution: parsed.data.resolution,
            selected_org_id: parsed.data.selected_org_id ?? null,
            previous_operational_state: previousOperationalState,
            request_id: requestId,
          },
        });
      } catch (e) {
        console.warn(`[${requestId}] binding_review audit insert failed (non-fatal):`, e);
      }

      const responseBody = { engagement: updated };
      await storeIdempotentResponse(idemOpts, { status: 200, body: responseBody });
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }


    // ── POST /poi-engagements/:engagementId/decline-late-acceptance — Initiator declines ──
    // Batch B Phase 3: late-acceptance resolution endpoints. Both routes
    // are restricted to a member of the initiating organisation
    // (engagement.org_id). Both delegate to a SECURITY DEFINER RPC that
    // takes an advisory lock on the parent engagement so concurrent
    // double-clicks cannot create two child rows or two resolutions.
    if (
      req.method === "POST" &&
      typeof engagementId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(engagementId) &&
      (parts[1] === "reconfirm" || parts[1] === "decline-late-acceptance")
    ) {
      const action = parts[1] as "reconfirm" | "decline-late-acceptance";

      const { data: parent, error: parentErr } = await supabase
        .from("poi_engagements")
        .select("id, org_id, engagement_status, reconfirmation_window_expires_at")
        .eq("id", engagementId)
        .maybeSingle();
      if (parentErr) throw parentErr;
      if (!parent) {
        throw new ApiException("NOT_FOUND", "Engagement not found", 404);
      }
      if (parent.org_id !== authCtx.orgId) {
        throw new ApiException(
          "FORBIDDEN",
          "Only the initiating organisation can resolve a late acceptance.",
          403,
        );
      }

      // Phase 3 Issue 3 fix: reconfirm / decline-late-acceptance create or
      // foreclose a renewed engagement. They are workflow-authority actions,
      // not ordinary participation. Restrict to org_admin on the initiating
      // org, with an explicit, separately-audited platform_admin override.
      const isInitiatorOrgAdmin = authCtx.roles.includes("org_admin");
      const isPlatformAdminOverride = authCtx.roles.includes("platform_admin");
      if (!isInitiatorOrgAdmin && !isPlatformAdminOverride) {
        throw new ApiException(
          "FORBIDDEN",
          "Only an organisation admin on the initiating side can resolve a late acceptance.",
          403,
        );
      }

      const { data: actorProfile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", authCtx.userId)
        .maybeSingle();

      const rpcName =
        action === "reconfirm"
          ? "atomic_reconfirm_late_acceptance"
          : "atomic_decline_late_acceptance";

      const { data: rpcResult, error: rpcErr } = await supabase.rpc(rpcName, {
        p_parent_engagement_id: engagementId,
        p_actor_user_id: authCtx.userId,
        p_actor_email: actorProfile?.email ?? null,
        p_actor_name: actorProfile?.full_name ?? null,
        p_audit_org_id: authCtx.orgId,
      });

      if (rpcErr) {
        const pgCode = (rpcErr as { code?: string }).code || "unknown";
        const pgMsg = (rpcErr as { message?: string }).message || String(rpcErr);
        console.error(
          `[${requestId}] ${rpcName} failed for engagement ${engagementId}: code=${pgCode} msg=${pgMsg}`,
        );
        throw new ApiException(
          "LATE_ACCEPTANCE_RESOLUTION_FAILED",
          `Could not ${action.replace(/-/g, " ")} (db ${pgCode}). Please try again in a moment.`,
          500,
        );
      }
      const txn = rpcResult as { success: boolean; error?: string } | null;
      if (!txn?.success) {
        throw new ApiException(
          "LATE_ACCEPTANCE_RESOLUTION_FAILED",
          txn?.error || `Could not ${action.replace(/-/g, " ")}.`,
          409,
        );
      }

      const { data: parentAfter } = await supabase
        .from("poi_engagements")
        .select()
        .eq("id", engagementId)
        .single();

      let renewedChild = null as Record<string, unknown> | null;
      const renewedId = (rpcResult as { renewed_engagement_id?: string } | null)
        ?.renewed_engagement_id;
      if (renewedId) {
        const { data: child } = await supabase
          .from("poi_engagements")
          .select()
          .eq("id", renewedId)
          .single();
        renewedChild = child as Record<string, unknown> | null;
      }

      // Phase 3 Issue 3: separately-audited record of the platform_admin
      // override path so it is never silently mixed with org_admin actions.
      if (!isInitiatorOrgAdmin && isPlatformAdminOverride) {
        try {
          await supabase.from("audit_logs").insert({
            org_id: authCtx.orgId,
            actor_user_id: authCtx.userId,
            action: "pending_engagement.late_acceptance_resolved_via_platform_admin_override",
            entity_type: "poi_engagement",
            entity_id: engagementId,
            metadata: {
              actor_role: "platform_admin",
              actor_org_id: authCtx.orgId ?? null,
              resolution_action: action,
              request_id: requestId,
            },
          });
        } catch (e) {
          console.error(`[${requestId}] platform_admin override audit insert failed`, e);
        }
      }

      console.log(
        `[${requestId}] Initiator ${authCtx.orgId} ${action} on engagement ${engagementId} (role=${isInitiatorOrgAdmin ? "org_admin" : "platform_admin_override"})`,
      );

      return new Response(
        JSON.stringify({
          parent_engagement: parentAfter,
          renewed_engagement: renewedChild,
          rpc: rpcResult,
        }),
        {
          status: 200,
          headers: { ...headers, "Content-Type": "application/json" },
        },
      );
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

      // ── Batch B Phase 3: late-acceptance routing ──────────────────────
      // If the counterparty is trying to accept an engagement that has
      // already expired, do NOT progress the POI. Record the late
      // acceptance via the dedicated atomic RPC, which puts the row into
      // `late_acceptance_pending_initiator_reconfirmation` and starts a
      // 7-day initiator reconfirmation window. No POI mint, no WaD, no
      // credit burn, no payment events.
      const expiresAtMs = engagement.expires_at ? Date.parse(engagement.expires_at) : null;
      const isExpired =
        currentStatus === "expired" ||
        (expiresAtMs !== null && Date.now() > expiresAtMs);

      // ── Phase 3 patch: stable rejections for terminal / already-recorded
      // states. Do NOT route resolved engagements into the late-acceptance
      // RPC and rely on it to reject — return clear, observable codes.
      // Statuses eligible for late-acceptance routing: pending,
      // notification_sent, contacted, expired (when expires_at < now()).
      if (parsed.data.action === "accepted" && isExpired) {
        if (currentStatus === "accepted") {
          throw new ApiException(
            "ENGAGEMENT_ALREADY_ACCEPTED",
            "This engagement has already been accepted.",
            409,
          );
        }
        if (currentStatus === "declined") {
          throw new ApiException(
            "ENGAGEMENT_ALREADY_DECLINED",
            "This engagement has already been declined and cannot be accepted.",
            409,
          );
        }
        if (currentStatus === "late_acceptance_pending_initiator_reconfirmation") {
          throw new ApiException(
            "LATE_ACCEPTANCE_ALREADY_RECORDED",
            "Late acceptance has already been recorded; awaiting initiator reconfirmation.",
            409,
          );
        }
      }

      const LATE_ACCEPTANCE_ELIGIBLE_STATUSES = new Set([
        "pending",
        "notification_sent",
        "contacted",
        "expired",
      ]);
      if (
        parsed.data.action === "accepted" &&
        isExpired &&
        LATE_ACCEPTANCE_ELIGIBLE_STATUSES.has(currentStatus)
      ) {
        const { data: lateProfile } = await supabase
          .from("profiles")
          .select("email, full_name")
          .eq("id", authCtx.userId)
          .maybeSingle();

        const { data: lateRpcResult, error: lateRpcErr } = await supabase.rpc(
          "atomic_record_late_acceptance",
          {
            p_engagement_id: engagement.id,
            p_actor_user_id: authCtx.userId,
            p_actor_email: lateProfile?.email ?? null,
            p_actor_name: lateProfile?.full_name ?? null,
            p_audit_org_id: authCtx.orgId,
          },
        );

        if (lateRpcErr) {
          const pgCode = (lateRpcErr as { code?: string }).code || "unknown";
          const pgMsg = (lateRpcErr as { message?: string }).message || String(lateRpcErr);
          console.error(
            `[${requestId}] atomic_record_late_acceptance failed for engagement ${engagement.id}: code=${pgCode} msg=${pgMsg}`,
          );
          throw new ApiException(
            "LATE_ACCEPTANCE_FAILED",
            `Could not record your late acceptance (db ${pgCode}). Please try again in a moment.`,
            500,
          );
        }
        const lateTxn = lateRpcResult as { success: boolean; error?: string } | null;
        if (!lateTxn?.success) {
          throw new ApiException(
            "LATE_ACCEPTANCE_FAILED",
            lateTxn?.error || "Could not record late acceptance.",
            409,
          );
        }

        const { data: lateUpdated } = await supabase
          .from("poi_engagements")
          .select()
          .eq("id", engagement.id)
          .single();

        console.log(
          `[${requestId}] Counterparty ${authCtx.orgId} late-accepted engagement ${engagement.id}; awaiting initiator reconfirmation`,
        );

        return new Response(
          JSON.stringify({
            engagement: lateUpdated,
            late_acceptance: {
              recorded: true,
              counterparty_response: "accepted_after_expiry",
              state: "late_acceptance_pending_initiator_reconfirmation",
              reconfirmation_window_expires_at:
                (lateRpcResult as { reconfirmation_window_expires_at?: string } | null)
                  ?.reconfirmation_window_expires_at ?? null,
            },
          }),
          {
            status: 200,
            headers: { ...headers, "Content-Type": "application/json" },
          },
        );
      }

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

      // Wrap raw Postgres errors into an ApiException so the client gets a
      // diagnosable 500 instead of the opaque "An internal error occurred"
      // shim. Surfaces the SQLSTATE/message for the request log without
      // leaking the stack trace.
      if (txnErr) {
        const pgCode = (txnErr as { code?: string }).code || "unknown";
        const pgMsg = (txnErr as { message?: string }).message || String(txnErr);
        console.error(
          `[${requestId}] atomic_engagement_transition failed for engagement ${engagement.id}: code=${pgCode} msg=${pgMsg}`
        );
        throw new ApiException(
          "TRANSITION_FAILED",
          `Could not record your response (db ${pgCode}). The team has been notified — please try again in a moment.`,
          500
        );
      }
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
