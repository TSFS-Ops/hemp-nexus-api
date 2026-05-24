import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { ApiException, errorResponse, extractSourceLocation } from "../_shared/errors.ts";
import { validateInput } from "../_shared/validation.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import {
  cachedResponseToHttp,
  lookupIdempotentResponse,
  sha256Hex,
  storeIdempotentResponse,
} from "../_shared/idempotency.ts";
import { checkMaintenanceMode, logDecision, tryBypass } from "../_shared/test-mode-bypass.ts";
import { checkOrgLegitimacy, getActiveGovernanceProfile, ORG_NOT_VERIFIED_CODE } from "../_shared/legitimacy.ts";
import { clampSubject } from "../_shared/email-subject.ts";
import { dispatchD4bAdminAlert } from "../_shared/batch-d-admin-notify.ts";
import { dispatchD4cInitiatorAlert } from "../_shared/batch-d-initiator-notify.ts";
import {
  assertPreAcceptanceSafe,
  assertPoiWordingSafe,
  UNSAFE_PRE_ACCEPTANCE_WARNING,
  UNSAFE_POI_WARNING,
  PENDING_ENGAGEMENT_LABEL,
  INITIATOR_PENDING_COPY,
  OUTREACH_INVITATION_COPY,
  DRAFT_POI_LABEL,
  ACCEPTED_POI_LABEL,
  POST_ACCEPTANCE_QUALIFIER,
} from "../_shared/legal-wording.ts";
import { assertClaimSafe } from "../_shared/legal-claims.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { resolveNotificationsFor } from "../_shared/resolve-notifications.ts";
import { evaluateCounterpartyEmailBinding } from "../_shared/binding-resolver.ts";
import { recordNotificationSkipped } from "../_shared/notification-skip-audit.ts";
// Batch A — single source of truth for contact-completeness gating.
// Mirror of `src/lib/contact-completeness.ts`. Both files MUST stay in
// lockstep; the regression tests pin both surfaces.
import {
  getContactState,
  isOutreachBlocked,
  isUsableContactEmail,
  contactBlockReason,
  contactBlockCode,
  contactStateLabel,
  type ContactState,
} from "../_shared/contact-completeness.ts";
import {
  isCounterpartySide,
  describeMatchSide,
} from "../_shared/engagement-counterparty.ts";
// MT-008 / MT-009 — server-side progression guard. Must run before any
// outreach side effect (email send, immutable outreach-log row, status
// transition, credit-related event) on a match-bound engagement.
import {
  assertMatchProgressable,
  buildProgressionGuardResponse,
} from "../_shared/match-progression-guard.ts";


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

// ── Batch J — Supersession + initiator-cancellation gates ──────────────
//
// SUPERSEDED_ENGAGEMENT_STATUSES — any incoming respond/decline/dispute
// against an engagement whose lifecycle has been wound down by a
// replacement or initiator-side withdrawal MUST be rejected with a
// stable, typed code (`ENGAGEMENT_SUPERSEDED`). The DB enum carries
// these terminal-by-supersession values; this constant keeps the edge
// gate in lockstep with `engagement_status` so a new value cannot drift
// past us silently.
const SUPERSEDED_ENGAGEMENT_STATUSES = new Set<string>([
  "cancelled_email_change",
  "cancelled_by_initiator",
]);

function evaluateSupersessionGate(
  eng: { engagement_status?: string | null; superseded_by_engagement_id?: string | null },
): { code: "ENGAGEMENT_SUPERSEDED"; message: string } | null {
  const status = eng.engagement_status ?? "";
  if (SUPERSEDED_ENGAGEMENT_STATUSES.has(status) || eng.superseded_by_engagement_id) {
    return {
      code: "ENGAGEMENT_SUPERSEDED",
      message:
        "This engagement has been replaced or cancelled by the initiator. Use the current engagement for this match.",
    };
  }
  return null;
}

// Cancel-by-initiator: states from which the initiator can still
// unilaterally withdraw without invoking dispute or refund machinery.
// Once the counterparty has accepted (POI provisional) or the engagement
// is already in a terminal/refund-relevant state, cancellation must be
// refused — the initiator instead has to dispute, settle, or run the
// admin refund-decision workflow.
const INITIATOR_CANCELLABLE_STATUSES = new Set<string>([
  "pending",
  "notification_sent",
  "contacted",
]);

// POI / WaD states from which initiator-cancellation is IRREVERSIBLE-
// blocked. Computed from match.poi_state when the engagement is linked.
const IRREVERSIBLE_POI_STATES = new Set<string>([
  "ELIGIBLE",
  "PENDING_APPROVAL",
  "COMPLETION_REQUESTED",
  "COMPLETED",
  "SETTLED",
]);

