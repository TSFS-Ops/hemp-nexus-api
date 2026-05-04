import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { matchSchema, validateInput } from "../_shared/validation.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { triggerWebhooks } from "../_shared/webhooks.ts";
import { recordMatchEvent } from "../_shared/match-events.ts";
import { 
  enforceTokenMetering, 
  burnTokensForAction, 
  calculateFinalityBurn,
  ensureSufficientTokens,
  ACTION_TOKEN_COSTS 
} from "../_shared/token-metering.ts";
import { enforceEligibility, evaluateEligibility, formatEligibilityResponse } from "../_shared/eligibility.ts";
import { evaluateSoftRoute, resolveCounterpartyBinding, type BindingHint } from "../_shared/soft-route.ts";
import { deriveActorIds, getCreatedBy } from "../_shared/actor-context.ts";
import { checkMaintenanceMode, tryBypass } from "../_shared/test-mode-bypass.ts";
import {
  lookupIdempotentResponse,
  storeIdempotentResponse,
  cachedResponseToHttp,
} from "../_shared/idempotency.ts";
import { checkOrgLegitimacy, getActiveGovernanceProfile, ORG_NOT_VERIFIED_CODE } from "../_shared/legitimacy.ts";
import { emitRevenueNotification } from "../_shared/revenue-notify.ts";
// Constants for request validation
const MAX_BODY_SIZE = 1024 * 1024; // 1MB max body size
const uuidSchema = z.string().uuid();

/** Check if the caller's org is a party to the match (creator, buyer, or seller). */
function isMatchParty(match: { org_id: string; buyer_org_id?: string | null; seller_org_id?: string | null }, callerOrgId: string): boolean {
  return match.org_id === callerOrgId
    || match.buyer_org_id === callerOrgId
    || match.seller_org_id === callerOrgId;
}

// Valid state transitions for transaction state machine
const VALID_STATE_TRANSITIONS: Record<string, string[]> = {
  'discovery': ['intent_declared'],
  'intent_declared': ['counterparty_sighted'],
  'counterparty_sighted': ['committed'],
  'committed': ['completed'],
  'completed': [],
};

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const requestStart = Date.now();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  const logApiRequest = async (params: {
    // Edge Functions run with untyped Supabase client generics; keep this helper permissive.
    supabase: any;
    orgId: string;
    apiKeyId: string | null;
    endpoint: string;
    method: string;
    statusCode: number;
    errorMessage?: string | null;
  }) => {
    try {
      const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null;
      const userAgent = req.headers.get("user-agent") || null;

      await params.supabase.from("api_request_logs").insert({
        org_id: params.orgId,
        api_key_id: params.apiKeyId,
        endpoint: params.endpoint,
        method: params.method,
        status_code: params.statusCode,
        response_time_ms: Math.max(0, Date.now() - requestStart),
        request_id: requestId,
        error_message: params.errorMessage || null,
        ip_address: ipAddress,
        user_agent: userAgent,
      } as any);
    } catch (e) {
      // Never fail the API call because logging failed.
      console.warn(`[${requestId}] Failed to write api_request_logs`, e);
    }
  };

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const url = new URL(req.url);
    const rawParts = url.pathname.split("/").filter(Boolean);
    
    // Normalize path: strip optional prefixes
    const parts = [...rawParts];
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "match") parts.shift();
    
    const matchId = parts[0];
    const action = parts[1]; // 'settle' if present

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate
    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    requireScope(authCtx, 'match');

    // Rate limiting
    await checkRateLimit(supabase, authCtx.orgId, authCtx.isApiKey ? authCtx.userId : null, 'match', 'match');
    
    // Derive actor IDs once for use throughout the request
    const { actorUserId, actorApiKeyId } = deriveActorIds(authCtx);

    // ── Maintenance gate: block all mutating methods (read-only stays available) ──
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      const maintenance = await checkMaintenanceMode(supabase, {
        source: "match",
        actorUserId: actorUserId ?? null,
        orgId: authCtx.orgId,
        action: `match:${req.method}:${action ?? "root"}`,
      });
      if (maintenance.blocked) {
        await logApiRequest({
          supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
          endpoint: `match`, method: req.method, statusCode: 503,
          errorMessage: "maintenance_mode",
        });
        return new Response(
          JSON.stringify({
            error: "Service temporarily unavailable — platform is in maintenance mode.",
            code: "MAINTENANCE_MODE",
          }),
          { status: 503, headers: { ...headers, "Content-Type": "application/json" } },
        );
      }
    }

    // NOTE: Token burn: only 1 credit charged for the full POI generation.
    // The settle/declare-intent endpoint chains all transitions (discovery → committed) in one call.

    // Route: POST /match/:id/settle OR /match/:id/declare-intent OR /match/:id/generate-poi
    // All endpoints do the same thing: discovery → committed (1 credit, R10)
    // Chains: intent_declared → counterparty_sighted → committed atomically
    if (req.method === "POST" && matchId && (action === "settle" || action === "declare-intent" || action === "generate-poi")) {
      const endpointLabel = `/match/:id/${action}`;

      // Validate matchId is a valid UUID
      const uuidResult = uuidSchema.safeParse(matchId);
      if (!uuidResult.success) {
        await logApiRequest({
          supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
          endpoint: endpointLabel, method: "POST", statusCode: 400,
          errorMessage: "Invalid match ID format",
        });
        throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);
      }

      // Require Idempotency-Key header (server-side enforcement)
      const idempotencyKey = req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key");
      if (!idempotencyKey) {
        await logApiRequest({
          supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
          endpoint: endpointLabel, method: "POST", statusCode: 400,
          errorMessage: "Missing Idempotency-Key header",
        });
        throw new ApiException("VALIDATION_ERROR", "Idempotency-Key header is required", 400);
      }

      console.log(`[${requestId}] POST /match/${matchId}/${action} (Generate POI) idem=${idempotencyKey}`);

      // --- Idempotent replay short-circuit ---
      // If we have already processed this exact (org, key, endpoint) combo within
      // the 24h TTL, return the cached response verbatim. Prevents the second
      // request from re-running waiver/burn/state-transition logic, and ensures
      // the client receives the SAME body it would have received on the first
      // attempt — even if the network dropped before the first response landed.
      const idemEndpointLabel = `POST ${endpointLabel}`;
      try {
        const cached = await lookupIdempotentResponse({
          supabase,
          orgId: authCtx.orgId,
          endpoint: idemEndpointLabel,
          idempotencyKey,
          required: true,
          requestId,
        });
        if (cached) {
          console.log(`[${requestId}] Idempotent replay hit for ${idempotencyKey}`);
          await logApiRequest({
            supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
            endpoint: endpointLabel, method: "POST", statusCode: cached.status,
          });
          return cachedResponseToHttp(cached, headers);
        }
      } catch (idemErr) {
        // lookupIdempotentResponse only throws when required=true && key missing;
        // we already validated above, so this branch is defensive.
        console.error(`[${requestId}] Idempotency lookup error:`, idemErr);
      }

      // --- Fetch match (read-only, for eligibility check & audit metadata) ---
      const { data: match, error: fetchError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .maybeSingle();

      if (fetchError) handleDatabaseError(fetchError, requestId);
      if (!match) {
        throw new ApiException("NOT_FOUND", "Match not found", 404);
      }

      if (!isMatchParty(match, authCtx.orgId)) {
        throw new ApiException("FORBIDDEN", "You do not have permission to confirm intent for this match", 403);
      }

      const currentState = match.state || 'discovery';
      
      // Idempotent return if already past discovery (POI already generated)
      if (['intent_declared', 'counterparty_sighted', 'committed', 'completed'].includes(currentState) || match.status === 'settled') {
        console.log(`[${requestId}] POI already generated - returning idempotently`);
        await logApiRequest({
          supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
          endpoint: endpointLabel, method: "POST", statusCode: 200,
        });
        return new Response(JSON.stringify(match), {
          status: 200,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      if (currentState !== 'discovery') {
        throw new ApiException(
          "INVALID_STATE",
          `Cannot generate POI from state '${currentState}'. Must be in 'discovery' state.`,
          400
        );
      }

      // DISPUTE GUARD: Block intent declaration if an open dispute exists
      const { data: openDisputes, error: disputeErr } = await supabase
        .from("disputes")
        .select("id")
        .eq("match_id", matchId)
        .eq("status", "open")
        .limit(1);

      if (disputeErr) handleDatabaseError(disputeErr, requestId);
      if (openDisputes && openDisputes.length > 0) {
        throw new ApiException(
          "DISPUTE_ACTIVE",
          "Cannot confirm intent while an open dispute exists on this match. Resolve the dispute first.",
          409
        );
      }

      // ── LEGITIMACY GATE (David & Daniel: "easy entry, hard legitimacy") ──
      // Unverified orgs may search, draft and engage internally — but they
      // MUST NOT mint a counterparty-facing POI under Izenzo's name UNLESS
      // their tenant posture defers verification to WaD.  This check runs
      // BEFORE the engagement guard, BEFORE evidence/waiver gates, and
      // BEFORE the credit burn, so an unverified org never loses tokens to
      // a blocked mint and the audit trail records the correct denial reason.
      const governanceProfile = await getActiveGovernanceProfile(supabase, authCtx.orgId);
      const legitimacy = await checkOrgLegitimacy(supabase, authCtx.orgId, "poi_mint");
      if (!legitimacy.allowed) {
        // Test-mode bypass: admin-controlled "kyb" flag short-circuits the
        // legitimacy gate so unverified orgs can still mint POIs in non-prod
        // environments. Production tier is locked out inside tryBypass.
        const bypassed = await tryBypass(supabase, {
          gate: "kyb",
          source: "match",
          orgId: authCtx.orgId,
          actorUserId,
          requestId,
          details: {
            callsite: "poi_mint",
            match_id: matchId,
            legitimacy_reason: legitimacy.reason,
            gate_position: legitimacy.gatePosition,
          },
        });
        if (!bypassed) {
          console.warn(
            `[${requestId}] LEGITIMACY_GATE_BLOCKED reason=${legitimacy.reason} status=${legitimacy.status} gate_position=${legitimacy.gatePosition} match_id=${matchId} org_id=${authCtx.orgId}`,
          );
          try {
            await supabase.from("audit_logs").insert({
              org_id: match.org_id,
              actor_user_id: actorUserId,
              actor_api_key_id: actorApiKeyId,
              action: "intent.denied",
              entity_type: "match",
              entity_id: matchId,
              metadata: {
                request_id: requestId,
                reason: "org_not_verified",
                legitimacy_reason: legitimacy.reason,
                trade_approval_status: legitimacy.status,
                valid_until: legitimacy.validUntil,
                // ── Step 3: forensic audit memory ──
                gate_position: legitimacy.gatePosition,
                governance_profile_id: governanceProfile.profileId,
              },
            });
          } catch (auditErr) {
            console.error(`[${requestId}] Failed to write legitimacy denial audit row:`, auditErr);
          }
          throw new ApiException(ORG_NOT_VERIFIED_CODE, legitimacy.message, 403);
        }
      }

      // ENGAGEMENT HOLD-POINT GUARD: Block POI generation if counterparty has not accepted
      const { data: engagement, error: engErr } = await supabase
        .from("poi_engagements")
        .select("id, engagement_status")
        .eq("match_id", matchId)
        .maybeSingle();

      if (!engErr && engagement && !["accepted"].includes(engagement.engagement_status)) {
        const statusLabel = engagement.engagement_status.replace(/_/g, " ");
        throw new ApiException(
          "ENGAGEMENT_PENDING",
          `Cannot generate POI: counterparty engagement is '${statusLabel}'. The counterparty must accept before you can proceed.`,
          409
        );
      }


      // ── PARSE OPTIONAL REQUEST BODY ──
      // Two optional payloads can ride on the generate-poi POST body:
      //   • acks — REQUIRED. Always-on truthfulness declaration + authority-
      //     to-bind acknowledgements (per 2026-04-30 final POI scope). Both
      //     must be true on every mint; the DB function rejects with
      //     ACKNOWLEDGEMENTS_REQUIRED / DECLARATION_ACK_REQUIRED /
      //     ATB_ACK_REQUIRED if either is missing.
      //   • counterparty_email — only consumed by the soft-route branch
      //     below. Lets the caller supply an email for an unregistered
      //     counterparty so we can resolve a binding immediately. Lower-cased
      //     and trimmed; never required.
      let acksPayload:
        | { declaration_ack: boolean; atb_ack: boolean; actor_roles: string[]; ack_timestamp: string }
        | null = null;
      let counterpartyEmail: string | null = null;
      // D-02: terms_hash the user acknowledged. Server recomputes from the
      // live row and rejects with TERMS_DRIFT on mismatch. Optional for
      // backwards compatibility (NULL accepted; logged in audit metadata).
      let termsHashFromBody: string | null = null;
      try {
        const contentType = req.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const rawBody = await req.text();
          if (rawBody && rawBody.trim().length > 0) {
            const parsed = JSON.parse(rawBody);
            if (parsed && typeof parsed === "object") {
              if (parsed.acks && typeof parsed.acks === "object") {
                const a = parsed.acks;
                acksPayload = {
                  declaration_ack: a.declaration_ack === true,
                  atb_ack: a.atb_ack === true,
                  actor_roles: Array.isArray(a.actor_roles)
                    ? a.actor_roles.filter((r: unknown) => typeof r === "string")
                    : [],
                  ack_timestamp:
                    typeof a.ack_timestamp === "string" && a.ack_timestamp.length > 0
                      ? a.ack_timestamp
                      : new Date().toISOString(),
                };
              }
              if (typeof parsed.counterparty_email === "string") {
                const trimmed = parsed.counterparty_email.trim().toLowerCase();
                // Loose email shape check; the binding lookup will be the real authority.
                if (trimmed.length > 0 && trimmed.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
                  counterpartyEmail = trimmed;
                }
              }
              // D-02: optional terms_hash. 64-char lowercase hex (sha256).
              if (typeof parsed.terms_hash === "string") {
                const t = parsed.terms_hash.trim().toLowerCase();
                if (/^[0-9a-f]{64}$/.test(t)) termsHashFromBody = t;
              }
            }
          }
        }
      } catch (bodyErr) {
        console.warn(`[${requestId}] Could not parse request body:`, bodyErr);
        // Non-fatal: server-side gates will still enforce.
      }

      // ELIGIBILITY CHECK
      try {
        enforceEligibility(match);
      } catch (eligibilityError) {
        const eligResult = evaluateEligibility(match);
        console.error(`[${requestId}] SENTRY_BREADCRUMB: ELIGIBILITY_FAILED match_id=${matchId} org_id=${authCtx.orgId} match_type=${match.match_type || 'search'} failed_fields=${eligResult.failedFields.join(',')}`);

        // ── SOFT-ROUTE BRANCH ──
        // If the failure is exclusively "counterparty named but not yet a
        // registered organisation" (buyer_id / seller_id missing while the
        // corresponding NAME is set), create a Pending Engagement row
        // instead of returning 422. This is gated tightly: any other
        // eligibility failure (price, commodity, same-counterparty, etc.)
        // still hard-fails as 422. NO credit is charged on the 202 branch
        // — the engagement guard at the top of this handler will block any
        // subsequent generate-poi until the engagement is `accepted`, at
        // which point the normal mint path (with credit burn) runs.
        const softRoute = evaluateSoftRoute(match, eligResult);

        if (softRoute.eligible) {
          console.log(`[${requestId}] SOFT_ROUTE eligible match_id=${matchId} failed_fields=${softRoute.failedFields.join(',')}`);

          // Resolve binding (best-effort; never fatal).
          const binding: BindingHint = await resolveCounterpartyBinding(
            supabase,
            counterpartyEmail,
            requestId,
          );
          const boundOrgId = binding.status === "bound" ? binding.org_id : null;

          // UNIQUE(match_id) on poi_engagements is our idempotency
          // guarantee: a second soft-route attempt for the same match
          // either finds the existing row (and returns it) or hits the
          // unique violation (and we recover by re-fetching).
          const insertPayload = {
            match_id: matchId,
            org_id: match.org_id,
            counterparty_org_id: boundOrgId,
            counterparty_type: boundOrgId ? "known" : "unknown",
            counterparty_email: counterpartyEmail,
            engagement_status: boundOrgId ? "notification_sent" : "pending",
            source: "eligibility_soft_route",
          } as Record<string, unknown>;

          let engagementRow: Record<string, unknown> | null = null;
          const { data: insertedRow, error: insertErr } = await supabase
            .from("poi_engagements")
            .insert(insertPayload)
            .select("*")
            .maybeSingle();

          if (insertErr) {
            // 23505 = unique_violation → an engagement already exists for
            // this match. Re-fetch and return it (idempotent replay).
            // Postgrest surfaces the SQLSTATE in `.code`.
            const code = (insertErr as { code?: string }).code ?? "";
            if (code === "23505") {
              const { data: existing, error: refetchErr } = await supabase
                .from("poi_engagements")
                .select("*")
                .eq("match_id", matchId)
                .maybeSingle();
              if (refetchErr || !existing) {
                console.error(`[${requestId}] SOFT_ROUTE conflict but re-fetch failed:`, refetchErr);
                // Fall through to the original 422 — at least we don't lie.
                throw eligibilityError;
              }
              engagementRow = existing;
              console.log(`[${requestId}] SOFT_ROUTE idempotent replay — existing engagement ${existing.id}`);
            } else {
              console.error(`[${requestId}] SOFT_ROUTE insert failed:`, insertErr);
              // Non-recoverable insert failure: keep the strict 422 contract
              // rather than silently dropping the user into limbo.
              throw eligibilityError;
            }
          } else {
            engagementRow = insertedRow;
            console.log(`[${requestId}] SOFT_ROUTE engagement created ${insertedRow?.id} binding=${binding.status}`);
          }

          // Audit (separate row from intent.denied — soft route is NOT a denial).
          try {
            await supabase.from("audit_logs").insert({
              org_id: match.org_id,
              actor_user_id: actorUserId,
              actor_api_key_id: actorApiKeyId,
              action: "match.poi.soft_routed",
              entity_type: "match",
              entity_id: matchId,
              metadata: {
                request_id: requestId,
                engagement_id: engagementRow?.id,
                failed_fields: softRoute.failedFields,
                missing_buyer_id: softRoute.missingBuyerId,
                missing_seller_id: softRoute.missingSellerId,
                binding_status: binding.status,
                binding_org_id: binding.status === "bound" ? binding.org_id : null,
                counterparty_email_supplied: counterpartyEmail !== null,
                idempotent_replay: insertErr ? true : false,
              },
            });
          } catch (auditErr) {
            console.warn(`[${requestId}] SOFT_ROUTE audit write failed (non-fatal):`, auditErr);
          }

          const responseBody = {
            soft_route: {
              status: "queued",
              failed_fields: softRoute.failedFields,
              message:
                "Counterparty is named but not yet a registered organisation. The deal is queued in Pending Engagements; POI mint will resume once the counterparty registers and accepts.",
            },
            engagement: engagementRow,
            binding,
          };

          // Cache the 202 under the supplied Idempotency-Key so a network
          // retry sees the same body. The match handler's idempotency
          // ledger already short-circuits at the top; this just stores
          // the result for the next attempt.
          try {
            await storeIdempotentResponse(
              {
                supabase,
                orgId: authCtx.orgId,
                endpoint: idemEndpointLabel,
                idempotencyKey,
                requestId,
              },
              { status: 202, body: responseBody },
            );
          } catch (cacheErr) {
            console.warn(`[${requestId}] SOFT_ROUTE idempotency cache write failed (non-fatal):`, cacheErr);
          }

          await logApiRequest({
            supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
            endpoint: endpointLabel, method: "POST", statusCode: 202,
          });

          return new Response(JSON.stringify(responseBody), {
            status: 202,
            headers: { ...headers, "Content-Type": "application/json" },
          });
        }

        // ── HARD-FAIL BRANCH (unchanged) ──
        await supabase.from("audit_logs").insert({
          org_id: match.org_id,
          actor_user_id: actorUserId,
          actor_api_key_id: actorApiKeyId,
          action: "intent.denied",
          entity_type: "match",
          entity_id: matchId,
          metadata: {
            request_id: requestId,
            reason: "eligibility_check_failed",
            match_type: match.match_type || "search",
            error: eligibilityError instanceof ApiException ? eligibilityError.message : "Unknown error",
            eligibility: formatEligibilityResponse(eligResult),
            soft_route_evaluated: true,
            soft_route_reason: softRoute.reason,
          }
        });
        throw eligibilityError;
      }


      // --- FULLY ATOMIC: ack validation + token burn + state transition in ONE DB transaction ---
      // atomic_generate_poi_v2 enforces the always-on declaration + ATB
      // acknowledgements and the per-side minimum-evidence gate (1 doc per
      // side on bilateral) under the same row lock as the burn:
      //   • ACKNOWLEDGEMENTS_REQUIRED / DECLARATION_ACK_REQUIRED /
      //     ATB_ACK_REQUIRED → 400 (no burn).
      //   • MIN_EVIDENCE_PER_SIDE → 409 (no burn). Payload includes the
      //     offending side and per-side counts.
      //   • If everything passes → ledger row, burn, audit, state change all
      //     commit together; if any later step fails, all rollback together.
      const now = new Date().toISOString();
      const { data: transitionResult, error: transitionError } = await supabase.rpc(
        'atomic_generate_poi_v2',
        {
          p_match_id: matchId,
          p_org_id: authCtx.orgId,
          p_settled_at: now,
          p_actor_user_id: actorUserId,
          p_acks: acksPayload as any,
          p_terms_hash: termsHashFromBody,
        }
      );

      if (transitionError) handleDatabaseError(transitionError, requestId);

      // Idempotent replay: POI already generated, return current match
      if (transitionResult?.idempotent) {
        console.log(`[${requestId}] POI already generated - atomic idempotent return`);
        const { data: existingMatch } = await supabase.from("matches").select("*").eq("id", matchId).single();
        await logApiRequest({ supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId, endpoint: endpointLabel, method: "POST", statusCode: 200 });
        return new Response(JSON.stringify(existingMatch), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
      }

      if (!transitionResult?.success) {
        const errCode = transitionResult?.error || 'TRANSITION_FAILED';
        const errMsg = transitionResult?.message || 'State transition failed';
        const statusCode =
          errCode === 'INSUFFICIENT_TOKEN_BALANCE' ? 402 :
          errCode === 'STATE_CONFLICT' ? 409 :
          errCode === 'MIN_EVIDENCE_PER_SIDE' ? 409 :
          errCode === 'TERMS_DRIFT' ? 409 :
          errCode === 'TERMS_HASH_REQUIRED' ? 400 :
          errCode === 'ACKNOWLEDGEMENTS_REQUIRED' ? 400 :
          errCode === 'DECLARATION_ACK_REQUIRED' ? 400 :
          errCode === 'ATB_ACK_REQUIRED' ? 400 :
          errCode === 'ACTOR_REQUIRED' ? 400 :
          errCode === 'NOT_FOUND' ? 404 :
          errCode === 'FORBIDDEN' ? 403 : 400;

        // Server-side breadcrumb for POI gate decisions (so admins can trace
        // why a mint was blocked from edge logs alone, without DB queries).
        if (
          errCode === 'MIN_EVIDENCE_PER_SIDE' ||
          errCode === 'ACKNOWLEDGEMENTS_REQUIRED' ||
          errCode === 'DECLARATION_ACK_REQUIRED' ||
          errCode === 'ATB_ACK_REQUIRED'
        ) {
          console.warn(`[${requestId}] POI_GATE_BLOCKED code=${errCode} match_id=${matchId} org_id=${authCtx.orgId}`);
          try {
            await supabase.from("audit_logs").insert({
              org_id: match.org_id,
              actor_user_id: actorUserId,
              actor_api_key_id: actorApiKeyId,
              action: "intent.denied",
              entity_type: "match",
              entity_id: matchId,
              metadata: {
                request_id: requestId,
                reason: errCode.toLowerCase(),
                acks_supplied: acksPayload !== null,
                declaration_ack: acksPayload?.declaration_ack ?? null,
                atb_ack: acksPayload?.atb_ack ?? null,
                blocked_side: transitionResult?.side ?? null,
                buyer_documents_count: transitionResult?.buyer_documents_count ?? null,
                seller_documents_count: transitionResult?.seller_documents_count ?? null,
              },
            });
          } catch (e) {
            console.warn(`[${requestId}] Failed to write intent.denied audit:`, e);
          }
        }

        // No refund needed — burn and transition are in one transaction; both rolled back on failure
        const errorPayload: Record<string, unknown> = { code: errCode, message: errMsg };
        if (errCode === 'MIN_EVIDENCE_PER_SIDE') {
          errorPayload.side = transitionResult?.side;
          errorPayload.buyer_documents_count = transitionResult?.buyer_documents_count;
          errorPayload.seller_documents_count = transitionResult?.seller_documents_count;
        }
        throw new ApiException(errCode, errMsg, statusCode, errorPayload);
      }

      // Fetch the final state of the match after all transitions
      const { data: finalMatch, error: finalFetchError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .single();
      if (finalFetchError) handleDatabaseError(finalFetchError, requestId);
      const updated = finalMatch;

      // Audit log - POI generation (single consolidated entry)
      try {
        await supabase.from("audit_logs").insert({
          org_id: match.org_id,
          actor_user_id: actorUserId,
          actor_api_key_id: actorApiKeyId,
          action: "poi.generated",
          entity_type: "match",
          entity_id: matchId,
          metadata: {
            request_id: requestId,
            confirmed_at: now,
            committed_at: now,
            hash: match.hash,
            buyer_id: match.buyer_id,
            seller_id: match.seller_id,
            commodity: match.commodity,
            quantity_amount: match.quantity_amount,
            quantity_unit: match.quantity_unit,
            price_amount: match.price_amount,
            price_currency: match.price_currency,
            tokens_burned: ACTION_TOKEN_COSTS.declare_intent,
            previous_state: currentState,
            new_state: updated?.state || 'committed',
            // ── Step 3: forensic audit memory of the legitimacy posture in
            // force at the moment of mint. Lets reviewers reconstruct WHY a
            // historical mint was permitted (e.g. wad_only deferred posture).
            gate_position: legitimacy.gatePosition,
            governance_profile_id: governanceProfile.profileId,
            // ── 2026-04-30 final POI scope: declaration + ATB acks recorded
            // on every mint, plus per-side evidence counts at mint time.
            declaration_ack: acksPayload?.declaration_ack ?? null,
            atb_ack: acksPayload?.atb_ack ?? null,
            actor_roles: acksPayload?.actor_roles ?? [],
            ack_timestamp: acksPayload?.ack_timestamp ?? null,
            evidence_counts: transitionResult?.evidence_counts ?? null,
            note: "POI generated - single credit charge. Discovery → Committed in one step."
          }
        });

        await recordMatchEvent(
          supabase, matchId, match.org_id, "poi.generated",
          {
            confirmedAt: now,
            committedAt: now,
            hash: match.hash,
            commodity: match.commodity,
            tokensCharged: ACTION_TOKEN_COSTS.declare_intent,
            state: updated?.state || 'committed',
            note: "POI generated with single R10 credit charge"
          },
          actorUserId, actorApiKeyId
        );
      } catch (auditError) {
        console.error(`[${requestId}] Failed to create audit log:`, auditError);
        throw new ApiException("AUDIT_LOG_ERROR", "Failed to create audit trail", 500);
      }

      console.log(`[${requestId}] POI generated successfully (discovery → committed)`);

      // ── Create POI Engagement Record (hold-point) ──
      // This creates the engagement tracking entry that gates progression until
      // the counterparty responds (accepted/declined/expired).
      // MUST be awaited — if this fails, the platform is internally inconsistent.
      {
        // Determine counterparty from real org UUIDs, not synthetic buyer_id/seller_id
        const counterpartyOrgId = match.buyer_org_id === match.org_id
          ? match.seller_org_id
          : match.buyer_org_id;
        // A counterparty is only 'known' if a real platform org UUID exists
        const counterpartyType = counterpartyOrgId ? 'known' : 'unknown';

        const { error: engError } = await supabase.from("poi_engagements").insert({
          match_id: matchId,
          org_id: match.org_id,
          counterparty_org_id: counterpartyOrgId || null,
          counterparty_type: counterpartyType,
          engagement_status: 'notification_sent',
        });
        if (engError) {
          console.error(`[${requestId}] CRITICAL: Failed to create POI engagement record:`, engError);
          throw new ApiException("ENGAGEMENT_CREATION_FAILED", "Failed to create engagement tracking record", 500, { detail: engError.message });
        }
        console.log(`[${requestId}] POI engagement record created (type=${counterpartyType}, counterpartyOrgId=${counterpartyOrgId || 'null'})`);
      }

      // Trigger webhooks
      triggerWebhooks(supabase, match.org_id, "poi.generated", {
        matchId, hash: match.hash, confirmedAt: now, committedAt: now,
        commodity: match.commodity, quantity: match.quantity_amount,
        note: "POI generated - no payment or legal obligation"
      }).catch(err => console.error(`Webhook error:`, err));

      // ── POI Notification Routing (fire-and-forget) ──
      // Route A: Unilateral (no counterparty name at all) → notify admins
      // Route B: Bilateral with on-platform counterparty  → notify counterparty org users directly
      // Route C: Bilateral but counterparty NOT on platform (org_id NULL) → email support@izenzo.co.za
      (async () => {
        try {
          const isUnilateral = match.match_type === 'unilateral' || !match.buyer_id || !match.seller_id;
          const creatorOrgId = match.org_id;

          // Fetch creator org name for notification content
          const { data: creatorOrg } = await supabase
            .from("organizations")
            .select("name")
            .eq("id", creatorOrgId)
            .single();
          const creatorOrgName = creatorOrg?.name || 'Unknown Organisation';

          // Fetch creator email for support desk context
          const { data: creatorProfile } = await supabase
            .from("profiles")
            .select("email")
            .eq("org_id", creatorOrgId)
            .limit(1)
            .maybeSingle();
          const creatorEmail = creatorProfile?.email || '';

          // Determine if counterparty is actually on the platform (has an org_id)
          const counterpartyOrgId = match.buyer_org_id === creatorOrgId
            ? match.seller_org_id
            : match.buyer_org_id;
          const hasCounterpartyOnPlatform = !!counterpartyOrgId;

          if (isUnilateral) {
            // ── Route A: Admin facilitation ──
            console.log(`[${requestId}] POI notification: Route A (unilateral) — notifying admins`);

            // 1. In-app: notify all admin users
            const { data: adminRoles } = await supabase
              .from("user_roles")
              .select("user_id")
              .eq("role", "platform_admin");

            if (adminRoles && adminRoles.length > 0) {
              const notifRows = adminRoles.map((r: any) => ({
                user_id: r.user_id,
                type: "poi_admin_facilitation",
                title: `Facilitation needed: ${match.commodity || 'Trade'} POI`,
                body: `A Proof of Intent has been generated for ${match.commodity || 'a trade'} by ${creatorOrgName}. The counterparty is not yet on the platform — please facilitate contact.`,
                link: `/desk/match/${matchId}`,
                org_id: creatorOrgId,
              }));
              await supabase.from("notifications").insert(notifRows);
            }

            // 2. Email: send facilitation alert to configured admin email
            const { data: notifSettings } = await supabase
              .from("admin_settings")
              .select("value")
              .eq("key", "notifications")
              .single();
            const settings = (notifSettings?.value as Record<string, any>) || {};
            const facilitationEmail = (settings.poiFacilitationEmail as string) || 'support@izenzo.co.za';

            if (settings.emailAlerts !== false) {
              await supabase.functions.invoke('send-transactional-email', {
                body: {
                  templateName: 'poi-support-desk-notify',
                  recipientEmail: facilitationEmail,
                  idempotencyKey: `poi-admin-facilitation-${matchId}`,
                  templateData: {
                    matchId,
                    commodity: match.commodity,
                    creatorOrgName,
                    creatorEmail,
                    buyerName: match.buyer_name || match.buyer_id || '',
                    sellerName: match.seller_name || match.seller_id || '',
                    quantityAmount: match.quantity_amount?.toString() || '',
                    quantityUnit: match.quantity_unit || '',
                    priceAmount: match.price_amount?.toString() || '',
                    priceCurrency: match.price_currency || '',
                    issuedAt: now,
                  },
                },
              });
            }
          } else if (!hasCounterpartyOnPlatform) {
            // ── Route C: Bilateral but counterparty NOT on platform ──
            // Counterparty name is known but they have no org_id — email support for manual outreach
            console.log(`[${requestId}] POI notification: Route C (bilateral, counterparty off-platform) — emailing support@izenzo.co.za`);

            // 1. In-app: notify platform admins
            const { data: adminRoles } = await supabase
              .from("user_roles")
              .select("user_id")
              .eq("role", "platform_admin");

            if (adminRoles && adminRoles.length > 0) {
              const counterpartyName = match.buyer_org_id === creatorOrgId
                ? (match.seller_name || match.seller_id || 'Unknown')
                : (match.buyer_name || match.buyer_id || 'Unknown');
              const notifRows = adminRoles.map((r: any) => ({
                user_id: r.user_id,
                type: "poi_support_desk",
                title: `Outreach needed: ${counterpartyName} — ${match.commodity || 'Trade'}`,
                body: `${creatorOrgName} generated a POI for ${match.commodity || 'a trade'} with ${counterpartyName}, who is not registered. Manual outreach required.`,
                link: `/desk/match/${matchId}`,
                org_id: creatorOrgId,
              }));
              await supabase.from("notifications").insert(notifRows);
            }

            // 2. Email: send support desk notification
            await supabase.functions.invoke('send-transactional-email', {
              body: {
                templateName: 'poi-support-desk-notify',
                recipientEmail: 'support@izenzo.co.za',
                idempotencyKey: `poi-support-desk-${matchId}`,
                templateData: {
                  matchId,
                  commodity: match.commodity,
                  creatorOrgName,
                  creatorEmail,
                  buyerName: match.buyer_name || match.buyer_id || '',
                  sellerName: match.seller_name || match.seller_id || '',
                  quantityAmount: match.quantity_amount?.toString() || '',
                  quantityUnit: match.quantity_unit || '',
                  priceAmount: match.price_amount?.toString() || '',
                  priceCurrency: match.price_currency || '',
                  issuedAt: now,
                },
              },
            });
          } else {
            // ── Route B: Known counterparty on platform ──
            console.log(`[${requestId}] POI notification: Route B (bilateral) — notifying counterparty`);

            const counterpartySide = match.buyer_org_id === creatorOrgId ? 'seller' : 'buyer';

            // 1. In-app: notify ALL users in counterparty org
            const { data: cpUsers } = await supabase
              .from("profiles")
              .select("id, email")
              .eq("org_id", counterpartyOrgId);

            if (cpUsers && cpUsers.length > 0) {
              const notifRows = cpUsers.map((u: any) => ({
                user_id: u.id,
                type: "poi_counterparty_notification",
                title: `POI issued: ${match.commodity || 'Trade'}`,
                body: `A Proof of Intent has been issued for ${match.commodity || 'a trade'} by ${creatorOrgName}. Your organisation is the ${counterpartySide}. Review and respond.`,
                link: `/desk/match/${matchId}`,
                org_id: counterpartyOrgId,
              }));
              await supabase.from("notifications").insert(notifRows);

              // 2. Email: send to all counterparty org users
              for (const u of cpUsers) {
                await supabase.functions.invoke('send-transactional-email', {
                  body: {
                    templateName: 'poi-counterparty-notify',
                    recipientEmail: u.email,
                    idempotencyKey: `poi-cp-notify-${matchId}-${u.id}`,
                    templateData: {
                      commodity: match.commodity,
                      creatorOrgName,
                      matchId,
                      side: counterpartySide,
                      issuedAt: now,
                    },
                  },
                });
              }
            }
          }

          // ── Revenue notification (Route B: clean bilateral on-platform mint) ──
          // Routes A and C already email support@izenzo.co.za via the
          // facilitation/support-desk template above. Route B was previously
          // silent to admins/finance — this restores parity so support sees
          // every revenue-bearing POI mint exactly once.
          if (!isUnilateral && hasCounterpartyOnPlatform) {
            const counterpartyName = match.buyer_org_id === creatorOrgId
              ? (match.seller_name || match.seller_id || 'Unknown')
              : (match.buyer_name || match.buyer_id || 'Unknown');
            await emitRevenueNotification(supabase, {
              eventType: 'poi_minted',
              idempotencyKey: `revenue-poi-mint-${matchId}`,
              referenceId: matchId,
              orgId: creatorOrgId,
              orgName: creatorOrgName,
              contactEmail: creatorEmail,
              headline: `POI minted by ${creatorOrgName} — ${match.commodity || 'Trade'}`,
              details: {
                Commodity: match.commodity || '—',
                Counterparty: counterpartyName,
                Quantity: match.quantity_amount
                  ? `${match.quantity_amount} ${match.quantity_unit || ''}`.trim()
                  : '—',
                Price: match.price_amount
                  ? `${match.price_currency || ''} ${match.price_amount}`.trim()
                  : '—',
                'Credits burned': 1,
                Route: 'Bilateral (both parties on platform)',
              },
              consoleUrl: `https://api.trade.izenzo.co.za/desk/match/${matchId}`,
              consoleLabel: 'Open match',
              occurredAt: now,
            });
          }
        } catch (notifErr) {
          // Never fail the POI response because notifications failed
          console.error(`[${requestId}] POI notification dispatch error:`, notifErr);
        }
      })();

      await logApiRequest({
        supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
        endpoint: endpointLabel, method: "POST", statusCode: 200,
      });

      // Cache successful response so any retry with the same Idempotency-Key
      // returns the SAME body verbatim (with X-Idempotent-Replay marker) for 24h.
      await storeIdempotentResponse(
        {
          supabase,
          orgId: authCtx.orgId,
          endpoint: idemEndpointLabel,
          idempotencyKey,
          requestId,
        },
        { status: 200, body: updated },
      );

      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // NOTE: declare-intent is now handled by the unified settle/declare-intent block above

    // ============================================
    // Route: POST /match/:id/reveal-counterparty
    // Transitions: intent_declared → counterparty_sighted
    // Token Cost: 1 credit (flat R10 pricing)
    // ============================================
    if (req.method === "POST" && matchId && action === "reveal-counterparty") {
      const endpointLabel = "/match/:id/reveal-counterparty";
      
      const uuidResult = uuidSchema.safeParse(matchId);
      if (!uuidResult.success) {
        throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);
      }

      console.log(`[${requestId}] POST /match/${matchId}/reveal-counterparty`);

      const { data: match, error: fetchError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .maybeSingle();

      if (fetchError) handleDatabaseError(fetchError, requestId);
      if (!match) throw new ApiException("NOT_FOUND", "Match not found", 404);
      if (!isMatchParty(match, authCtx.orgId)) throw new ApiException("FORBIDDEN", "You do not have permission to modify this match", 403);

      // UNILATERAL GUARD: Cannot reveal counterparty if one side is missing
      if (match.match_type === "unilateral" && (match.buyer_id == null || match.seller_id == null)) {
        console.error(`[${requestId}] SENTRY_BREADCRUMB: UNILATERAL_BLOCKED match_id=${matchId} org_id=${authCtx.orgId} missing_party=${match.buyer_id == null ? 'buyer' : 'seller'}`);
        throw new ApiException(
          "UNILATERAL_BLOCKED",
          "Cannot reveal counterparty on a unilateral intent. Both buyer and seller must be attached before proceeding.",
          422
        );
      }

      // Burn tokens BEFORE the atomic lock (token burn is itself atomic via atomic_token_burn)
      await burnTokensForAction(supabase, authCtx.orgId, actorApiKeyId, 'counterparty_sighting', requestId, matchId);

      // --- ATOMIC STATE TRANSITION (SELECT FOR UPDATE) ---
      const sightedAt = new Date().toISOString();
      const { data: transitionResult, error: transitionError } = await supabase.rpc(
        'safe_transition_match_state',
        {
          p_match_id: matchId,
          p_org_id: authCtx.orgId,
          p_expected_state: 'intent_declared',
          p_new_state: 'counterparty_sighted',
          p_update_fields: {
            counterparty_sighted_at: sightedAt,
            sighting_tokens_burned: ACTION_TOKEN_COSTS.counterparty_sighting,
          },
        }
      );

      if (transitionError) handleDatabaseError(transitionError, requestId);
      if (!transitionResult?.success) {
        const errCode = transitionResult?.error || 'TRANSITION_FAILED';
        const statusCode = errCode === 'STATE_CONFLICT' ? 409 : 400;
        // REFUND: tokens burned but transition lost the race
        try {
          await supabase.rpc('refund_tokens_on_conflict', {
            p_org_id: authCtx.orgId,
            p_amount: ACTION_TOKEN_COSTS.counterparty_sighting,
            p_match_id: matchId,
            p_reason: errCode,
            p_request_id: requestId,
            p_actor_user_id: actorUserId,
          });
          console.warn(`[${requestId}] REFUND: ${ACTION_TOKEN_COSTS.counterparty_sighting} tokens refunded after ${errCode} on reveal`);
        } catch (refundErr) {
          console.error(`[${requestId}] CRITICAL: Token refund failed on reveal. Match: ${matchId}, Org: ${authCtx.orgId}`, refundErr);
        }
        throw new ApiException(errCode, transitionResult?.message || 'State transition failed', statusCode);
      }

      const updated = transitionResult.match;

      await supabase.from("audit_logs").insert({
        org_id: match.org_id,
        actor_user_id: actorUserId,
        actor_api_key_id: actorApiKeyId,
        action: "counterparty.sighted",
        entity_type: "match",
        entity_id: matchId,
        metadata: {
          request_id: requestId,
          tokens_burned: ACTION_TOKEN_COSTS.counterparty_sighting,
          previous_state: 'intent_declared',
          new_state: 'counterparty_sighted',
          fields_revealed: ['seller_id', 'seller_name', 'buyer_id', 'buyer_name'],
        }
      });

      await recordMatchEvent(
        supabase, matchId, match.org_id, "counterparty.sighted",
        { tokensCharged: ACTION_TOKEN_COSTS.counterparty_sighting, state: 'counterparty_sighted' },
        actorUserId, actorApiKeyId
      );

      triggerWebhooks(supabase, match.org_id, "counterparty.sighted", {
        matchId, state: 'counterparty_sighted', tokensCharged: ACTION_TOKEN_COSTS.counterparty_sighting
      }).catch(err => console.error(`Webhook error:`, err));

      await logApiRequest({
        supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
        endpoint: endpointLabel, method: "POST", statusCode: 200
      });

      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ============================================
    // Route: POST /match/:id/commit
    // Transitions: counterparty_sighted → committed
    // Token Cost: 1 credit (flat R10 pricing)
    // ============================================
    if (req.method === "POST" && matchId && action === "commit") {
      const endpointLabel = "/match/:id/commit";
      
      const uuidResult = uuidSchema.safeParse(matchId);
      if (!uuidResult.success) {
        throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);
      }

      console.log(`[${requestId}] POST /match/${matchId}/commit`);

      const { data: match, error: fetchError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .maybeSingle();

      if (fetchError) handleDatabaseError(fetchError, requestId);
      if (!match) throw new ApiException("NOT_FOUND", "Match not found", 404);
      if (!isMatchParty(match, authCtx.orgId)) throw new ApiException("FORBIDDEN", "You do not have permission to modify this match", 403);

      // Flat 1-credit cost for commit (R10 pricing model)
      const commitCost = ACTION_TOKEN_COSTS.buyer_commit;
      await burnTokensForAction(supabase, authCtx.orgId, actorApiKeyId, 'buyer_commit', requestId, matchId);

      // --- ATOMIC STATE TRANSITION (SELECT FOR UPDATE) ---
      const committedAt = new Date().toISOString();
      const { data: transitionResult, error: transitionError } = await supabase.rpc(
        'safe_transition_match_state',
        {
          p_match_id: matchId,
          p_org_id: authCtx.orgId,
          p_expected_state: 'counterparty_sighted',
          p_new_state: 'committed',
          p_update_fields: {
            buyer_committed_at: committedAt,
          },
        }
      );

      if (transitionError) handleDatabaseError(transitionError, requestId);
      if (!transitionResult?.success) {
        const errCode = transitionResult?.error || 'TRANSITION_FAILED';
        const statusCode = errCode === 'STATE_CONFLICT' ? 409 : 400;
        try {
          await supabase.rpc('refund_tokens_on_conflict', {
            p_org_id: authCtx.orgId,
            p_amount: commitCost,
            p_match_id: matchId,
            p_reason: errCode,
            p_request_id: requestId,
            p_actor_user_id: actorUserId,
          });
          console.warn(`[${requestId}] REFUND: ${commitCost} tokens refunded after ${errCode} on commit`);
        } catch (refundErr) {
          console.error(`[${requestId}] CRITICAL: Token refund failed on commit. Match: ${matchId}, Org: ${authCtx.orgId}`, refundErr);
        }
        throw new ApiException(errCode, transitionResult?.message || 'State transition failed', statusCode);
      }

      const updated = transitionResult.match;

      await supabase.from("audit_logs").insert({
        org_id: match.org_id,
        actor_user_id: actorUserId,
        actor_api_key_id: actorApiKeyId,
        action: "transaction.committed",
        entity_type: "match",
        entity_id: matchId,
        metadata: {
          request_id: requestId,
          tokens_burned: commitCost,
          previous_state: 'counterparty_sighted',
          new_state: 'committed',
        }
      });

      await recordMatchEvent(
        supabase, matchId, match.org_id, "transaction.committed",
        { commitCost, state: 'committed' },
        actorUserId, actorApiKeyId
      );

      triggerWebhooks(supabase, match.org_id, "transaction.committed", {
        matchId, state: 'committed', commitTokens: commitCost,
      }).catch(err => console.error(`Webhook error:`, err));

      await logApiRequest({
        supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
        endpoint: endpointLabel, method: "POST", statusCode: 200
      });

      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ============================================
    // Route: POST /match/:id/complete
    // Transitions: committed → completed
    // Token Cost: 1 credit (flat R10 pricing)
    // ============================================
    if (req.method === "POST" && matchId && action === "complete") {
      const endpointLabel = "/match/:id/complete";
      
      const uuidResult = uuidSchema.safeParse(matchId);
      if (!uuidResult.success) {
        throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);
      }

      console.log(`[${requestId}] POST /match/${matchId}/complete`);

      const { data: match, error: fetchError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .maybeSingle();

      if (fetchError) handleDatabaseError(fetchError, requestId);
      if (!match) throw new ApiException("NOT_FOUND", "Match not found", 404);
      if (!isMatchParty(match, authCtx.orgId)) throw new ApiException("FORBIDDEN", "You do not have permission to modify this match", 403);

      // ── WaD GATE: require a sealed WaD before allowing completion ──
      const { data: sealedWad, error: wadError } = await supabase
        .from("wads")
        .select("id, status")
        .eq("poi_id", matchId)
        .eq("status", "sealed")
        .maybeSingle();

      if (wadError) {
        console.error(`[${requestId}] WaD check failed:`, wadError);
        handleDatabaseError(wadError, requestId);
      }

      if (!sealedWad) {
        throw new ApiException(
          "WAD_NOT_SEALED",
          "A sealed WaD (Without a Doubt) evidence bundle is required before completing a trade. Please complete the WaD step first.",
          422
        );
      }

      // Completion is free (0 credits) — burn call kept for audit trail consistency
      await burnTokensForAction(supabase, authCtx.orgId, actorApiKeyId, 'transaction_complete', requestId, matchId);

      // --- ATOMIC STATE TRANSITION ---
      const completedAt = new Date().toISOString();
      const { data: transitionResult, error: transitionError } = await supabase.rpc(
        'safe_transition_match_state',
        {
          p_match_id: matchId,
          p_org_id: authCtx.orgId,
          p_expected_state: 'committed',
          p_new_state: 'completed',
          p_update_fields: {},
        }
      );

      if (transitionError) handleDatabaseError(transitionError, requestId);
      if (!transitionResult?.success) {
        const errCode = transitionResult?.error || 'TRANSITION_FAILED';
        const statusCode = errCode === 'STATE_CONFLICT' ? 409 : 400;
        try {
          await supabase.rpc('refund_tokens_on_conflict', {
            p_org_id: authCtx.orgId,
            p_amount: ACTION_TOKEN_COSTS.transaction_complete,
            p_match_id: matchId,
            p_reason: errCode,
            p_request_id: requestId,
            p_actor_user_id: actorUserId,
          });
          console.warn(`[${requestId}] REFUND: tokens refunded after ${errCode} on complete`);
        } catch (refundErr) {
          console.error(`[${requestId}] CRITICAL: Token refund failed on complete. Match: ${matchId}, Org: ${authCtx.orgId}`, refundErr);
        }
        throw new ApiException(errCode, transitionResult?.message || 'State transition failed', statusCode);
      }

      const updated = transitionResult.match;

      await supabase.from("audit_logs").insert({
        org_id: match.org_id,
        actor_user_id: actorUserId,
        actor_api_key_id: actorApiKeyId,
        action: "transaction.completed",
        entity_type: "match",
        entity_id: matchId,
        metadata: {
          request_id: requestId,
          previous_state: 'committed',
          new_state: 'completed',
          completed_at: completedAt,
        }
      });

      await recordMatchEvent(
        supabase, matchId, match.org_id, "transaction.completed",
        { state: 'completed', completedAt },
        actorUserId, actorApiKeyId
      );

      triggerWebhooks(supabase, match.org_id, "transaction.completed", {
        matchId, state: 'completed', completedAt,
      }).catch(err => console.error(`Webhook error:`, err));

      await logApiRequest({
        supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
        endpoint: endpointLabel, method: "POST", statusCode: 200
      });

      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }


    if (req.method === "GET" && matchId && !action) {
      // Validate matchId is a valid UUID
      const uuidResult = uuidSchema.safeParse(matchId);
      if (!uuidResult.success) {
        throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);
      }

      console.log(`[${requestId}] GET /match/${matchId}`);

      const { data: match, error } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .maybeSingle();

      if (error) handleDatabaseError(error, requestId);
      if (!match) {
        throw new ApiException("NOT_FOUND", "Match not found", 404);
      }

      // Verify match belongs to authenticated user's organisation
      if (!isMatchParty(match, authCtx.orgId)) {
        throw new ApiException(
          "FORBIDDEN", 
          "You do not have permission to access this match", 
          403
        );
      }

      return new Response(JSON.stringify(match), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Route: GET /matches (list)
    if (req.method === "GET" && !matchId) {
      console.log(`[${requestId}] GET /matches`);

      const limit = parseInt(url.searchParams.get("limit") || "50");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const status = url.searchParams.get("status");
      const commodity = url.searchParams.get("commodity");
      const commodityType = url.searchParams.get("commodity_type");

      let query = supabase
        .from("matches")
        .select("*", { count: "exact" })
        .or(`org_id.eq.${authCtx.orgId},buyer_org_id.eq.${authCtx.orgId},seller_org_id.eq.${authCtx.orgId}`)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (status && (status === "matched" || status === "settled")) {
        query = query.eq("status", status);
      }

      // SECURITY: Validate and sanitize commodity search parameter
      // Only allow alphanumeric, spaces, hyphens, periods, and commas
      if (commodity) {
        const sanitizedCommodity = commodity.slice(0, 200);
        const commodityPattern = /^[a-zA-Z0-9\s\-\.,]+$/;
        if (!commodityPattern.test(sanitizedCommodity)) {
          throw new ApiException(
            "VALIDATION_ERROR", 
            "Commodity search contains invalid characters", 
            400
          );
        }
        query = query.ilike("commodity", `%${sanitizedCommodity}%`);
      }

      if (commodityType) {
        query = query.contains("metadata", { commodity_type: commodityType });
      }

      const { data: matches, error, count } = await query;

      if (error) handleDatabaseError(error, requestId);

      return new Response(
        JSON.stringify({ items: matches || [], totalCount: count || 0 }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // Route: POST /match (create new match)
    if (req.method === "POST" && !matchId) {
      console.log(`[${requestId}] POST /match`);

      // Check body size to prevent DoS attacks
      const contentLength = req.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
        throw new ApiException("PAYLOAD_TOO_LARGE", "Request body exceeds maximum size of 1MB", 413);
      }

      // Require idempotency key (prevents duplicate match creation on retry/double-click)
      const idempotencyKey = req.headers.get("idempotency-key");
      if (!idempotencyKey) {
        throw new ApiException("VALIDATION_ERROR", "Idempotency-Key header is required", 400);
      }

      {
        // Check if this idempotency key was already processed
        const { data: existingKey, error: keyError } = await supabase
          .from("idempotency_keys")
          .select("*")
          .eq("org_id", authCtx.orgId)
          .eq("idempotency_key", idempotencyKey)
          .eq("endpoint", "POST /match")
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();

        if (keyError) {
          console.error(`[${requestId}] Error checking idempotency key:`, keyError);
        }

        if (existingKey) {
          console.log(`[${requestId}] Returning cached response for idempotency key`);
          return new Response(JSON.stringify(existingKey.response_data), {
            status: existingKey.response_status_code,
            headers: { ...headers, "Content-Type": "application/json", "X-Idempotent-Replay": "true" },
          });
        }
      }

      const rawBody = await req.json();
      
      // Validate input with zod schema
      let body;
      try {
        body = validateInput(matchSchema, rawBody);
      } catch (error) {
        throw new ApiException(
          "VALIDATION_ERROR",
          error instanceof Error ? error.message : "Invalid input",
          400
        );
      }

      // FIX #2: Validate match_type against allowlist - prevent injection of arbitrary types
      const ALLOWED_MATCH_TYPES = ["search", "bilateral", "unilateral"];
      const rawMatchType = body.match_type || "search";
      if (!ALLOWED_MATCH_TYPES.includes(rawMatchType)) {
        throw new ApiException(
          "VALIDATION_ERROR",
          `Invalid match_type: "${rawMatchType}". Must be one of: ${ALLOWED_MATCH_TYPES.join(", ")}`,
          400
        );
      }

      // FIX #2b: Cross-validate match_type against payload shape
      if (rawMatchType === "unilateral") {
        const hasBuyer = body.buyer?.id != null;
        const hasSeller = body.seller?.id != null;
        if (hasBuyer && hasSeller) {
          throw new ApiException(
            "VALIDATION_ERROR",
            "Unilateral intent must have exactly one party (buyer OR seller), not both. Use 'bilateral' or 'search' instead.",
            400
          );
        }
        if (!hasBuyer && !hasSeller) {
          throw new ApiException(
            "VALIDATION_ERROR",
            "Unilateral intent must have at least one party (buyer or seller).",
            400
          );
        }
      }

      const matchType = rawMatchType;

      // Build canonical JSON for hashing – only stable business fields.
      const canonical = {
        buyer_id: body.buyer?.id || "__no_buyer__",
        seller_id: body.seller?.id || "__no_seller__",
        commodity: (body.commodity || "").trim().toLowerCase(),
      };

      // Compute SHA-256 hash
      const canonicalString = JSON.stringify(canonical);
      const encoder = new TextEncoder();
      const data = encoder.encode(canonicalString);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

      // Check for hash collision (duplicate match detection)
      const { data: existingMatch, error: hashCheckError } = await supabase
        .from("matches")
        .select("*")
        .eq("org_id", authCtx.orgId)
        .eq("hash", hash)
        .maybeSingle();

      if (hashCheckError) {
        console.error(`[${requestId}] Error checking hash collision:`, hashCheckError);
      }

      if (existingMatch) {
        console.log(`[${requestId}] Hash collision detected - returning existing match`);
        
        // Store idempotency key if provided
        if (idempotencyKey) {
          try {
            await supabase.from("idempotency_keys").insert({
              org_id: authCtx.orgId,
              idempotency_key: idempotencyKey,
              endpoint: "POST /match",
              request_hash: hash,
              response_data: existingMatch,
              response_status_code: 200,
            });
          } catch (keyError) {
            console.error(`[${requestId}] Failed to store idempotency key:`, keyError);
          }
        }

        return new Response(JSON.stringify(existingMatch), {
          status: 200,
          headers: { ...headers, "Content-Type": "application/json", "X-Match-Duplicate": "true" },
        });
      }

      // Insert match - buyer/seller can be null for unilateral intents
      const matchMetadata = body.metadata || {};

      // ── Resolve buyer_org_id / seller_org_id ──
      // If buyer.org_id or seller.org_id is explicitly provided, validate it's a real UUID
      // and verify the org exists before writing it as a canonical org reference.
      // This ensures known platform orgs get proper RLS visibility and notification routing.
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      let buyerOrgId: string | null = null;
      let sellerOrgId: string | null = null;

      // Check explicit org_id fields first (preferred), then fall back to id if it's a valid UUID
      const rawBuyerOrgId = body.buyer?.org_id || body.buyer?.id || null;
      const rawSellerOrgId = body.seller?.org_id || body.seller?.id || null;

      if (rawBuyerOrgId && uuidRegex.test(rawBuyerOrgId)) {
        const { data: buyerOrg } = await supabase
          .from("organizations")
          .select("id")
          .eq("id", rawBuyerOrgId)
          .maybeSingle();
        if (buyerOrg) buyerOrgId = buyerOrg.id;
      }

      if (rawSellerOrgId && uuidRegex.test(rawSellerOrgId)) {
        const { data: sellerOrg } = await supabase
          .from("organizations")
          .select("id")
          .eq("id", rawSellerOrgId)
          .maybeSingle();
        if (sellerOrg) sellerOrgId = sellerOrg.id;
      }

      console.log(`[${requestId}] Resolved org IDs: buyer_org_id=${buyerOrgId || 'null'}, seller_org_id=${sellerOrgId || 'null'}`);

      const insertPayload: Record<string, unknown> = {
          org_id: authCtx.orgId,
          created_by: getCreatedBy(authCtx),
          buyer_id: body.buyer?.id ?? null,
          buyer_name: body.buyer?.name ?? null,
          buyer_org_id: buyerOrgId,
          seller_id: body.seller?.id ?? null,
          seller_name: body.seller?.name ?? null,
          seller_org_id: sellerOrgId,
          commodity: body.commodity,
          quantity_amount: body.quantity?.amount ?? null,
          quantity_unit: body.quantity?.unit ?? null,
          price_amount: body.price?.amount ?? null,
          price_currency: body.price?.currency ?? null,
          terms: body.terms ?? null,
          metadata: matchMetadata,
          match_type: matchType,
          hash,
          status: "matched",
          origin_country: body.origin_country ?? matchMetadata.origin_jurisdiction ?? null,
          destination_country: body.destination_country ?? matchMetadata.destination_jurisdiction ?? null,
      };

      // Link to parent trade_request if provided
      if (body.trade_request_id) {
        insertPayload.trade_request_id = body.trade_request_id;
      }

      const { data: match, error: insertError } = await supabase
        .from("matches")
        .insert(insertPayload)
        .select()
        .single();

      if (insertError) handleDatabaseError(insertError, requestId);

      // Create audit log for match creation (immutable trade request)
      try {
        await supabase.from("audit_logs").insert({
          org_id: authCtx.orgId,
          actor_user_id: actorUserId,
          actor_api_key_id: actorApiKeyId,
          action: "match.created",
          entity_type: "match",
          entity_id: match.id,
          metadata: {
            hash,
            buyer_id: body.buyer?.id ?? null,
            buyer_name: body.buyer?.name ?? null,
            seller_id: body.seller?.id ?? null,
            seller_name: body.seller?.name ?? null,
            commodity: body.commodity,
            quantity_amount: body.quantity?.amount ?? null,
            quantity_unit: body.quantity?.unit ?? null,
            price_amount: body.price?.amount ?? null,
            price_currency: body.price?.currency ?? null,
            terms: body.terms ?? null,
            match_type: matchType,
            canonical_string: canonicalString
          }
        });
        console.log(`[${requestId}] Audit log created for match with hash: ${hash}`);

        // Record event in hash-chained timeline
        await recordMatchEvent(
          supabase,
          match.id,
          authCtx.orgId,
          "match.created",
          {
            buyer: body.buyer,
            seller: body.seller,
            commodity: body.commodity,
            quantity: body.quantity,
            price: body.price,
            terms: body.terms,
            hash,
          },
          actorUserId,
          actorApiKeyId
        );
      } catch (auditError) {
        console.error(`[${requestId}] Failed to create audit log:`, auditError);
        // Critical: audit log creation failure should fail the request
        throw new ApiException("AUDIT_LOG_ERROR", "Failed to create audit trail", 500);
      }

      // Store idempotency key if provided (non-blocking)
      if (idempotencyKey) {
        try {
          await supabase.from("idempotency_keys").insert({
            org_id: authCtx.orgId,
            idempotency_key: idempotencyKey,
            endpoint: "POST /match",
            request_hash: hash,
            response_data: match,
            response_status_code: 201,
          });
        } catch (keyError) {
          console.error(`[${requestId}] Failed to store idempotency key:`, keyError);
        }
      }

      console.log(`[${requestId}] Match created: ${match.id}`);
      
      // Trigger webhooks in background
      triggerWebhooks(supabase, authCtx.orgId, "match.created", {
        matchId: match.id,
        commodity: body.commodity,
        buyer: body.buyer,
        seller: body.seller,
        quantity: body.quantity,
        price: body.price,
        hash,
      }).catch(err => console.error(`Webhook trigger error:`, err));

      return new Response(JSON.stringify(match), {
        status: 201,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── PATCH /match - Sign & Bind Deal (convert unilateral → bilateral) ──
    if (req.method === "PATCH") {
      const body = await req.json();
      const { matchId: patchMatchId, action: patchAction, counterparty, expected_state } = body;

      if (patchAction !== "accept-bind") {
        throw new ApiException("VALIDATION_ERROR", "Unknown PATCH action", 400);
      }

      const matchUuid = uuidSchema.safeParse(patchMatchId);
      if (!matchUuid.success) {
        throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);
      }

      if (!counterparty?.org_id || !counterparty?.role || !counterparty?.name) {
        throw new ApiException("VALIDATION_ERROR", "counterparty.org_id, role, and name are required", 400);
      }

      if (!["buyer", "seller"].includes(counterparty.role)) {
        throw new ApiException("VALIDATION_ERROR", "counterparty.role must be buyer or seller", 400);
      }

      console.log(`[${requestId}] PATCH accept-bind for match ${patchMatchId}`);

      // Atomic lock-check-bind via database function (prevents race conditions)
      const { data: bindResult, error: bindErr } = await supabase.rpc("atomic_accept_bind", {
        p_match_id: patchMatchId,
        p_counterparty_org_id: counterparty.org_id,
        p_counterparty_role: counterparty.role,
        p_counterparty_name: counterparty.name,
        p_caller_org_id: authCtx.orgId,
      });

      if (bindErr) handleDatabaseError(bindErr, requestId);

      if (!bindResult?.success) {
        const errorMap: Record<string, number> = {
          NOT_FOUND: 404,
          INVALID_TYPE: 400,
          SELF_BIND: 403,
          INVALID_ROLE: 400,
          SLOT_TAKEN: 409,
        };
        throw new ApiException(
          bindResult?.error || "BIND_FAILED",
          bindResult?.message || "Failed to bind trading partner",
          errorMap[bindResult?.error] || 500
        );
      }

      const updatedMatch = bindResult.match;

      // Fetch the original match for webhook org_id context
      const existingMatch = { org_id: updatedMatch.org_id };

      // Record the event in the hash chain
      await recordMatchEvent(
        supabase,
        patchMatchId,
        authCtx.orgId,
        "counterparty.bound",
        {
          bound_org_id: counterparty.org_id,
          bound_name: counterparty.name,
          bound_role: counterparty.role,
          previous_match_type: "unilateral",
          new_match_type: "bilateral",
        },
        actorUserId,
        actorApiKeyId
      );

      // Audit log
      const { error: auditErr } = await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: actorUserId,
        actor_api_key_id: actorApiKeyId,
        action: "match.accept_bind",
        entity_type: "match",
        entity_id: patchMatchId,
        metadata: {
          bound_org_id: counterparty.org_id,
          bound_role: counterparty.role,
          request_id: requestId,
        },
      });

      if (auditErr) {
        console.error(`[${requestId}] AUDIT_LOG_ERROR:`, auditErr);
        throw new ApiException("AUDIT_LOG_ERROR", "Failed to record audit trail", 500);
      }

      // Trigger webhooks
      triggerWebhooks(supabase, existingMatch.org_id, "match.counterparty_bound", {
        matchId: patchMatchId,
        boundOrgId: counterparty.org_id,
        boundRole: counterparty.role,
      }).catch(err => console.error(`Webhook trigger error:`, err));

      await logApiRequest({
        supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
        endpoint: "PATCH /match (accept-bind)", method: "PATCH", statusCode: 200,
      });

      return new Response(JSON.stringify(updatedMatch), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Method not allowed
    throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);

  } catch (error) {
    return errorResponse(error instanceof Error ? error : new Error("Unknown error"), requestId, headers);
  }
});