// ── Process-level safety net ────────────────────────────────────────────────
// If anything escapes the Deno.serve try/catch (e.g. a stray async without
// await, or a top-level runtime error in an imported helper), log a
// structured line so on-call can correlate. Bundling failures cannot be
// caught here (the module never loads), but Supabase's deploy log already
// surfaces those — what we add is a stable runtime channel.
addEventListener("unhandledrejection", (e) => {
  const err = (e as PromiseRejectionEvent).reason as Error | undefined;
  console.error(JSON.stringify({
    level: "error",
    fn: "poi-engagements",
    kind: "unhandledrejection",
    name: err?.name ?? "Error",
    message: err?.message ?? String(err),
    source: extractSourceLocation(err ?? null),
  }));
});
addEventListener("error", (e) => {
  const ev = e as ErrorEvent;
  console.error(JSON.stringify({
    level: "error",
    fn: "poi-engagements",
    kind: "uncaught",
    name: ev.error?.name ?? "Error",
    message: ev.message,
    source: ev.filename ? `${ev.filename.split("/").pop()}:${ev.lineno}:${ev.colno}` : extractSourceLocation(ev.error ?? null),
  }));
});

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

      // Batch E Phase 3 — initiator-facing response hardening.
      // Replace `select("*")` with an explicit allowlist so sensitive
      // fields (binding_candidates, dispute_reason, dispute_source,
      // disputed_by_token_hash, disputed_at, dispute_metadata,
      // admin/support notes, SLA reminder counters, operational_state
      // setter audit fields, cancellation audit fields, etc.) are
      // never serialised onto the wire — even though no current UI
      // surface displays them. The allowlist is the union of fields
      // consumed by:
      //   • PendingEngagementSection (initiator status banner & details)
      //   • EngagementTracker (engagement_status, counterparty_type)
      //   • UnknownCounterpartyStatus, OrgAdminContactCompletionCard,
      //     ReconfirmLateAcceptanceCard, AcceptEngagementCard
      //   • engagement-progression-guard (status, operational_state,
      //     binding_resolution — NOT raw binding_candidates)
      // Admin surfaces consume `GET /poi-engagements?type=...`, never
      // this route, so role-specific shaping is not required here.
      const BY_MATCH_RESPONSE_ALLOWLIST = [
        "id",
        "match_id",
        "org_id",
        "engagement_status",
        "counterparty_type",
        "counterparty_email",
        "counterparty_org_id",
        "contact_type",
        "contact_name",
        "created_at",
        "updated_at",
        "contacted_at",
        "responded_at",
        "expires_at",
        "counterparty_response",
        "renewed_from_engagement_id",
        "renewed_engagement_id",
        "late_acceptance_recorded_at",
        "late_acceptance_resolution",
        "reconfirmation_window_expires_at",
        "operational_state",
        "binding_resolution",
      ].join(",");
      const { data, error } = await supabase
        .from("poi_engagements")
        .select(BY_MATCH_RESPONSE_ALLOWLIST)
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

      // ── MT-008 / MT-009 progression guard (preview-outreach) ──
      // Runs BEFORE the D2a gate so an inconsistent legacy match row or
      // an organisation-attached match missing its named contact is
      // refused before any outreach side effect (preview render still
      // counts as an outreach surface per the signed contract — it shapes
      // the email that would be sent). Emits the canonical block audits.
      {
        const matchIdForGuard = (eng as { match_id?: string | null }).match_id ?? null;
        if (matchIdForGuard) {
          const decision = await assertMatchProgressable({
            supabase,
            matchId: matchIdForGuard,
            action: "outreach",
            sourceFunction: "poi-engagements/preview-outreach",
            actorUserId: authCtx.userId,
            actorOrgId: (eng as { org_id?: string | null }).org_id ?? null,
          });
          const blocked = buildProgressionGuardResponse(decision, corsHeaders);
          if (blocked) return blocked;
        }
      }

      // ── D2a outreach gate (preview) ──

      // Block disputed + binding-review BEFORE the contact-completeness
      // check so a disputed/binding-pending row never even renders a
      // preview body. Batch E: emit the canonical audit-only catalogue
      // event (`outreach.blocked.binding_review_pending` /
      // `outreach.blocked.disputed_being_named`) so the catalogue SSOT
      // and the live audit trail agree. No counterparty / candidate /
      // dispute identity is ever written into the metadata.
      {
        const gate = evaluateOutreachGate(eng as Record<string, unknown>);
        if (gate) {
          const canonicalAction =
            gate.code === "DISPUTED_BEING_NAMED"
              ? "outreach.blocked.disputed_being_named"
              : "outreach.blocked.binding_review_pending";
          try {
            await supabase.from("audit_logs").insert({
              org_id: (eng as { org_id: string }).org_id,
              actor_user_id: authCtx.userId,
              action: canonicalAction,
              entity_type: "poi_engagement",
              entity_id: engagementId,
              metadata: {
                actor_role: "platform_admin",
                surface: "preview-outreach",
                guard_code: gate.code,
                request_id: requestId,
              },
            });
            // CP-006 (signed) — sibling audit for binding-review block.
            // Canonical row above is preserved; this lets dashboards
            // separate CP-006 blocks from disputed-being-named blocks.
            if (gate.code === "BINDING_REVIEW_PENDING") {
              await supabase.from("audit_logs").insert({
                org_id: (eng as { org_id: string }).org_id,
                actor_user_id: authCtx.userId,
                action: "pending_engagement.outreach_blocked_binding_review_required",
                entity_type: "poi_engagement",
                entity_id: engagementId,
                metadata: {
                  cp_rule: "CP-006",
                  engagement_id: engagementId,
                  match_id: (eng as { match_id?: string | null }).match_id ?? null,
                  attempted_action: "preview_outreach",
                  binding_review_required: true,
                  outreach_sent: false,
                  credit_burned: false,
                  blocked_reason: "binding_review_required",
                  guard_code: gate.code,
                  surface: "preview-outreach",
                  request_id: requestId,
                },
              });
            }
          } catch (_e) { /* non-fatal */ }
          // DEC-001 (signed): canonical blocked row (dual-write).
          try {
            await supabase.from("audit_logs").insert({
              org_id: (eng as { org_id: string }).org_id,
              actor_user_id: authCtx.userId,
              action: "pending_engagement.off_platform_outreach_blocked",
              entity_type: "poi_engagement",
              entity_id: engagementId,
              metadata: {
                dec_rule: "DEC-001",
                surface: "preview-outreach",
                blocked_reason:
                  gate.code === "DISPUTED_BEING_NAMED"
                    ? "disputed_being_named"
                    : "binding_review_required",
                guard_code: gate.code,
                outreach_sent: false,
                credit_burned: false,
                request_id: requestId,
              },
            });
          } catch (_e) { /* non-fatal — Phase 1 dual-write */ }
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
        // Batch H: legacy `contact.incomplete_detected` audit event has
        // been retired. Dependency audit (2026-05-11) confirmed zero
        // production consumers (no dashboard, BI export, scheduled job,
        // admin panel, or scripted reporter referenced it). The canonical
        // replacement is `outreach.blocked.contact_incomplete`, surfaced
        // by HQ → Audit → Outreach Blocks (Batch G). Do NOT reintroduce
        // a legacy alias — extend the canonical event instead.
        try {
          await supabase.from("audit_logs").insert({
            org_id: (eng as { org_id: string }).org_id,
            actor_user_id: authCtx.userId,
            action: "outreach.blocked.contact_incomplete",
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
          // CP-002 / DEC-002 (signed): emit the specific
          // missing-email block alongside the canonical event so
          // dashboards can split "email missing" from the broader
          // "contact incomplete" without losing the canonical row.
          if (previewState === "email_missing") {
            await supabase.from("audit_logs").insert({
              org_id: (eng as { org_id: string }).org_id,
              actor_user_id: authCtx.userId,
              action: "pending_engagement.outreach_blocked_missing_email",
              entity_type: "poi_engagement",
              entity_id: engagementId,
              metadata: {
                actor_role: "platform_admin",
                surface: "preview-outreach",
                state: previewState,
                code,
                engagement_id: engagementId,
                match_id: (eng as { match_id?: string }).match_id ?? null,
                counterparty_name: ((eng as { contact_name?: string | null }).contact_name ?? null),
                counterparty_email_present: false,
                outreach_enabled: false,
                outreach_sent: false,
                credit_burned: false,
                request_id: requestId,
              },
            });
          }
          // CP-003 (signed mirror of CP-002): email present but no
          // usable counterparty name. Canonical `contact_incomplete`
          // event above is preserved; this sibling lets dashboards
          // split "name missing" from the generic incomplete bucket
          // without changing getContactState return values.
          if (
            previewState === "contact_incomplete" &&
            isUsableContactEmail((eng as { counterparty_email?: string | null }).counterparty_email)
          ) {
            const cp003Meta = {
              cp_rule: "CP-003",
              actor_role: "platform_admin",
              surface: "preview-outreach",
              state: previewState,
              code,
              engagement_id: engagementId,
              match_id: (eng as { match_id?: string }).match_id ?? null,
              counterparty_email: ((eng as { counterparty_email?: string | null }).counterparty_email ?? null),
              counterparty_name: null,
              counterparty_name_present: false,
              counterparty_email_present: true,
              counterparty_registration_status: "unregistered",
              status: "pending",
              contact_state: "missing_name",
              outreach_enabled: false,
              outreach_sent: false,
              credit_burned: false,
              attempted_action: "send_outreach",
              blocked_reason: "missing_counterparty_name",
              reason: "missing_counterparty_name",
              request_id: requestId,
            };
            // Legacy sibling (preserved for backwards compatibility):
            await supabase.from("audit_logs").insert({
              org_id: (eng as { org_id: string }).org_id,
              actor_user_id: authCtx.userId,
              action: "pending_engagement.outreach_blocked_missing_name",
              entity_type: "poi_engagement",
              entity_id: engagementId,
              metadata: cp003Meta,
            });
            // CP-003 (signed canonical) — outreach attempted & blocked:
            await supabase.from("audit_logs").insert({
              org_id: (eng as { org_id: string }).org_id,
              actor_user_id: authCtx.userId,
              action: "pending_engagement.outreach_blocked_missing_counterparty_name",
              entity_type: "poi_engagement",
              entity_id: engagementId,
              metadata: cp003Meta,
            });
          }
        } catch (_e) { /* non-fatal */ }

        // DEC-001 (signed): canonical blocked row (dual-write).
        try {
          await supabase.from("audit_logs").insert({
            org_id: (eng as { org_id: string }).org_id,
            actor_user_id: authCtx.userId,
            action: "pending_engagement.off_platform_outreach_blocked",
            entity_type: "poi_engagement",
            entity_id: engagementId,
            metadata: {
              dec_rule: "DEC-001",
              surface: "preview-outreach",
              blocked_reason:
                previewState === "email_missing"
                  ? "contact_email_missing"
                  : "contact_incomplete",
              code,
              state: previewState,
              outreach_sent: false,
              credit_burned: false,
              request_id: requestId,
            },
          });
        } catch (_e) { /* non-fatal — Phase 1 dual-write */ }

        throw new ApiException(code, reason, 409);
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

      // SEC-001: outreach is a sensitive admin action — it fires real email,
      // writes an immutable outreach log entry, and transitions engagement
      // state. Platform_admin callers must hold an AAL2 (MFA) session BEFORE
      // any state mutation, audit-says-sent row, or external send is attempted.
      // API-key callers skip the JWT aal check (they have no `aal` claim).
      if (!authCtx.isApiKey) {
        const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorisation");
        await assertAal2(authHeader, {
          adminClient: supabase,
          callerUserId: authCtx.userId,
          action: "pending_engagement.send_outreach",
          context: {
            sensitive_action_category: "engagement.outreach",
            target_resource_type: "poi_engagement",
            target_resource_id: engagementId,
          },
        });
      }

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(engagementId)) {
        throw new ApiException("VALIDATION_ERROR", "Invalid engagement ID format", 400);
      }

      // ── DEC-001 (signed): canonical "evaluated" audit row ──
      // Dual-write with existing per-reason audits. Records THAT an
      // off-platform outreach decision was walked through every gate
      // (identity, supersession, binding review, dispute, MT-008/MT-009
      // progression), regardless of outcome. SSOT: src/lib/outreach/
      // dec-001-audit.ts → OFF_PLATFORM_OUTREACH_EVALUATED.
      try {
        await supabase.from("audit_logs").insert({
          actor_user_id: authCtx.userId,
          action: "pending_engagement.off_platform_outreach_evaluated",
          entity_type: "poi_engagement",
          entity_id: engagementId,
          metadata: {
            dec_rule: "DEC-001",
            surface: "send-outreach",
            request_id: requestId,
          },
        });
      } catch (_e) { /* non-fatal — Phase 1 dual-write */ }


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

      // ── DEC-005 / DEC-006 / DEC-010 — admin free-text wording guards.
      // Engagements are by definition pre-counterparty-acceptance, so unsafe
      // pre-acceptance terms, POI binding claims, and forbidden public-claim
      // phrases are all rejected with 422 + a signed warning. Each block is
      // audited additively (`legal.unsafe_*` / `claims.unapproved_claim_blocked`)
      // and never mutates engagement state, POIs, credits, or payments.
      {
        const combined = [parsed.data.subject ?? "", parsed.data.custom_message ?? ""]
          .filter(Boolean)
          .join("\n");
        if (combined.trim().length > 0) {
          const preAcc = assertPreAcceptanceSafe(combined);
          const poi = assertPoiWordingSafe(combined, { accepted: false });
          const claim = assertClaimSafe(combined, { surface: "outreach_body", accepted: false });
          const violations: Array<{ action: string; warning: string; blocked: string[] }> = [];
          if (!preAcc.ok) {
            violations.push({
              action: "legal.unsafe_pre_acceptance_wording_blocked",
              warning: UNSAFE_PRE_ACCEPTANCE_WARNING,
              blocked: preAcc.blockedTerms,
            });
          }
          if (!poi.ok) {
            violations.push({
              action: "legal.unsafe_poi_binding_claim_blocked",
              warning: UNSAFE_POI_WARNING,
              blocked: poi.blockedTerms,
            });
          }
          if (!claim.ok) {
            violations.push({
              action: "claims.unapproved_claim_blocked",
              warning: claim.warning ?? UNSAFE_PRE_ACCEPTANCE_WARNING,
              blocked: claim.blockedTerms,
            });
          }
          if (violations.length > 0) {
            for (const v of violations) {
              try {
                await supabase.from("audit_logs").insert({
                  org_id: authCtx.orgId ?? null,
                  actor_user_id: authCtx.userId,
                  action: v.action,
                  entity_type: "poi_engagement",
                  entity_id: engagementId,
                  metadata: {
                    request_id: requestId,
                    surface: "send-outreach",
                    blocked_terms: v.blocked,
                    actor_role: "platform_admin",
                  },
                });
              } catch (_e) { /* non-fatal */ }
            }
            return new Response(
              JSON.stringify({
                error: "UNSAFE_WORDING",
                message: violations[0].warning,
                blocked_terms: Array.from(new Set(violations.flatMap((v) => v.blocked))),
                violations: violations.map((v) => ({ action: v.action, warning: v.warning })),
              }),
              { status: 422, headers: { ...headers, "Content-Type": "application/json" } },
            );
          }
        }
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

      // ── NOT-002: 30s per-engagement send cooldown ─────────────────────
      // Same-body retries already short-circuit via the idempotency cache
      // above. Edited-body resends within 30s of the last successful send
      // (queued or post-engagement follow-up) are blocked with 429 +
      // Retry-After so a flustered admin tweaking the subject line cannot
      // fire a fresh email at the counterparty inside the cooldown window.
      // Legitimate later follow-ups outside the window are NOT blocked —
      // they get tagged as `engagement.outreach_resend_attempted` instead.
      const COOLDOWN_SECONDS = 30;
      const cooldownStartIso = new Date(
        Date.now() - COOLDOWN_SECONDS * 1000,
      ).toISOString();
      const SEND_AUDIT_ACTIONS = [
        "engagement.outreach_email_queued",
        "engagement.outreach_followup_email_sent",
      ];
      const { data: priorSends } = await supabase
        .from("audit_logs")
        .select("id, action, created_at")
        .eq("entity_type", "poi_engagement")
        .eq("entity_id", engagementId)
        .in("action", SEND_AUDIT_ACTIONS)
        .order("created_at", { ascending: false })
        .limit(50);
      const recentSend = (priorSends ?? []).find(
        (r: { created_at: string }) => r.created_at >= cooldownStartIso,
      );
      if (recentSend) {
        const ageMs = Date.now() - new Date(recentSend.created_at).getTime();
        const retryAfter = Math.max(
          1,
          Math.ceil((COOLDOWN_SECONDS * 1000 - ageMs) / 1000),
        );
        await recordNotificationSkipped(supabase, {
          reason: "rate_limited",
          sourceFunction: "poi-engagements/send-outreach",
          targetId: engagementId,
          channel: "email",
          extra: {
            cooldown_seconds: COOLDOWN_SECONDS,
            retry_after_seconds: retryAfter,
            last_send_at: recentSend.created_at,
            last_send_action: (recentSend as { action: string }).action,
            request_id: requestId,
          },
        });
        throw new ApiException(
          "RATE_LIMITED",
          `Outreach cooldown: another email was sent for this engagement ${Math.round(ageMs / 1000)}s ago. Retry in ${retryAfter}s.`,
          429,
          { retryAfter },
        );
      }
      const isResend = (priorSends ?? []).length > 0;

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

      // ── MT-008 / MT-009 progression guard (send-outreach) ──
      // Runs BEFORE the D2a gate, legitimacy check, suppression check,
      // outreach-log write, status transition, and the real email send.
      // Refuses inconsistent legacy match rows (MT-008) and
      // organisation-attached matches missing a named contact (MT-009).
      // Emits the canonical block audits via the shared helper.
      {
        const matchIdForGuard = (eng as { match_id?: string | null }).match_id ?? null;
        if (matchIdForGuard) {
          const decision = await assertMatchProgressable({
            supabase,
            matchId: matchIdForGuard,
            action: "outreach",
            sourceFunction: "poi-engagements/send-outreach",
            actorUserId: authCtx.userId,
            actorOrgId: (eng as { org_id?: string | null }).org_id ?? null,
          });
          const blocked = buildProgressionGuardResponse(decision, corsHeaders);
          if (blocked) return blocked;
        }
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
          // Batch E: also emit the canonical catalogue audit event so
          // the SSOT in `src/lib/batch-d-events.ts` and the live audit
          // trail agree. Metadata carries no counterparty / candidate /
          // dispute identity.
          {
            const canonicalAction =
              gate.code === "DISPUTED_BEING_NAMED"
                ? "outreach.blocked.disputed_being_named"
                : "outreach.blocked.binding_review_pending";
            try {
              await supabase.from("audit_logs").insert({
                org_id: (eng as { org_id: string }).org_id,
                actor_user_id: authCtx.userId,
                action: canonicalAction,
                entity_type: "poi_engagement",
                entity_id: engagementId,
                metadata: {
                  actor_role: "platform_admin",
                  surface: "send-outreach",
                  guard_code: gate.code,
                  request_id: requestId,
                },
              });
              // CP-006 (signed) — sibling audit for binding-review block.
              if (gate.code === "BINDING_REVIEW_PENDING") {
                await supabase.from("audit_logs").insert({
                  org_id: (eng as { org_id: string }).org_id,
                  actor_user_id: authCtx.userId,
                  action: "pending_engagement.outreach_blocked_binding_review_required",
                  entity_type: "poi_engagement",
                  entity_id: engagementId,
                  metadata: {
                    cp_rule: "CP-006",
                    engagement_id: engagementId,
                    match_id: (eng as { match_id?: string | null }).match_id ?? null,
                    attempted_action: "send_outreach",
                    binding_review_required: true,
                    outreach_sent: false,
                    credit_burned: false,
                    blocked_reason: "binding_review_required",
                    guard_code: gate.code,
                    surface: "send-outreach",
                    request_id: requestId,
                  },
                });
              }
            } catch (_e) { /* non-fatal */ }
          }
          // DEC-001 (signed): canonical blocked row (dual-write).
          try {
            await supabase.from("audit_logs").insert({
              org_id: (eng as { org_id: string }).org_id,
              actor_user_id: authCtx.userId,
              action: "pending_engagement.off_platform_outreach_blocked",
              entity_type: "poi_engagement",
              entity_id: engagementId,
              metadata: {
                dec_rule: "DEC-001",
                surface: "send-outreach",
                blocked_reason:
                  gate.code === "DISPUTED_BEING_NAMED"
                    ? "disputed_being_named"
                    : "binding_review_required",
                guard_code: gate.code,
                outreach_sent: false,
                credit_burned: false,
                request_id: requestId,
              },
            });
          } catch (_e) { /* non-fatal — Phase 1 dual-write */ }
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
          // Batch H: legacy `contact.incomplete_detected` retired here
          // too. Canonical event only — see preview-outreach gate above
          // for the dependency-audit rationale. Do NOT reintroduce a
          // legacy alias.
          try {
            await supabase.from("audit_logs").insert({
              org_id: (eng as { org_id: string }).org_id,
              actor_user_id: authCtx.userId,
              action: "outreach.blocked.contact_incomplete",
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
            // CP-002 / DEC-002 (signed): split the specific
            // missing-email block. Canonical event above is
            // preserved for dashboards/tests.
            if (sendState === "email_missing") {
              await supabase.from("audit_logs").insert({
                org_id: (eng as { org_id: string }).org_id,
                actor_user_id: authCtx.userId,
                action: "pending_engagement.outreach_blocked_missing_email",
                entity_type: "poi_engagement",
                entity_id: engagementId,
                metadata: {
                  actor_role: "platform_admin",
                  surface: "send-outreach",
                  state: sendState,
                  code,
                  engagement_id: engagementId,
                  match_id: (eng as { match_id?: string }).match_id ?? null,
                  counterparty_name: ((eng as { contact_name?: string | null }).contact_name ?? null),
                  counterparty_email_present: false,
                  outreach_enabled: false,
                  outreach_sent: false,
                  credit_burned: false,
                  request_id: requestId,
                },
              });
            }
            // CP-003 (signed mirror): email present, name missing.
            if (
              sendState === "contact_incomplete" &&
              isUsableContactEmail((eng as { counterparty_email?: string | null }).counterparty_email)
            ) {
              const cp003SendMeta = {
                cp_rule: "CP-003",
                actor_role: "platform_admin",
                surface: "send-outreach",
                state: sendState,
                code,
                engagement_id: engagementId,
                match_id: (eng as { match_id?: string }).match_id ?? null,
                counterparty_email: ((eng as { counterparty_email?: string | null }).counterparty_email ?? null),
                counterparty_name: null,
                counterparty_name_present: false,
                counterparty_email_present: true,
                counterparty_registration_status: "unregistered",
                status: "pending",
                contact_state: "missing_name",
                outreach_enabled: false,
                outreach_sent: false,
                credit_burned: false,
                attempted_action: "send_outreach",
                blocked_reason: "missing_counterparty_name",
                reason: "missing_counterparty_name",
                request_id: requestId,
              };
              // Legacy sibling (preserved):
              await supabase.from("audit_logs").insert({
                org_id: (eng as { org_id: string }).org_id,
                actor_user_id: authCtx.userId,
                action: "pending_engagement.outreach_blocked_missing_name",
                entity_type: "poi_engagement",
                entity_id: engagementId,
                metadata: cp003SendMeta,
              });
              // CP-003 (signed canonical):
              await supabase.from("audit_logs").insert({
                org_id: (eng as { org_id: string }).org_id,
                actor_user_id: authCtx.userId,
                action: "pending_engagement.outreach_blocked_missing_counterparty_name",
                entity_type: "poi_engagement",
                entity_id: engagementId,
                metadata: cp003SendMeta,
              });
            }

          } catch (_e) { /* non-fatal */ }
          // DEC-001 (signed): canonical blocked row (dual-write).
          try {
            await supabase.from("audit_logs").insert({
              org_id: (eng as { org_id: string }).org_id,
              actor_user_id: authCtx.userId,
              action: "pending_engagement.off_platform_outreach_blocked",
              entity_type: "poi_engagement",
              entity_id: engagementId,
              metadata: {
                dec_rule: "DEC-001",
                surface: "send-outreach",
                blocked_reason:
                  sendState === "email_missing"
                    ? "contact_email_missing"
                    : "contact_incomplete",
                code,
                state: sendState,
                outreach_sent: false,
                credit_burned: false,
                request_id: requestId,
              },
            });
          } catch (_e) { /* non-fatal — Phase 1 dual-write */ }
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
        // ── NOT-001 / NOT-006: blocked send-outreach with no recipient.
        // Record canonical skip audit (idempotent per target/reason/day)
        // before throwing so the silent block is observable.
        await recordNotificationSkipped(supabase, {
          reason: "no_recipient",
          sourceFunction: "poi-engagements/send-outreach",
          targetId: engagementId,
          channel: "email",
          orgId: eng.org_id ?? null,
          extra: {
            match_id: eng.match_id,
            engagement_id: engagementId,
            request_id: requestId,
          },
        });
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
        // ── NOT-001 / NOT-006: canonical skip audit for suppressed
        // recipient. Idempotent per target/reason/day via helper dedupe.
        await recordNotificationSkipped(supabase, {
          reason: "recipient_suppressed",
          sourceFunction: "poi-engagements/send-outreach",
          targetId: engagementId,
          recipientEmail: recipient,
          channel: "email",
          orgId: eng.org_id ?? null,
          extra: {
            match_id: eng.match_id,
            engagement_id: engagementId,
            request_id: requestId,
          },
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
        `EMAIL QUEUED to ${recipient}`,
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
            p_audit_action: "engagement.outreach_email_queued",
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

        // ── DEC-001 (signed): canonical "sent" row (dual-write). ──
        // Pairs with the operational engagement.outreach_email_queued
        // state-transition row. SSOT: src/lib/outreach/dec-001-audit.ts.
        try {
          await supabase.from("audit_logs").insert({
            org_id: eng.org_id,
            actor_user_id: authCtx.userId,
            action: "pending_engagement.off_platform_outreach_sent",
            entity_type: "poi_engagement",
            entity_id: engagementId,
            metadata: {
              dec_rule: "DEC-001",
              surface: "send-outreach",
              recipient,
              outreach_sent: true,
              credit_burned: false,
              poi_minted: false,
              wad_triggered: false,
              payment_event: false,
              request_id: requestId,
            },
          });
        } catch (_e) { /* non-fatal — Phase 1 dual-write */ }

        // ── DEC-004 (signed): canonical "manual follow-up assigned" row. ──
        // Engagement now sits in `contacted` awaiting counterparty
        // response — i.e. it has entered the manual follow-up cycle
        // owned by the Izenzo platform admin. SSOT:
        // src/lib/outreach/dec-004-states.ts.
        try {
          await supabase.from("audit_logs").insert({
            org_id: eng.org_id,
            actor_user_id: authCtx.userId,
            action: "outreach.manual_follow_up_assigned",
            entity_type: "poi_engagement",
            entity_id: engagementId,
            metadata: {
              dec_rule: "DEC-004",
              manual_owner: "izenzo_platform_admin",
              canonical_state: "contacted_awaiting_response",
              request_id: requestId,
            },
          });
        } catch (_e) { /* non-fatal — Phase 1 dual-write */ }

        // ── DEC-005 / DEC-006 (signed): pre-acceptance wording-state ledger.
        // The atomic RPC above wrote the engagement.outreach_email_queued
        // state-transition row. These additive rows record that the
        // approved cautious wording (PENDING_ENGAGEMENT_LABEL +
        // INITIATOR_PENDING_COPY for the engagement and DRAFT_POI_LABEL
        // for any pre-acceptance POI surface) was the wording actually
        // applied. No state change, no POI/WaD/credit/payment side
        // effects. Best-effort writes — log + continue on failure.
        try {
          await supabase.from("audit_logs").insert({
            org_id: eng.org_id,
            actor_user_id: authCtx.userId,
            action: "legal.pre_acceptance_wording_applied",
            entity_type: "poi_engagement",
            entity_id: engagementId,
            metadata: {
              dec_rule: "DEC-005",
              engagement_id: engagementId,
              match_id: eng.match_id ?? null,
              poi_id: (eng as { poi_id?: string | null }).poi_id ?? null,
              counterparty_name: parsed.data.counterparty_name ?? null,
              counterparty_email: recipient,
              initiator_user_id: authCtx.userId,
              initiator_organisation_id: eng.org_id,
              counterparty_acceptance_status: "not_accepted",
              approved_wording_used: {
                engagement_label: PENDING_ENGAGEMENT_LABEL,
                initiator_copy: INITIATOR_PENDING_COPY,
                outreach_invitation_copy: OUTREACH_INVITATION_COPY,
              },
              displayed_status: "contacted",
              document_status: "pre_acceptance_invitation",
              notification_template_id: "outreach-intent-to-trade",
              surface: "live_edge_function:send-outreach",
              created_at: new Date().toISOString(),
              request_id: requestId,
            },
          });
        } catch (e) {
          console.warn(`[${requestId}] DEC-005 pre_acceptance_wording_applied audit insert failed (non-fatal):`, e);
        }
        try {
          await supabase.from("audit_logs").insert({
            org_id: eng.org_id,
            actor_user_id: authCtx.userId,
            action: "legal.poi_binding_wording_applied",
            entity_type: "poi_engagement",
            entity_id: engagementId,
            metadata: {
              dec_rule: "DEC-006",
              poi_id: (eng as { poi_id?: string | null }).poi_id ?? null,
              match_id: eng.match_id ?? null,
              engagement_id: engagementId,
              initiator_user_id: authCtx.userId,
              initiator_organisation_id: eng.org_id,
              counterparty_user_id: null,
              counterparty_organisation_id:
                (eng as { counterparty_org_id?: string | null }).counterparty_org_id ?? null,
              counterparty_acceptance_status: "not_accepted",
              poi_wording_state: "draft_intent_record",
              approved_wording_used: {
                poi_label: DRAFT_POI_LABEL,
              },
              surface: "live_edge_function:send-outreach",
              created_at: new Date().toISOString(),
              request_id: requestId,
            },
          });
        } catch (e) {
          console.warn(`[${requestId}] DEC-006 poi_binding_wording_applied (draft) audit insert failed (non-fatal):`, e);
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

      // ── NOT-002: tag re-sends so duplicate-attempt patterns are observable.
      // The first send already wrote engagement.outreach_email_queued (or
      // outreach_followup_email_sent for post-engagement); a 2nd+ send
      // outside the 30s cooldown gets an additional canonical resend audit.
      if (isResend) {
        try {
          await supabase.from("audit_logs").insert({
            org_id: eng.org_id,
            actor_user_id: authCtx.userId,
            action: "engagement.outreach_resend_attempted",
            entity_type: "poi_engagement",
            entity_id: engagementId,
            metadata: {
              recipient,
              prior_send_count: (priorSends ?? []).length,
              current_status: currentStatus,
              cooldown_seconds: COOLDOWN_SECONDS,
              request_id: requestId,
            },
          });
        } catch (resendAuditErr) {
          console.warn(`[${requestId}] Failed to write resend audit row (non-fatal):`, resendAuditErr);
        }
      }

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
      // CP-006 (signed): tracks a unique-exact-email safe-bind in THIS
      // PATCH so the sibling `pending_engagement.auto_bound_registered_org`
      // audit can be emitted alongside the canonical binding fields.
      let safeBindEvent: {
        matched_organisation_id: string;
        matched_contact_id: string | null;
        email: string;
      } | null = null;
      // CP-006 (signed): captures the first candidate's profile_id list
      // for the binding-review sibling audit. Mirrors the canonical
      // `engagement.binding_review_required` insert (initial entry only).
      let bindingReviewSiblingPayload: {
        possible_organisation_ids: string[];
        possible_contact_ids: string[];
        reason_codes: string[];
        email: string;
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
            // CP-015 (signed): sibling audit naming for dashboard parity.
            // Canonical row is `engagement.email_change_refused`; this row
            // restates the intent in the "pending_engagement.*" namespace
            // used by Daniel's signed-form audit views. No state change,
            // no side effects — additive audit only.
            try {
              const oldHash = prevEmailNorm ? await sha256Hex(prevEmailNorm) : null;
              const newHash = normalisedEmail ? await sha256Hex(normalisedEmail) : null;
              await supabase.from("audit_logs").insert({
                org_id: current.org_id,
                actor_user_id: authCtx.userId,
                action: "pending_engagement.email_change_blocked_requires_new_engagement",
                entity_type: "poi_engagement",
                entity_id: engagementId,
                metadata: {
                  cp_rule: "CP-015",
                  reason: "counterparty_email_change_after_creation",
                  old_engagement_id: engagementId,
                  new_engagement_id: null,
                  match_id: (current as { match_id?: string | null }).match_id ?? null,
                  poi_id: (current as { poi_id?: string | null }).poi_id ?? null,
                  initiator_user_id: authCtx.userId,
                  initiator_organisation_id: current.org_id,
                  old_counterparty_email_hash: oldHash,
                  new_counterparty_email_hash: newHash,
                  counterparty_name: (current as { contact_name?: string | null }).contact_name ?? null,
                  old_status_before: current.engagement_status,
                  old_status_after: current.engagement_status,
                  direct_edit_allowed: false,
                  new_engagement_created: false,
                  old_outreach_link_invalidated: false,
                  poi_completed_from_old_engagement: false,
                  wad_triggered_from_old_engagement: false,
                  credit_burned_for_email_change: false,
                  payment_event_created_for_email_change: false,
                  billing_review_required: false,
                  changed_by_user_id: authCtx.userId,
                  changed_at: new Date().toISOString(),
                  request_id: requestId,
                },
              });
            } catch (e) {
              console.warn(`[${requestId}] CP-015 sibling (refused) audit insert failed (non-fatal):`, e);
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
            safeBindEvent = {
              matched_organisation_id: decision.org_id,
              matched_contact_id: null,
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
              // CP-006: sibling-audit payload (initial-entry only).
              const possibleOrgIds = Array.from(
                new Set(
                  decision.candidates
                    .map((c) => c.org_id)
                    .filter((v): v is string => !!v),
                ),
              );
              const possibleContactIds = Array.from(
                new Set(
                  decision.candidates
                    .map((c) => c.profile_id)
                    .filter((v): v is string => !!v),
                ),
              );
              bindingReviewSiblingPayload = {
                possible_organisation_ids: possibleOrgIds,
                possible_contact_ids: possibleContactIds,
                reason_codes: decision.reason_codes,
                email: normalisedEmail,
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

      // ── CP-006 (signed) — auto-bound sibling audit ──
      // Fires when this PATCH performed a unique-exact-email safe-bind.
      // Sits alongside the canonical binding fields written above
      // (counterparty_org_id / counterparty_type). No canonical event
      // is replaced — this is a dashboards-friendly sibling row.
      if (safeBindEvent) {
        try {
          const emailHash = await sha256Hex(safeBindEvent.email);
          await supabase.from("audit_logs").insert({
            org_id: current.org_id,
            actor_user_id: authCtx.userId,
            action: "pending_engagement.auto_bound_registered_org",
            entity_type: "poi_engagement",
            entity_id: engagementId,
            metadata: {
              cp_rule: "CP-006",
              engagement_id: engagementId,
              match_id: (current as { match_id?: string | null }).match_id ?? null,
              poi_id: (current as { poi_id?: string | null }).poi_id ?? null,
              counterparty_email_hash: emailHash,
              counterparty_name:
                (current as { contact_name?: string | null }).contact_name ?? null,
              matched_organisation_id: safeBindEvent.matched_organisation_id,
              matched_contact_id: safeBindEvent.matched_contact_id,
              match_type: "unique_exact_email",
              auto_bound: true,
              binding_review_required: false,
              outreach_enabled: true,
              created_by_user_id: authCtx.userId,
              organisation_id: current.org_id,
              source: "poi-engagements:patch_resolver",
              request_id: requestId,
            },
          });
        } catch (e) {
          console.warn(
            `[${requestId}] CP-006 auto_bound_registered_org sibling audit failed (non-fatal):`,
            e instanceof Error ? e.message : e,
          );
        }
      }



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
        // CP-006 (signed) — binding-review sibling audit. Sits
        // alongside the canonical `engagement.binding_review_required`
        // row above (initial-entry only). Dashboards can split
        // CP-006 review entries from the generic binding-review
        // bucket without losing the canonical row.
        if (bindingReviewSiblingPayload) {
          try {
            const emailHash = await sha256Hex(bindingReviewSiblingPayload.email);
            await supabase.from("audit_logs").insert({
              org_id: current.org_id,
              actor_user_id: authCtx.userId,
              action: "pending_engagement.binding_review_required",
              entity_type: "poi_engagement",
              entity_id: engagementId,
              metadata: {
                cp_rule: "CP-006",
                engagement_id: engagementId,
                match_id: (current as { match_id?: string | null }).match_id ?? null,
                poi_id: (current as { poi_id?: string | null }).poi_id ?? null,
                counterparty_email_hash: emailHash,
                counterparty_name:
                  (current as { contact_name?: string | null }).contact_name ?? null,
                possible_organisation_ids:
                  bindingReviewSiblingPayload.possible_organisation_ids,
                possible_contact_ids:
                  bindingReviewSiblingPayload.possible_contact_ids,
                match_type: "ambiguous",
                reason_codes: bindingReviewSiblingPayload.reason_codes,
                auto_bound: false,
                binding_review_required: true,
                outreach_enabled: false,
                outreach_sent: false,
                credit_burned: false,
                created_by_user_id: authCtx.userId,
                organisation_id: current.org_id,
                source: "poi-engagements:patch_resolver",
                request_id: requestId,
              },
            });
          } catch (e) {
            console.warn(
              `[${requestId}] CP-006 binding_review_required sibling audit failed (non-fatal):`,
              e instanceof Error ? e.message : e,
            );
          }
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

        // ── D4c-3d — initiator-side notification (best-effort). ──
        // Fires only at the initial entry into binding_review_required
        // (this branch is already gated by `bindingReviewInitialEntry`,
        // which is null on repeated PATCHes that find the row already
        // in review). Recipient resolution and wording come from the
        // D4c helper, which derives recipients ONLY from the initiating
        // org_id and forbids counterparty/candidate/disputed exposure.
        // Metadata is restricted to safe operational fields: request_id,
        // previous_operational_state, and reason_codes_count. Do NOT add
        // counterparty email, candidate org id/name, binding_candidates,
        // possible org IDs, commodity, price, quantity, or dispute fields.
        try {
          const d4cResult = await dispatchD4cInitiatorAlert(supabase, {
            eventType: "engagement.binding_review_required",
            engagementId,
            actorUserId: authCtx.userId ?? null,
            sourceFunction: "poi-engagements",
            dedupeKey: `binding_review_required:${engagementId}`,
            metadata: {
              request_id: requestId,
              previous_operational_state:
                ((current as { operational_state?: string | null }).operational_state) ?? null,
              reason_codes_count: bindingReviewInitialEntry.reason_codes.length,
            },
          });
          if (!d4cResult.ok) {
            console.warn(
              `[${requestId}] d4c initiator alert skipped (non-fatal): reason=${d4cResult.reason}`,
            );
          }
        } catch (e) {
          console.warn(
            `[${requestId}] d4c initiator alert dispatch threw (non-fatal):`,
            e instanceof Error ? e.message : e,
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

          // ── CP-002 / DEC-002 (signed) — emit additional named events
          // alongside the canonical contact.assigned/updated row, without
          // removing it. Two cases:
          //   • prev state had no usable contact AND new state is usable
          //     → `pending_engagement.contact_details_added`
          //   • new state is `email_missing` (name on file, no usable email)
          //     → `pending_engagement.no_contact_details_detected`
          try {
            const prevEng = {
              counterparty_email: prevEmail,
              counterparty_org_id: (current as { counterparty_org_id?: string | null }).counterparty_org_id ?? null,
              contact_name: prevName,
              contact_type: prevType,
              counterparty_org: (current as any).counterparty_org ?? null,
            };
            const nextEng = {
              counterparty_email: nextEmail,
              counterparty_org_id: (current as { counterparty_org_id?: string | null }).counterparty_org_id ?? null,
              contact_name: nextName,
              contact_type: nextType,
              counterparty_org: (current as any).counterparty_org ?? null,
            };
            const matchForState = (current as any).matches ?? null;
            const prevState = getContactState(prevEng as any, matchForState);
            const nextState = getContactState(nextEng as any, matchForState);
            const matchIdForAudit = (current as { match_id?: string | null }).match_id ?? null;
            const baseMeta = {
              actor_role: actorRole,
              actor_org_id: authCtx.orgId ?? null,
              engagement_id: engagementId,
              match_id: matchIdForAudit,
              organisation_id: current.org_id,
              created_by_user_id: authCtx.userId,
              request_id: requestId,
            };
            const prevBlocked = prevState === "email_missing" || prevState === "contact_incomplete";
            const nextUsable = nextState === "organisation_contact" || nextState === "named_individual_contact";
            if (prevBlocked && nextUsable) {
              await supabase.from("audit_logs").insert({
                org_id: current.org_id,
                actor_user_id: authCtx.userId,
                action: "pending_engagement.contact_details_added",
                entity_type: "poi_engagement",
                entity_id: engagementId,
                metadata: {
                  ...baseMeta,
                  previous_state: prevState,
                  new_state: nextState,
                  counterparty_name: nextName,
                  counterparty_email_present: !!nextEmail,
                  contact_state: nextState,
                  outreach_enabled: true,
                  outreach_sent: false,
                  credit_burned: false,
                },
              });
            }
            if (nextState === "email_missing") {
              await supabase.from("audit_logs").insert({
                org_id: current.org_id,
                actor_user_id: authCtx.userId,
                action: "pending_engagement.no_contact_details_detected",
                entity_type: "poi_engagement",
                entity_id: engagementId,
                metadata: {
                  ...baseMeta,
                  counterparty_name: nextName,
                  counterparty_email_present: false,
                  counterparty_registration_status: "unregistered",
                  status: "pending",
                  contact_state: "no_contact",
                  outreach_enabled: false,
                  outreach_sent: false,
                  credit_burned: false,
                },
              });
            }
            // CP-003 (signed mirror): email present but name missing
            // after a contact PATCH. Emitted alongside (never instead
            // of) the canonical contact.assigned/updated audit row.
            if (
              nextState === "contact_incomplete" &&
              isUsableContactEmail(nextEmail)
            ) {
              const cp003PatchMeta = {
                ...baseMeta,
                cp_rule: "CP-003",
                surface: "contact-patch",
                previous_state: prevState,
                new_state: nextState,
                counterparty_email: nextEmail ?? null,
                counterparty_name: null,
                counterparty_name_present: false,
                counterparty_email_present: true,
                counterparty_registration_status: "unregistered",
                status: "pending",
                contact_state: "missing_name",
                outreach_enabled: false,
                outreach_sent: false,
                credit_burned: false,
                reason: "missing_counterparty_name",
              };
              // CP-003 (signed canonical) — detection moment:
              await supabase.from("audit_logs").insert({
                org_id: current.org_id,
                actor_user_id: authCtx.userId,
                action: "pending_engagement.identity_incomplete_email_only_detected",
                entity_type: "poi_engagement",
                entity_id: engagementId,
                metadata: cp003PatchMeta,
              });
              // Legacy sibling (preserved for backwards compatibility):
              await supabase.from("audit_logs").insert({
                org_id: current.org_id,
                actor_user_id: authCtx.userId,
                action: "pending_engagement.outreach_blocked_missing_name",
                entity_type: "poi_engagement",
                entity_id: engagementId,
                metadata: cp003PatchMeta,
              });
              // CP-003 (signed canonical) — third surface (contact-patch).
              // Emitted alongside (never instead of) the legacy sibling so
              // every CP-003 missing-name block surface carries the signed
              // audit name. Required for CP-audit-name parity guard.
              await supabase.from("audit_logs").insert({
                org_id: current.org_id,
                actor_user_id: authCtx.userId,
                action: "pending_engagement.outreach_blocked_missing_counterparty_name",
                entity_type: "poi_engagement",
                entity_id: engagementId,
                metadata: cp003PatchMeta,
              });
            }
          } catch (e) {
            console.warn(`[${requestId}] CP-002 supplementary audit emit failed (non-fatal):`, e);
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
        // DEC-004 (signed): canonical manual-action-recorded row (dual-write).
        try {
          await supabase.from("audit_logs").insert({
            org_id: current.org_id,
            actor_user_id: authCtx.userId,
            action: "outreach.manual_follow_up_action_recorded",
            entity_type: "poi_engagement",
            entity_id: engagementId,
            metadata: {
              dec_rule: "DEC-004",
              manual_owner: "izenzo_platform_admin",
              admin_action: "record_contact",
              contact_method: parsed.data.contact_method,
              previous_status: current.engagement_status,
              new_status: targetStatus,
              request_id: requestId,
            },
          });
        } catch (_e) { /* non-fatal — Phase 1 dual-write */ }
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
      // Batch J F4 — supersession gate: dispute against a replaced /
      // initiator-cancelled engagement is rejected with a stable code.
      {
        const sup = evaluateSupersessionGate(current as Record<string, unknown>);
        if (sup) {
          throw new ApiException(sup.code, sup.message, 409, {
            current_status: current.engagement_status,
            superseded_by_engagement_id:
              (current as { superseded_by_engagement_id?: string | null }).superseded_by_engagement_id ?? null,
          });
        }
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

      // ── CP-012 — central public.disputes row + sibling spec audit ──
      // Without this row, the match-level DISPUTE_ACTIVE guard at
      // match/intent-declare never trips, so a counterparty dispute
      // would silently fail to block POI / WaD / execution.
      const matchIdForDispute = (current as { match_id?: string | null }).match_id ?? null;
      const counterpartyOrgId = (current as { counterparty_org_id?: string | null }).counterparty_org_id ?? null;
      const counterpartyEmail = (current as { counterparty_email?: string | null }).counterparty_email ?? null;
      let disputeRowId: string | null = null;
      let billingReviewRiskItemId: string | null = null;
      let creditBurnedForMatch = false;
      if (matchIdForDispute) {
        try {
          const { data: disputeRow, error: disputeErr } = await supabase
            .from("disputes")
            .insert({
              match_id: matchIdForDispute,
              // raised_by_org_id is NOT NULL. Prefer counterparty org when
              // known; fall back to the initiator org so the
              // DISPUTE_ACTIVE guard (which only checks existence on
              // match_id) still trips even when the counterparty has no
              // platform org yet.
              raised_by_org_id: counterpartyOrgId ?? current.org_id,
              raised_by_user_id: authCtx.userId,
              reason: "cp012_disputes_being_named",
              evidence_notes: parsed.data.reason,
              status: "open",
            })
            .select("id")
            .maybeSingle();
          if (disputeErr) throw disputeErr;
          disputeRowId = (disputeRow as { id?: string } | null)?.id ?? null;
        } catch (e) {
          console.warn(
            `[${requestId}] CP-012 disputes row insert failed (non-fatal):`,
            e instanceof Error ? e.message : e,
          );
        }

        // Billing review risk item if a credit was already burned on this match.
        try {
          const { data: burns } = await supabase
            .from("token_ledger")
            .select("id")
            .eq("entity_id", matchIdForDispute)
            .gt("tokens_burned", 0)
            .limit(1);
          creditBurnedForMatch = Array.isArray(burns) && burns.length > 0;
          if (creditBurnedForMatch) {
            const { data: risk } = await supabase
              .from("admin_risk_items")
              .insert({
                org_id: current.org_id,
                kind: "billing_review_required",
                title: "Billing review required: credit burned before counterparty dispute",
                description:
                  "A counterparty disputed being named in this trade after a credit had already been burned. " +
                  "No automatic refund has been issued; manual admin review is required.",
                severity: "high",
                status: "open",
                dedup_key: `billing_review_required:cp012:${matchIdForDispute}:${engagementId}`,
                metadata: {
                  cp_rule: "CP-012",
                  match_id: matchIdForDispute,
                  engagement_id: engagementId,
                  dispute_id: disputeRowId,
                  request_id: requestId,
                },
              })
              .select("id")
              .maybeSingle();
            billingReviewRiskItemId = (risk as { id?: string } | null)?.id ?? null;
          }
        } catch (e) {
          console.warn(
            `[${requestId}] CP-012 billing-review risk item insert failed (non-fatal):`,
            e instanceof Error ? e.message : e,
          );
        }
      }

      // CP-012 spec sibling audit row.
      try {
        const counterpartyEmailHash = counterpartyEmail
          ? await sha256Hex(counterpartyEmail.toLowerCase())
          : null;
        await supabase.from("audit_logs").insert({
          org_id: current.org_id,
          actor_user_id: authCtx.userId,
          action: "pending_engagement.counterparty_disputed_being_named",
          entity_type: "poi_engagement",
          entity_id: engagementId,
          metadata: {
            cp_rule: "CP-012",
            dispute_id: disputeRowId,
            engagement_id: engagementId,
            match_id: matchIdForDispute,
            poi_id: (current as { poi_id?: string | null }).poi_id ?? null,
            initiator_organisation_id: current.org_id,
            counterparty_organisation_id: counterpartyOrgId,
            counterparty_name: (current as { contact_name?: string | null }).contact_name ?? null,
            counterparty_email_hash: counterpartyEmailHash,
            dispute_reason: "disputes_being_named",
            engagement_status_before: current.engagement_status,
            engagement_status_after: "disputed_being_named",
            match_status_after: "dispute_active",
            progression_blocked: true,
            poi_completed: false,
            wad_triggered: false,
            execution_started: false,
            credit_burned: creditBurnedForMatch,
            payment_event_created: false,
            billing_review_required: !!billingReviewRiskItemId,
            billing_review_risk_item_id: billingReviewRiskItemId,
            raised_at: nowIso,
            raised_by: authCtx.userId,
            request_id: requestId,
          },
        });
      } catch (e) {
        console.warn(
          `[${requestId}] CP-012 sibling audit insert failed (non-fatal):`,
          e instanceof Error ? e.message : e,
        );
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

      // D4c-3e: initiator-side alert that the Pending Engagement is
      // paused for platform review. The already-disputed early-return
      // above guarantees this branch only runs on the INITIAL entry to
      // disputed_being_named (replays return 409 before reaching here),
      // so dedupe is naturally enforced. Recipients are derived ONLY
      // from poi_engagements.org_id by the helper; the disputed
      // counterparty, candidate orgs, and external counterparties are
      // never contacted. Metadata is restricted to safe operational
      // fields. Do NOT add counterparty email/name/org_id, disputed
      // party identity, dispute_reason, candidate orgs, binding
      // candidates, commodity, price, quantity, or any user-entered
      // dispute text. Best-effort: never fails the primary flow.
      try {
        const d4cResult = await dispatchD4cInitiatorAlert(supabase, {
          eventType: "engagement.disputed_being_named",
          engagementId,
          actorUserId: authCtx.userId ?? null,
          sourceFunction: "poi-engagements",
          dedupeKey: `disputed_being_named:${engagementId}`,
          metadata: {
            request_id: requestId,
            previous_status: current.engagement_status ?? null,
            previous_operational_state:
              (current as { operational_state?: string | null }).operational_state ?? null,
          },
        });
        if (!d4cResult.ok) {
          console.warn(
            `[${requestId}] d4c initiator alert skipped (non-fatal): reason=${d4cResult.reason}`,
          );
        }
      } catch (e) {
        console.warn(
          `[${requestId}] d4c initiator alert dispatch threw (non-fatal):`,
          e instanceof Error ? e.message : e,
        );
      }

      const responseBody = {
        engagement: updated,
        dispute: {
          id: disputeRowId,
          match_status: matchIdForDispute ? "dispute_active" : null,
          billing_review_risk_item_id: billingReviewRiskItemId,
        },
        acknowledgement:
          "Your dispute has been recorded. The trade has been placed on hold and will not progress unless reviewed and released by Izenzo admin.",
      };
      await storeIdempotentResponse(idemOpts, { status: 200, body: responseBody });
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── POST /poi-engagements/:id/dispute-release ──────────────────────
    // ── POST /poi-engagements/:id/dispute-close ────────────────────────
    // CP-012 admin-only resolution endpoints. Release returns the
    // engagement to its pre-dispute status (recorded in dispute_metadata)
    // or to 'pending' if unknown. Close marks the engagement terminal
    // (declined). Both update public.disputes to a resolved status and
    // never auto-trigger POI, WaD, execution, credit burn, payment or
    // outreach.
    if (
      req.method === "POST" &&
      engagementId &&
      (parts[1] === "dispute-release" || parts[1] === "dispute-close")
    ) {
      const action = parts[1] as "dispute-release" | "dispute-close";
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(engagementId)) {
        throw new ApiException("VALIDATION_ERROR", "Invalid engagement ID format", 400);
      }
      // Platform-admin only.
      if (!authCtx.roles?.includes("platform_admin")) {
        throw new ApiException(
          "FORBIDDEN",
          "Only a platform admin may release or close a counterparty dispute.",
          403,
        );
      }
      const idempotencyKey = req.headers.get("Idempotency-Key");
      if (!idempotencyKey) {
        throw new ApiException("VALIDATION_ERROR", "Idempotency-Key header is required", 400);
      }
      const idemOpts = {
        supabase,
        orgId: authCtx.orgId ?? "platform",
        endpoint: `POST /poi-engagements/${engagementId}/${action}`,
        idempotencyKey,
        requestId,
      };
      const cached = await lookupIdempotentResponse(idemOpts);
      if (cached) return cachedResponseToHttp(cached, headers);

      const ResolveSchema = z.object({
        resolution_reason: z.string().trim().min(10).max(1000),
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
      if (current.engagement_status !== "disputed_being_named") {
        throw new ApiException(
          "NOT_IN_DISPUTE",
          `Engagement is not in 'disputed_being_named' state (current: ${current.engagement_status}).`,
          409,
        );
      }

      const matchIdLinked = (current as { match_id?: string | null }).match_id ?? null;
      const previousStatus =
        ((current as { dispute_metadata?: { previous_status?: string } | null })
          .dispute_metadata?.previous_status) ?? "pending";
      const nowIso = new Date().toISOString();
      const newEngagementStatus =
        action === "dispute-release" ? previousStatus : "declined";
      const newOperationalState =
        action === "dispute-release"
          ? null
          : null;

      const { data: updated, error: updErr } = await supabase
        .from("poi_engagements")
        .update({
          engagement_status: newEngagementStatus,
          operational_state: newOperationalState,
          operational_state_set_by: authCtx.userId,
          operational_state_set_at: nowIso,
        })
        .eq("id", engagementId)
        .eq("engagement_status", "disputed_being_named")
        .select()
        .maybeSingle();
      if (updErr) throw updErr;
      if (!updated) {
        throw new ApiException(
          "CONFLICT",
          "Engagement state changed concurrently; reload and retry.",
          409,
        );
      }

      // Resolve any open CP-012 dispute rows on this match.
      let resolvedDisputeId: string | null = null;
      if (matchIdLinked) {
        try {
          const { data: resolved } = await supabase
            .from("disputes")
            .update({
              status: action === "dispute-release" ? "resolved" : "resolved",
              resolution_outcome:
                action === "dispute-release"
                  ? `CP-012 released by platform admin: ${parsed.data.resolution_reason}`
                  : `CP-012 closed by platform admin: ${parsed.data.resolution_reason}`,
              resolved_at: nowIso,
              resolved_by: authCtx.userId,
            })
            .eq("match_id", matchIdLinked)
            .eq("reason", "cp012_disputes_being_named")
            .eq("status", "open")
            .select("id")
            .maybeSingle();
          resolvedDisputeId = (resolved as { id?: string } | null)?.id ?? null;
        } catch (e) {
          console.warn(
            `[${requestId}] CP-012 dispute resolve update failed (non-fatal):`,
            e instanceof Error ? e.message : e,
          );
        }
      }

      const auditAction =
        action === "dispute-release"
          ? "dispute.counterparty_named_dispute_released"
          : "dispute.counterparty_named_dispute_closed";
      try {
        await supabase.from("audit_logs").insert({
          org_id: current.org_id,
          actor_user_id: authCtx.userId,
          action: auditAction,
          entity_type: "poi_engagement",
          entity_id: engagementId,
          metadata: {
            cp_rule: "CP-012",
            dispute_id: resolvedDisputeId,
            match_id: matchIdLinked,
            previous_status: "disputed_being_named",
            new_status: newEngagementStatus,
            resolution_reason: parsed.data.resolution_reason,
            request_id: requestId,
          },
        });
      } catch (e) {
        console.warn(
          `[${requestId}] CP-012 resolve audit insert failed (non-fatal):`,
          e instanceof Error ? e.message : e,
        );
      }

      const responseBody = {
        engagement: updated,
        dispute: {
          id: resolvedDisputeId,
          status: "resolved",
        },
        action,
      };
      await storeIdempotentResponse(idemOpts, { status: 200, body: responseBody });
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }


    // ── POST /poi-engagements/:id/cancel-by-initiator — Batch J F3 ──
    // The initiator (org admin of poi_engagements.org_id) withdraws an
    // engagement BEFORE the counterparty has accepted. Refund treatment
    // is intentionally NOT automatic — when credits or commercial state
    // may be implicated we file an `admin_risk_items` row of kind
    // `engagement_refund_decision_required` instead. Counterparty is
    // notified via the existing D4c initiator-alert dispatcher (which
    // resolves recipients ONLY from the initiating org_id, so we add a
    // dedicated event id rather than reuse a counterparty channel).
    if (req.method === "POST" && engagementId && parts[1] === "cancel-by-initiator") {
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
        endpoint: `POST /poi-engagements/${engagementId}/cancel-by-initiator`,
        idempotencyKey,
        requestId,
      };
      const cached = await lookupIdempotentResponse(idemOpts);
      if (cached) return cachedResponseToHttp(cached, headers);

      const CancelByInitiatorSchema = z.object({
        reason: z.string().trim().min(10).max(1000),
        refund_decision_required: z.boolean().optional().default(false),
      });
      const body = await req.json().catch(() => ({}));
      const parsed = CancelByInitiatorSchema.safeParse(body);
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

      // Caller must be an org admin of the initiating org OR platform_admin.
      const initiatingOrgId = (current as { org_id?: string | null }).org_id ?? null;
      const isPlatformAdminCaller = authCtx.roles?.includes("platform_admin");
      let isInitiatorOrgAdmin = false;
      if (!isPlatformAdminCaller && initiatingOrgId && authCtx.userId) {
        const { data: orgAdminCheck } = await supabase.rpc("is_org_admin", {
          _user_id: authCtx.userId,
          _org_id: initiatingOrgId,
        });
        isInitiatorOrgAdmin = !!orgAdminCheck;
      }
      if (!isPlatformAdminCaller && !isInitiatorOrgAdmin) {
        throw new ApiException(
          "FORBIDDEN",
          "Only an admin of the initiating organisation (or a platform admin) may cancel this engagement.",
          403,
        );
      }

      // State guards.
      const currentStatus = (current as { engagement_status?: string }).engagement_status ?? "";
      if (SUPERSEDED_ENGAGEMENT_STATUSES.has(currentStatus)) {
        throw new ApiException(
          "ALREADY_CANCELLED",
          `This engagement is already in a cancelled/superseded state (${currentStatus}).`,
          409,
        );
      }
      if (!INITIATOR_CANCELLABLE_STATUSES.has(currentStatus)) {
        throw new ApiException(
          "ENGAGEMENT_NOT_CANCELLABLE",
          `Initiator cancellation is not allowed from engagement_status='${currentStatus}'. Use dispute, settlement, or the admin refund-decision workflow instead.`,
          409,
          { current_status: currentStatus },
        );
      }

      // Irreversible POI/WaD state check via the linked match.
      const matchIdLinked = (current as { match_id?: string | null }).match_id ?? null;
      let poiState: string | null = null;
      if (matchIdLinked) {
        const { data: m } = await supabase
          .from("matches")
          .select("poi_state, status, state")
          .eq("id", matchIdLinked)
          .maybeSingle();
        poiState = ((m as { poi_state?: string | null } | null)?.poi_state ?? "").toString().toUpperCase() || null;
        if (poiState && IRREVERSIBLE_POI_STATES.has(poiState)) {
          throw new ApiException(
            "POI_STATE_IRREVERSIBLE",
            `The underlying POI is in irreversible state '${poiState}'. Initiator cancellation is blocked; use dispute or the admin refund workflow.`,
            409,
            { poi_state: poiState },
          );
        }
      }

      const { data: actorProfile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", authCtx.userId)
        .maybeSingle();

      const nowIso = new Date().toISOString();
      const { data: updated, error: updErr } = await supabase
        .from("poi_engagements")
        .update({
          engagement_status: "cancelled_by_initiator",
          operational_state: "cancelled_by_initiator",
          operational_state_set_by: authCtx.userId,
          operational_state_set_at: nowIso,
          cancelled_at: nowIso,
          cancelled_reason: `initiator_cancellation: ${parsed.data.reason}`,
          cancelled_by_user_id: authCtx.userId,
        })
        .eq("id", engagementId)
        // Optimistic guard — refuse if state changed since fetch.
        .eq("engagement_status", currentStatus)
        .select()
        .maybeSingle();
      if (updErr) throw updErr;
      if (!updated) {
        throw new ApiException(
          "CONFLICT",
          "Engagement state changed concurrently; please reload and retry.",
          409,
        );
      }

      // Mandatory audit row (AUD-006).
      try {
        await supabase.from("audit_logs").insert({
          org_id: initiatingOrgId,
          actor_user_id: authCtx.userId,
          action: "engagement.cancelled_by_initiator",
          entity_type: "poi_engagement",
          entity_id: engagementId,
          metadata: {
            previous_status: currentStatus,
            reason: parsed.data.reason,
            refund_decision_required: !!parsed.data.refund_decision_required,
            poi_state: poiState,
            match_id: matchIdLinked,
            request_id: requestId,
          },
        });
      } catch (e) {
        console.warn(`[${requestId}] initiator-cancel audit insert failed (non-fatal):`, e);
      }
      try {
        await supabase.from("engagement_outreach_logs").insert({
          engagement_id: engagementId,
          actor_type: isPlatformAdminCaller ? "admin" : "initiator",
          admin_user_id: isPlatformAdminCaller ? authCtx.userId : null,
          admin_email: actorProfile?.email ?? "unknown",
          admin_name: actorProfile?.full_name ?? null,
          previous_status: currentStatus,
          new_status: "cancelled_by_initiator",
          entry_type: "cancelled",
          notes: JSON.stringify({
            event: "cancelled_by_initiator",
            reason: parsed.data.reason,
            refund_decision_required: !!parsed.data.refund_decision_required,
            request_id: requestId,
          }),
        });
      } catch (logErr) {
        console.warn(`[${requestId}] initiator-cancel outreach log insert failed (non-fatal):`, logErr);
      }

      // NOT-008: resolve any unread in-app notifications attached to this engagement.
      await resolveNotificationsFor(supabase, "poi_engagement", engagementId, {
        requestId,
        source: "poi-engagements:initiator_cancel",
      });
      // Optional admin_risk_items row — NO automatic refund, manual decision.
      let riskItemId: string | null = null;
      if (parsed.data.refund_decision_required) {
        try {
          const { data: risk } = await supabase
            .from("admin_risk_items")
            .insert({
              org_id: initiatingOrgId,
              kind: "engagement_refund_decision_required",
              title: "Refund decision required after initiator-cancelled engagement",
              description:
                "An engagement was cancelled by the initiator after credits / commercial state may have been impacted. " +
                "Manual review required — no automatic refund has been issued.",
              severity: "medium",
              status: "open",
              dedup_key: `engagement_refund_decision_required:${engagementId}`,
              metadata: {
                engagement_id: engagementId,
                match_id: matchIdLinked,
                previous_status: currentStatus,
                reason: parsed.data.reason,
                request_id: requestId,
              },
            })
            .select("id")
            .maybeSingle();
          riskItemId = (risk as { id?: string } | null)?.id ?? null;
        } catch (e) {
          console.warn(`[${requestId}] admin_risk_items insert failed (non-fatal):`, e);
        }
      }

      // Best-effort initiator-side operational notice. The counterparty
      // is informed via the existing notification pipeline keyed off
      // engagement_status transitions (no PII in metadata).
      try {
        const d4cResult = await dispatchD4cInitiatorAlert(supabase, {
          eventType: "engagement.cancelled_by_initiator",
          engagementId,
          actorUserId: authCtx.userId ?? null,
          sourceFunction: "poi-engagements",
          dedupeKey: `cancelled_by_initiator:${engagementId}`,
          metadata: {
            request_id: requestId,
            previous_status: currentStatus,
            refund_decision_required: !!parsed.data.refund_decision_required,
          },
        });
        if (!d4cResult.ok) {
          console.warn(
            `[${requestId}] d4c initiator alert skipped (non-fatal): reason=${d4cResult.reason}`,
          );
        }
      } catch (e) {
        console.warn(
          `[${requestId}] d4c initiator alert dispatch threw (non-fatal):`,
          e instanceof Error ? e.message : e,
        );
      }

      const responseBody = {
        engagement: updated,
        refund_decision: {
          required: !!parsed.data.refund_decision_required,
          risk_item_id: riskItemId,
          auto_refund_issued: false,
        },
      };
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
      // Batch J F5 — duplicate-recreate guard. The DB carries a partial
      // unique index `uniq_poi_engagements_active_match_email` on
      // (match_id, lower(counterparty_email)) for active rows. We
      // pre-check here so the client gets a typed code instead of a
      // raw 23505. Service-role client bypasses RLS by design.
      {
        const matchIdForCheck = (current as { match_id?: string | null }).match_id ?? null;
        const newEmailLc = parsed.data.new_email.trim().toLowerCase();
        if (matchIdForCheck) {
          const { data: dupRow } = await supabase
            .from("poi_engagements")
            .select("id, engagement_status")
            .eq("match_id", matchIdForCheck)
            .eq("counterparty_email", newEmailLc)
            .not("id", "eq", engagementId)
            .in("engagement_status", [
              "pending",
              "notification_sent",
              "contacted",
              "accepted",
              "late_acceptance_pending_initiator_reconfirmation",
            ])
            .maybeSingle();
          if (dupRow?.id) {
            throw new ApiException(
              "ENGAGEMENT_ALREADY_REPLACED",
              "An active engagement for this match and counterparty email already exists. The DB unique-index backstop will refuse a second concurrent active row.",
              409,
              { existing_engagement_id: dupRow.id, existing_status: dupRow.engagement_status },
            );
          }
        }
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
      // CP-015 (signed): sibling audit naming for dashboard parity.
      // Confirms the old engagement was cancelled/superseded, that direct
      // edit was not allowed, and that any replacement MUST be created as
      // a new engagement. No POI/WaD/credit/payment side effects occur.
      try {
        const oldEmailHash = oldEmail ? await sha256Hex(oldEmail) : null;
        const newEmailHash = parsed.data.new_email
          ? await sha256Hex(parsed.data.new_email.toLowerCase())
          : null;
        await supabase.from("audit_logs").insert({
          org_id: current.org_id,
          actor_user_id: authCtx.userId,
          action: "pending_engagement.email_change_blocked_requires_new_engagement",
          entity_type: "poi_engagement",
          entity_id: engagementId,
          metadata: {
            cp_rule: "CP-015",
            reason: "counterparty_email_change_after_creation",
            old_engagement_id: engagementId,
            new_engagement_id: null,
            match_id: (current as { match_id?: string | null }).match_id ?? null,
            poi_id: (current as { poi_id?: string | null }).poi_id ?? null,
            initiator_user_id: authCtx.userId,
            initiator_organisation_id: current.org_id,
            old_counterparty_email_hash: oldEmailHash,
            new_counterparty_email_hash: newEmailHash,
            counterparty_name: (current as { contact_name?: string | null }).contact_name ?? null,
            old_status_before: current.engagement_status,
            old_status_after: "cancelled_email_change",
            direct_edit_allowed: false,
            new_engagement_created: false,
            old_outreach_link_invalidated: true,
            poi_completed_from_old_engagement: false,
            wad_triggered_from_old_engagement: false,
            credit_burned_for_email_change: false,
            payment_event_created_for_email_change: false,
            billing_review_required: false,
            changed_by_user_id: authCtx.userId,
            changed_at: nowIso,
            request_id: requestId,
          },
        });
      } catch (e) {
        console.warn(`[${requestId}] CP-015 sibling (cancelled) audit insert failed (non-fatal):`, e);
      }

      // ── D4c-3a: best-effort initiator-side operational notice ────────
      // Wired only after the cancellation state is committed and audited.
      // The helper resolves recipients ONLY from the initiating org_id;
      // it never reads counterparty/candidate/disputed fields. We pass
      // no counterparty email, no new_email, no commodity, no PII — just
      // the engagement id, a stable dedupe key, and the source function.
      try {
        const d4cResult = await dispatchD4cInitiatorAlert(supabase, {
          eventType: "engagement.cancelled_email_change",
          engagementId,
          actorUserId: authCtx.userId ?? null,
          sourceFunction: "poi-engagements",
          dedupeKey: `cancelled_email_change:${engagementId}`,
          metadata: {
            request_id: requestId,
            previous_status: current.engagement_status,
          },
        });
        if (!d4cResult.ok) {
          console.warn(
            `[${requestId}] d4c initiator alert skipped (non-fatal): reason=${d4cResult.reason}`,
          );
        }
      } catch (e) {
        console.warn(
          `[${requestId}] d4c initiator alert dispatch threw (non-fatal):`,
          e instanceof Error ? e.message : e,
        );
      }

      // NOT-008: resolve any unread in-app notifications attached to this engagement.
      await resolveNotificationsFor(supabase, "poi_engagement", engagementId, {
        requestId,
        source: "poi-engagements:cancelled_email_change",
      });

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

      // ── D4c-3b: best-effort initiator-side operational notice ────────
      // Fired ONLY when the resolution actually closes binding review
      // (confirmed_canonical or deferred_no_review_needed). The "rejected"
      // branch reasserts operational_state='binding_review_required' and
      // is therefore intentionally skipped — the review is not resolved
      // and `engagement.binding_review_resolved` would be misleading.
      //
      // The helper resolves recipients ONLY from the initiating org_id;
      // it never reads counterparty/candidate/disputed fields. Metadata
      // contains no counterparty email, candidate org, binding-candidate
      // detail, commodity, price, quantity, or disputed-party identity —
      // only the request id and the operational outcome.
      if (parsed.data.resolution !== "rejected") {
        try {
          const d4cResult = await dispatchD4cInitiatorAlert(supabase, {
            eventType: "engagement.binding_review_resolved",
            engagementId,
            actorUserId: authCtx.userId ?? null,
            sourceFunction: "poi-engagements",
            dedupeKey: `binding_review_resolved:${engagementId}`,
            metadata: {
              request_id: requestId,
              resolution: parsed.data.resolution,
              previous_operational_state: previousOperationalState,
            },
          });
          if (!d4cResult.ok) {
            console.warn(
              `[${requestId}] d4c initiator alert skipped (non-fatal): reason=${d4cResult.reason}`,
            );
          }
        } catch (e) {
          console.warn(
            `[${requestId}] d4c initiator alert dispatch threw (non-fatal):`,
            e instanceof Error ? e.message : e,
          );
        }
      }

      // NOT-008: when a binding-review dispute is actually resolved
      // (confirmed_canonical or deferred_no_review_needed — NOT "rejected",
      // which keeps the engagement parked), clear any unread admin / initiator
      // in-app notifications attached to this engagement.
      if (parsed.data.resolution !== "rejected") {
        await resolveNotificationsFor(supabase, "poi_engagement", engagementId, {
          requestId,
          source: `poi-engagements:binding_review_${parsed.data.resolution}`,
        });
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

      // Batch D Test 6 — duplicate-click / replay protection. Required header.
      // The shared idempotency helper caches the successful 200 response keyed
      // on (org_id, endpoint, idempotency_key). A second click using the same
      // key replays the same body with X-Idempotent-Replay: true rather than
      // running the RPC again, so no second renewed engagement / audit row
      // can be created. The advisory lock + status precondition inside
      // atomic_reconfirm_late_acceptance / atomic_decline_late_acceptance
      // remain the durable backstop.
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
        endpoint: `POST /poi-engagements/${engagementId}/${action}`,
        idempotencyKey,
        requestId,
      };
      const cached = await lookupIdempotentResponse(idemOpts);
      if (cached) return cachedResponseToHttp(cached, headers);

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

      // ── CP-009 / DEC-003 (signed) — late-acceptance resolution sibling audit ──
      // Sits alongside the canonical RPC-written rows
      // (`pending_engagement.reconfirmed` /
      //  `pending_engagement.initiator_declined_after_late_acceptance`).
      // Fires on every successful resolution, regardless of whether the
      // initiator is org_admin or platform_admin (override is separately
      // audited below). Non-fatal: a failure here must never roll back the
      // RPC-committed transition.
      try {
        const pa = (parentAfter ?? {}) as Record<string, unknown>;
        const counterpartyEmail =
          (pa.counterparty_email as string | null | undefined) ?? null;
        const counterpartyEmailHash = counterpartyEmail
          ? await sha256Hex(counterpartyEmail.toLowerCase())
          : null;
        const priorStatus = (parent as { engagement_status?: string | null })
          .engagement_status ?? null;
        const newStatus = (pa.engagement_status as string | null) ?? null;
        const nowIso = new Date().toISOString();
        const isReconfirm = action === "reconfirm";
        const siblingAction = isReconfirm
          ? "pending_engagement.late_acceptance_reconfirmed_by_initiator"
          : "pending_engagement.late_acceptance_declined_by_initiator";
        const cpRule = "CP-009";
        await supabase.from("audit_logs").insert({
          org_id: authCtx.orgId,
          actor_user_id: authCtx.userId,
          action: siblingAction,
          entity_type: "poi_engagement",
          entity_id: engagementId,
          metadata: {
            cp_rule: cpRule,
            engagement_id: engagementId,
            renewed_engagement_id: renewedId ?? null,
            match_id: (pa.match_id as string | null) ?? null,
            poi_id: (pa.poi_id as string | null) ?? null,
            initiator_user_id: authCtx.userId,
            initiator_organisation_id: authCtx.orgId,
            counterparty_user_id:
              (pa.counterparty_user_id as string | null) ?? null,
            counterparty_organisation_id:
              (pa.counterparty_org_id as string | null) ?? null,
            counterparty_email_hash: counterpartyEmailHash,
            prior_engagement_status: priorStatus,
            new_engagement_status: newStatus,
            counterparty_response: "accepted_after_expiry",
            ...(isReconfirm
              ? { initiator_reconfirmed: true, reconfirmed_at: nowIso }
              : { initiator_declined: true, declined_at: nowIso }),
            poi_completed: false,
            wad_triggered: false,
            credit_burned: false,
            payment_event_created: false,
            actor_role: isInitiatorOrgAdmin ? "org_admin" : "platform_admin",
            source: `poi-engagements:initiator_${action}`,
            request_id: requestId,
          },
        });
      } catch (e) {
        console.warn(
          `[${requestId}] CP-009 ${action} sibling audit insert failed (non-fatal):`,
          e instanceof Error ? e.message : e,
        );
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

      // NOT-008: terminal initiator decision — resolve any unread in-app
      // notifications attached to the parent engagement (and the renewed
      // child, if late_acceptance reconfirm spawned one).
      await resolveNotificationsFor(supabase, "poi_engagement", engagementId, {
        requestId,
        source: `poi-engagements:initiator_${action}`,
      });

      const responseBody = {
        parent_engagement: parentAfter,
        renewed_engagement: renewedChild,
        rpc: rpcResult,
      };
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
      // Batch J F4 — supersession gate covers accept + decline. The
      // counterparty cannot transition a replaced or initiator-cancelled
      // engagement; the new replacement carries the live token.
      {
        const sup = evaluateSupersessionGate(engagement as Record<string, unknown>);
        if (sup) {
          throw new ApiException(sup.code, sup.message, 409, {
            current_status: (engagement as { engagement_status?: string }).engagement_status ?? null,
            superseded_by_engagement_id:
              (engagement as { superseded_by_engagement_id?: string | null }).superseded_by_engagement_id ?? null,
          });
        }
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

        // ── D4c-3c: best-effort initiator-side operational notice ────────
        // Fired ONLY on the initial transition into
        // late_acceptance_pending_initiator_reconfirmation. The
        // reconfirm and decline routes are SEPARATE handlers
        // (`/reconfirm`, `/decline-late-acceptance`)
        // and do NOT dispatch this event.
        //
        // The helper resolves recipients ONLY from the initiating
        // org_id (poi_engagements.org_id); it never reads
        // counterparty/candidate/disputed fields. Metadata contains
        // no counterparty email, candidate org, binding-candidate
        // detail, commodity, price, quantity, or disputed-party
        // identity — only the request id and prior status.
        try {
          const d4cResult = await dispatchD4cInitiatorAlert(supabase, {
            eventType: "engagement.late_acceptance_pending_reconfirmation",
            engagementId: engagement.id,
            actorUserId: authCtx.userId ?? null,
            sourceFunction: "poi-engagements",
            dedupeKey: `late_acceptance_pending_reconfirmation:${engagement.id}`,
            metadata: {
              request_id: requestId,
              previous_status: currentStatus,
            },
          });
          if (!d4cResult.ok) {
            console.warn(
              `[${requestId}] d4c initiator alert skipped (non-fatal): reason=${d4cResult.reason}`,
            );
          }
        } catch (e) {
          console.warn(
            `[${requestId}] d4c initiator alert dispatch threw (non-fatal):`,
            e instanceof Error ? e.message : e,
          );
        }

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
              // CP-009 / DEC-003 (signed): counterparty acknowledgement copy.
              // Surfaced verbatim by the counterparty-facing landing page; do
              // not rephrase without re-signing.
              counterparty_acknowledgement:
                "This engagement has expired. Your acceptance has been recorded, but the initiator must reconfirm before the engagement can proceed.",
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

      // ── DEC-005 / DEC-006 (signed): express counterparty acceptance
      // wording-state flip. The atomic RPC above wrote the canonical
      // engagement.counterparty_responded row. These additive rows pin
      // the wording-state ledger transition from
      // "draft_intent_record" → "accepted_mutual_intent_record" so the
      // before/after wording posture is reconstructible from audit_logs
      // alone. No POI mint, WaD, execution, finality, credit burn, or
      // payment event is triggered by these inserts.
      if (parsed.data.action === "accepted") {
        const acceptedAt = new Date().toISOString();
        const initiatorOrgId =
          (matchData as { org_id?: string | null }).org_id ?? engagement.org_id ?? null;
        const acceptanceMetaBase = {
          engagement_id: engagement.id,
          match_id: matchId,
          poi_id: (engagement as { poi_id?: string | null }).poi_id ?? null,
          counterparty_user_id: authCtx.userId,
          counterparty_organisation_id: authCtx.orgId,
          initiator_organisation_id: initiatorOrgId,
          accepted_at: acceptedAt,
          request_id: requestId,
        };
        try {
          await supabase.from("audit_logs").insert({
            org_id: initiatorOrgId,
            actor_user_id: authCtx.userId,
            action: "counterparty.acceptance_recorded_wording_state_updated",
            entity_type: "poi_engagement",
            entity_id: engagement.id,
            metadata: {
              dec_rule: "DEC-005",
              ...acceptanceMetaBase,
              status_before: currentStatus,
              status_after: "accepted",
              wording_state_before: "draft_intent_record",
              wording_state_after: "accepted_mutual_intent_record",
              surface: "live_edge_function:counterparty-respond",
            },
          });
        } catch (e) {
          console.warn(`[${requestId}] DEC-005 acceptance_recorded_wording_state_updated audit insert failed (non-fatal):`, e);
        }
        try {
          await supabase.from("audit_logs").insert({
            org_id: initiatorOrgId,
            actor_user_id: authCtx.userId,
            action: "legal.poi_wording_updated_after_counterparty_acceptance",
            entity_type: "poi_engagement",
            entity_id: engagement.id,
            metadata: {
              dec_rule: "DEC-006",
              ...acceptanceMetaBase,
              counterparty_acceptance_status: "accepted",
              poi_wording_state: "accepted_mutual_intent_record",
              approved_wording_used: {
                poi_label: ACCEPTED_POI_LABEL,
                post_acceptance_qualifier: POST_ACCEPTANCE_QUALIFIER,
              },
              updated_at: acceptedAt,
              created_at: acceptedAt,
              surface: "live_edge_function:counterparty-respond",
            },
          });
        } catch (e) {
          console.warn(`[${requestId}] DEC-006 poi_wording_updated_after_counterparty_acceptance audit insert failed (non-fatal):`, e);
        }
        try {
          await supabase.from("audit_logs").insert({
            org_id: initiatorOrgId,
            actor_user_id: authCtx.userId,
            action: "legal.poi_binding_wording_applied",
            entity_type: "poi_engagement",
            entity_id: engagement.id,
            metadata: {
              dec_rule: "DEC-006",
              ...acceptanceMetaBase,
              initiator_user_id: null,
              counterparty_acceptance_status: "accepted",
              poi_wording_state: "accepted_mutual_intent_record",
              approved_wording_used: {
                poi_label: ACCEPTED_POI_LABEL,
                post_acceptance_qualifier: POST_ACCEPTANCE_QUALIFIER,
              },
              surface: "live_edge_function:counterparty-respond",
              created_at: acceptedAt,
            },
          });
        } catch (e) {
          console.warn(`[${requestId}] DEC-006 poi_binding_wording_applied (accepted) audit insert failed (non-fatal):`, e);
        }
      }

      // NOT-008: terminal counterparty response — resolve any unread in-app
      // notifications attached to this engagement (e.g. "respond to engagement").
      await resolveNotificationsFor(supabase, "poi_engagement", engagement.id, {
        requestId,
        source: `poi-engagements:counterparty_${parsed.data.action}`,
      });

      return new Response(JSON.stringify({ engagement: updated }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    throw new ApiException("NOT_FOUND", "Endpoint not found", 404);
  } catch (error) {
    const _src = extractSourceLocation(error as Error);
    console.error(JSON.stringify({
      level: "error",
      fn: "poi-engagements",
      kind: "handler",
      requestId,
      name: (error as Error)?.name ?? "Error",
      message: (error as Error)?.message ?? String(error),
      source: _src,
      isApiException: error instanceof ApiException,
      code: error instanceof ApiException ? error.code : undefined,
    }));
    return errorResponse(error as Error, requestId, headers);
  }
});
