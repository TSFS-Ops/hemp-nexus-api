import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { PDFDocument, StandardFonts, rgb, grayscale } from "https://esm.sh/pdf-lib@1.17.1";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { validateInput } from "../_shared/validation.ts";
import { tryBypass } from "../_shared/test-mode-bypass.ts";
import { decideIdempotency, hashAttestBody } from "../_shared/idempotency.ts";
import { computeETag, ifNoneMatchMatches, notModifiedResponse } from "../_shared/etag.ts";
import { cacheHeaders } from "../_shared/cache.ts";
import { safePdfText } from "../_shared/pdf-sanitizer.ts";
import { emitRevenueNotification } from "../_shared/revenue-notify.ts";
import { assertEngagementAllowsProgression } from "../_shared/engagement-progression-guard.ts";
import { assertNoOpenChallenge, challengeOpenResponse } from "../_shared/challenge-progression-guard.ts";
import {
  assertMatchProgressable,
  buildProgressionGuardResponse,
} from "../_shared/match-progression-guard.ts";

type BypassedGateRecord = {
  gate: "screening_recentness" | "risk_scoring" | "webhook_connectivity";
  org_id?: string | null;
  detail: Record<string, unknown>;
};

const ATTESTATION_TEXT = "I confirm this is not a contract. No payment. No obligation. This is a record that intent was confirmed.";

// Validation schemas
const wadCreateSchema = z.object({
  poi_id: z.string().uuid(),
});

const attestSchema = z.object({
  attested_name: z.string().trim().min(1).max(200),
  role: z.enum(["buyer_signatory", "seller_signatory", "witness", "admin"]),
});

const revokeSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

// Generate deterministic hash of payload
async function generateHash(payload: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Build canonical payload for hashing
function buildCanonicalPayload(wad: any, attestations: any[], documents: any[]): object {
  return {
    wad_id: wad.id,
    poi_id: wad.poi_id,
    parties: {
      buyer_org_id: wad.buyer_org_id,
      seller_org_id: wad.seller_org_id,
    },
    attestations: attestations.map(a => ({
      user_id: a.user_id,
      org_id: a.org_id,
      role: a.role,
      attested_name: a.attested_name,
      attested_at: a.attested_at,
    })),
    documents: documents.map(d => ({
      id: d.id,
      sha256_hash: d.sha256_hash,
      doc_type: d.doc_type,
    })),
    evidence_bundle: wad.evidence_bundle,
    created_at: wad.created_at,
  };
}

// Check if user has platform_admin role
function isAdmin(authCtx: { roles: string[] }): boolean {
  return authCtx.roles.includes("platform_admin");
}

// Check if user is a party to the WaD
function isPartyToWad(wad: any, orgId: string): boolean {
  return wad.org_id === orgId || wad.buyer_org_id === orgId || wad.seller_org_id === orgId;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const url = new URL(req.url);
    const rawParts = url.pathname.split("/").filter(Boolean);
    
    // Normalize path
    const parts = [...rawParts];
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "wad") parts.shift();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    const { actorUserId, actorApiKeyId } = deriveActorIds(authCtx);
    
    await checkRateLimit(supabase, authCtx.orgId, authCtx.isApiKey ? authCtx.userId : null, "wad", "wad");

    console.log(`[${requestId}] ${req.method} /wad${parts.length ? "/" + parts.join("/") : ""} org:${authCtx.orgId}`);

    // Helper: write audit log
    const writeAuditLog = async (action: string, entityId: string, metadata: Record<string, unknown> = {}) => {
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: actorUserId,
        actor_api_key_id: actorApiKeyId,
        action,
        entity_type: "wad",
        entity_id: entityId,
        metadata: { ...metadata, request_id: requestId },
      });
    };

    // ── POST /wad ── Create WaD from POI
    if (req.method === "POST" && parts.length === 0) {
      const body = await req.json();
      const { poi_id } = validateInput(wadCreateSchema, body);

      // Fetch POI (match) data
      const { data: poi, error: poiError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", poi_id)
        .single();

      if (poiError || !poi) {
        throw new ApiException("NOT_FOUND", "POI not found", 404);
      }

      const userOrgId = authCtx.orgId;
      const partyCheck = poi.org_id === userOrgId || poi.buyer_org_id === userOrgId || poi.seller_org_id === userOrgId;
      if (!partyCheck && !isAdmin(authCtx)) {
        throw new ApiException("FORBIDDEN", "Not authorised to create WaD for this intent", 403);
      }

      if (poi.status !== "settled") {
        throw new ApiException("VALIDATION_ERROR", "POI must be confirmed before creating WaD", 400);
      }

      // ── Batch I Fix 3: assert POI state is compatible for WaD issuance ──
      // WaD requires status='settled' AND poi_state in a closed allow-list.
      // Terminal failure / disputed / cancelled / annulled states MUST reject
      // with a typed POI_STATE_INCOMPATIBLE error so callers and the admin UI
      // can distinguish a state-machine mismatch from a generic gate failure.
      const COMPATIBLE_POI_STATES = new Set<string>([
        "COMPLETED",
        "COMPLETION_REQUESTED",
        "ELIGIBLE",
      ]);
      if (!COMPATIBLE_POI_STATES.has(poi.poi_state)) {
        throw new ApiException(
          "POI_STATE_INCOMPATIBLE",
          `WaD cannot be created against POI in state '${poi.poi_state}'. Compatible states: ${[...COMPATIBLE_POI_STATES].join(", ")}.`,
          422,
          { poi_id, poi_state: poi.poi_state, compatible_states: [...COMPATIBLE_POI_STATES] },
        );
      }
      // ── Hard-gate: Intent state must be COMPLETED before WaD ──
      if (poi.poi_state !== "COMPLETED") {
        throw new ApiException("HARD_GATE_FAILED", `Intent state must be COMPLETED, currently: ${poi.poi_state}`, 422);
      }

      // ── Hard-gate: Counterparty engagement must be accepted (Batch B Phase 4) ──
      // Use the canonical progression guard so a historical accepted row
      // does NOT pass when a renewed `notification_sent` / `contacted` /
      // `late_acceptance_pending_initiator_reconfirmation` child is the
      // current engagement. The previous query (`.in("engagement_status",
      // ["accepted"]).limit(1).maybeSingle()`) would happily pick up a
      // stale accepted row even if a renewed pending child existed; that
      // is unsafe once Phase 2 allows multiple rows per match.
      {
        // Batch C Phase 3A: WaD create blocked while a challenge is open.
        const matchIdForGuard =
          (poi as { match_id?: string | null }).match_id || poi.id;

        // ── MT-008 / MT-009 server-side progression guard (WaD create) ──
        {
          const mtDecision = await assertMatchProgressable({
            supabase,
            matchId: matchIdForGuard,
            action: "wad",
            sourceFunction: "wad:create",
            actorUserId: authCtx.userId ?? null,
            actorOrgId: authCtx.orgId ?? null,
          });
          const blocked = buildProgressionGuardResponse(mtDecision);
          if (blocked) return blocked;
        }

        const challengeDecision = await assertNoOpenChallenge(supabase, matchIdForGuard);
        if (!challengeDecision.allowed) {
          throw new ApiException(
            "CHALLENGE_OPEN",
            challengeDecision.message ?? "Progression paused.",
            409,
            {
              challenge_id: challengeDecision.challengeId,
              challenge_status: challengeDecision.challengeStatus,
              raised_at: challengeDecision.raisedAt,
            },
          );
        }

        const decision = await assertEngagementAllowsProgression(supabase, poi_id);
        if (!decision.allowed) {
          throw new ApiException(
            decision.code!,
            decision.message ?? "Counterparty engagement is not accepted. WaD cannot be issued.",
            422,
            {
              current_engagement_status: decision.currentStatus,
              has_historical_engagement: decision.hasHistorical,
            },
          );
        }
      }

      // ── Hard-gate: Screening recentness (within 30 days) + risk_band checks ──
      // These can be bypassed in test mode (master switch + per-gate flag) so the
      // workflow can be exercised end-to-end while real providers are pending.
      // Every bypass is audited and stamped onto the WaD's metadata.
      const bypassedGates: BypassedGateRecord[] = [];
      const partyOrgIds = [poi.buyer_org_id, poi.seller_org_id].filter(Boolean);
      for (const partyOrgId of partyOrgIds) {
        // Check latest screening is within 30 days
        const { data: latestScreening } = await supabase
          .from("screening_results")
          .select("status, screened_at")
          .eq("org_id", partyOrgId)
          .order("screened_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!latestScreening) {
          // Treat "no screening at all" as a recentness failure for bypass purposes —
          // sanctions screening is the upstream provider; the recentness flag is
          // what governs whether WaD will accept a missing/stale row.
          const bypassed = await tryBypass(supabase, {
            gate: "screening_recentness",
            source: "wad",
            orgId: partyOrgId,
            actorUserId,
            requestId,
            details: { poi_id, reason: "no_screening_results_for_org" },
          });
          if (bypassed) {
            bypassedGates.push({
              gate: "screening_recentness",
              org_id: partyOrgId,
              detail: { reason: "no_screening_results_for_org" },
            });
            continue; // skip the rest of this org's screening checks
          }
          throw new ApiException("HARD_GATE_FAILED", `No screening results found for org ${partyOrgId}. WaD denied.`, 422);
        }

        const screenedAt = new Date(latestScreening.screened_at);
        const daysSinceScreening = (Date.now() - screenedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceScreening > 30) {
          const bypassed = await tryBypass(supabase, {
            gate: "screening_recentness",
            source: "wad",
            orgId: partyOrgId,
            actorUserId,
            requestId,
            details: { poi_id, days_since_screening: Math.floor(daysSinceScreening) },
          });
          if (bypassed) {
            bypassedGates.push({
              gate: "screening_recentness",
              org_id: partyOrgId,
              detail: { days_since_screening: Math.floor(daysSinceScreening) },
            });
          } else {
            throw new ApiException(
              "HARD_GATE_FAILED",
              `Screening for org ${partyOrgId} is ${Math.floor(daysSinceScreening)} days old. Must be rescreened within 30 days. WaD denied.`,
              422
            );
          }
        }

        if (latestScreening.status !== "clear") {
          // Status-not-clear is a sanctions-screening result, not a recentness issue —
          // honour the existing "sanctions" gate to decide whether to wave it through.
          const bypassed = await tryBypass(supabase, {
            gate: "sanctions",
            source: "wad",
            orgId: partyOrgId,
            actorUserId,
            requestId,
            details: { poi_id, screening_status: latestScreening.status },
          });
          if (bypassed) {
            bypassedGates.push({
              gate: "screening_recentness", // recorded under the recentness banner for the WaD stamp
              org_id: partyOrgId,
              detail: { reason: "screening_status_not_clear", actual_status: latestScreening.status },
            });
          } else {
            throw new ApiException("HARD_GATE_FAILED", `Screening status for org ${partyOrgId} is '${latestScreening.status}', not 'clear'. WaD denied.`, 422);
          }
        }

        // Check risk_band is not 'critical' or 'high'
        const { data: riskScore } = await supabase
          .from("dd_risk_scores")
          .select("risk_band, score")
          .eq("org_id", partyOrgId)
          .order("computed_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (riskScore && ["critical", "high"].includes(riskScore.risk_band)) {
          const bypassed = await tryBypass(supabase, {
            gate: "risk_scoring",
            source: "wad",
            orgId: partyOrgId,
            actorUserId,
            requestId,
            details: { poi_id, risk_band: riskScore.risk_band, score: riskScore.score },
          });
          if (bypassed) {
            bypassedGates.push({
              gate: "risk_scoring",
              org_id: partyOrgId,
              detail: { risk_band: riskScore.risk_band, score: riskScore.score },
            });
          } else {
            throw new ApiException(
              "HARD_GATE_FAILED",
              `Risk band for org ${partyOrgId} is '${riskScore.risk_band}' (score: ${riskScore.score}). WaD denied.`,
              422
            );
          }
        }
      }

      // ── Hard-gate 10: WEBHOOK_CONNECTIVITY ──
      // A trade cannot certify (or settle) if a participant cannot receive the proof.
      // Block when EITHER party has a PRIMARY webhook endpoint that has been
      // auto-disabled by the circuit breaker (status='inactive' AND disabled_at NOT NULL).
      const { data: brokenWebhooks, error: brokenWhErr } = await supabase
        .from("webhook_endpoints")
        .select("id, org_id, url, disabled_at, consecutive_failures")
        .in("org_id", partyOrgIds)
        .eq("is_primary", true)
        .eq("status", "inactive")
        .not("disabled_at", "is", null);

      if (brokenWhErr) {
        throw new ApiException(
          "INTERNAL_ERROR",
          "Failed to verify webhook connectivity for WaD Gate 10",
          500,
          { detail: brokenWhErr.message }
        );
      }

      if (brokenWebhooks && brokenWebhooks.length > 0) {
        const offenders = brokenWebhooks.map((e) => ({
          endpoint_id: e.id,
          org_id: e.org_id,
          role: e.org_id === poi.buyer_org_id ? "buyer" : e.org_id === poi.seller_org_id ? "seller" : "party",
          disabled_at: e.disabled_at,
          consecutive_failures: e.consecutive_failures,
        }));

        const bypassed = await tryBypass(supabase, {
          gate: "webhook_connectivity",
          source: "wad",
          orgId: poi.org_id,
          actorUserId,
          requestId,
          details: { poi_id, broken_endpoints: offenders },
        });

        if (bypassed) {
          console.warn(`[WaD Gate 10 BYPASSED] WEBHOOK_CONNECTIVITY skipped under test mode`, JSON.stringify(offenders));
          bypassedGates.push({
            gate: "webhook_connectivity",
            org_id: null,
            detail: { broken_endpoints: offenders },
          });
        } else {
          console.warn(`[WaD Gate 10 FAIL] WEBHOOK_CONNECTIVITY_BROKEN`, JSON.stringify(offenders));
          throw new ApiException(
            "HARD_GATE_FAILED",
            "WaD Gate 10 Failure: WEBHOOK_CONNECTIVITY_BROKEN. One or more participants have a disabled primary webhook endpoint. Resolve at /developer/webhooks before re-issuing.",
            422,
            { gate: "WEBHOOK_CONNECTIVITY", broken_endpoints: offenders }
          );
        }
      }

      // Check if active WaD already exists
      const { data: existingWad } = await supabase
        .from("wads")
        .select("id, status")
        .eq("poi_id", poi_id)
        .neq("status", "revoked")
        .neq("status", "superseded")
        .maybeSingle();

      if (existingWad) {
        throw new ApiException("CONFLICT", "Active WaD already exists for this intent", 409);
      }

      // Fetch documents + events in parallel
      const [docsResult, eventsResult] = await Promise.all([
        supabase
          .from("match_documents")
          .select("id, sha256_hash, doc_type, filename, title, status")
          .eq("match_id", poi_id)
          .neq("status", "revoked"),
        supabase
          .from("match_events")
          .select("*")
          .eq("match_id", poi_id)
          .order("created_at", { ascending: true }),
      ]);

      const documents = docsResult.data || [];
      const events = eventsResult.data || [];

      // Build evidence bundle
      const evidenceBundle = {
        poi_snapshot: {
          id: poi.id,
          hash: poi.hash,
          commodity: poi.commodity,
          quantity: { amount: poi.quantity_amount, unit: poi.quantity_unit },
          price: { amount: poi.price_amount, currency: poi.price_currency },
          terms: poi.terms,
          buyer: { id: poi.buyer_id, name: poi.buyer_name, org_id: poi.buyer_org_id },
          seller: { id: poi.seller_id, name: poi.seller_name, org_id: poi.seller_org_id },
          created_at: poi.created_at,
          settled_at: poi.settled_at,
        },
        documents: documents.map(d => ({
          id: d.id,
          sha256_hash: d.sha256_hash,
          doc_type: d.doc_type,
          title: d.title || d.filename,
          status: d.status,
        })),
        event_count: events.length,
        event_hashes: events.map(e => e.payload_hash),
        // ── Forensic memory: which hard-gates were bypassed under test mode ──
        // Stamped INSIDE evidence_bundle so it gets hashed into the seal — this
        // makes the bypass record cryptographically bound to the WaD and visible
        // in the certificate PDF + evidence pack viewer. Empty array when no
        // bypass fired (the normal/production path).
        test_mode: {
          issued_under_test_mode: bypassedGates.length > 0,
          bypassed_gates: bypassedGates,
          bypassed_at: bypassedGates.length > 0 ? new Date().toISOString() : null,
        },
      };

      // Get previous ledger entry hash
      const { data: prevWad } = await supabase
        .from("wads")
        .select("ledger_entry_hash")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .insert({
          poi_id,
          org_id: poi.org_id,
          buyer_org_id: poi.buyer_org_id,
          seller_org_id: poi.seller_org_id,
          evidence_bundle: evidenceBundle,
          canonical_payload_json: {},
          prev_ledger_entry_hash: prevWad?.ledger_entry_hash || null,
          created_by: actorUserId,
        })
        .select()
        .single();

      if (wadError) handleDatabaseError(wadError, requestId);

      await writeAuditLog("wad.created", wad.id, {
        poi_id,
        issued_under_test_mode: bypassedGates.length > 0,
        bypassed_gates: bypassedGates.map((b) => b.gate),
      });

      return new Response(JSON.stringify(wad), {
        status: 201,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── GET /wad/:wadId ── Get WaD details
    if (req.method === "GET" && parts.length === 1) {
      const wadId = parts[0];

      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .select("*")
        .eq("id", wadId)
        .single();

      if (wadError || !wad) {
        throw new ApiException("NOT_FOUND", "WaD not found", 404);
      }

      if (!isPartyToWad(wad, authCtx.orgId) && !isAdmin(authCtx)) {
        throw new ApiException("FORBIDDEN", "Not authorised to view this WaD", 403);
      }

      // Log admin access
      if (isAdmin(authCtx) && !isPartyToWad(wad, authCtx.orgId)) {
        await writeAuditLog("admin.wad.accessed", wadId);
      }

      const { data: attestations } = await supabase
        .from("wad_attestations")
        .select("*")
        .eq("wad_id", wadId)
        .order("attested_at", { ascending: true });

      return new Response(JSON.stringify({ ...wad, attestations: attestations || [] }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── GET /wad/:wadId/attestation-ui ──
    // Returns the status-specific attestation UI model the client should render
    // (canAttest, buttonText, helperText, etc.) plus per-side and viewer-specific
    // attested_at timestamps. Mirrors the logic in src/components/wad/WadStepper
    // so non-web clients (CLI, partner integrations) get the same wording and
    // timestamps without re-implementing the rules.
    if (req.method === "GET" && parts.length === 2 && parts[1] === "attestation-ui") {
      const wadId = parts[0];

      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .select("id, status, buyer_org_id, seller_org_id, sealed_at, revoked_reason")
        .eq("id", wadId)
        .single();

      if (wadError || !wad) {
        throw new ApiException("NOT_FOUND", "WaD not found", 404);
      }

      if (!isPartyToWad(wad, authCtx.orgId) && !isAdmin(authCtx)) {
        throw new ApiException("FORBIDDEN", "Not authorised to view this WaD", 403);
      }

      const { data: attestations } = await supabase
        .from("wad_attestations")
        .select("user_id, org_id, role, attested_at")
        .eq("wad_id", wadId)
        .order("attested_at", { ascending: true });

      const list = attestations || [];

      // Earliest attestation per side wins (ordered ASC above).
      const buyerAttestation = list.find((a) => a.role === "buyer_signatory");
      const sellerAttestation = list.find((a) => a.role === "seller_signatory");
      const buyerAttested = !!buyerAttestation;
      const sellerAttested = !!sellerAttestation;
      const buyerAttestedAt: string | null = buyerAttestation?.attested_at ?? null;
      const sellerAttestedAt: string | null = sellerAttestation?.attested_at ?? null;

      const allAttested = buyerAttested && sellerAttested;
      const userOrgId = authCtx.orgId;
      const userId = authCtx.userId;

      // Viewer-specific attestation record (prefer match on user_id, fall back to org_id
      // to cover service-account / actor-on-behalf flows where user_id may differ).
      const viewerAttestation =
        list.find((a) => a.user_id === userId) ||
        list.find((a) => a.org_id === userOrgId);
      const hasAttested = !!viewerAttestation;
      const viewerAttestedAt: string | null = viewerAttestation?.attested_at ?? null;

      const isParty = userOrgId === wad.buyer_org_id || userOrgId === wad.seller_org_id;
      const isTerminal = wad.status === "revoked" || wad.status === "superseded";

      // Resolve viewer role (mirrors resolveAttestationRole on the client).
      // OWNERSHIP: `viewerRole` is the **viewer's own** signatory role on
      // this WaD. It is derived strictly from canonical buyer_org_id /
      // seller_org_id slots — never from a counterparty field, never from
      // a search-inferred side. The corresponding DB column
      // `wad_signatures.role` is constrained to
      // ('buyer_signatory','seller_signatory','witness','admin') and means
      // "the role of the signing party for THIS signature row".
      let viewerRole: "buyer_signatory" | "seller_signatory" | "witness" = "witness";
      if (userOrgId === wad.buyer_org_id) viewerRole = "buyer_signatory";
      else if (userOrgId === wad.seller_org_id) viewerRole = "seller_signatory";

      // canAttest gate (matches client's WadState.canDo + party check).
      const ATTEST_ALLOWED_STATUSES = new Set(["draft", "awaiting_attestations"]);
      const canAttest =
        isParty && !hasAttested && ATTEST_ALLOWED_STATUSES.has(wad.status);
      const canSeal = allAttested && ATTEST_ALLOWED_STATUSES.has(wad.status);

      type NextAction =
        | "attest"
        | "seal"
        | "await_other_party"
        | "download_certificate"
        | "view_only";

      type UiModel = {
        canAttest: boolean;
        canSeal: boolean;
        title: string;
        buttonText: string | null;
        helperText: string;
        viewerRole: typeof viewerRole;
        hasAttested: boolean;
        /** ISO-8601 timestamp of the caller's attestation, or null if not attested. */
        viewerAttestedAt: string | null;
        attestations: {
          buyerAttested: boolean;
          sellerAttested: boolean;
          /** ISO-8601 timestamp of the buyer's attestation, or null. */
          buyerAttestedAt: string | null;
          /** ISO-8601 timestamp of the seller's attestation, or null. */
          sellerAttestedAt: string | null;
          total: number;
        };
        nextAction: NextAction;
      };

      const counts = {
        buyerAttested,
        sellerAttested,
        buyerAttestedAt,
        sellerAttestedAt,
        total: list.length,
      };

      const ui: UiModel = (() => {
        // Terminal states first.
        if (wad.status === "sealed") {
          return {
            canAttest: false,
            canSeal: false,
            title: "Signed Deal is sealed",
            buttonText: null,
            helperText: "All required attestations are in place. The certificate is available to download.",
            viewerRole,
            hasAttested,
            viewerAttestedAt,
            attestations: counts,
            nextAction: "download_certificate",
          };
        }
        if (wad.status === "revoked") {
          return {
            canAttest: false,
            canSeal: false,
            title: "Signed Deal revoked",
            buttonText: null,
            helperText: wad.revoked_reason
              ? `This Signed Deal has been revoked: ${wad.revoked_reason}`
              : "This Signed Deal has been revoked, so attestations are no longer accepted.",
            viewerRole,
            hasAttested,
            viewerAttestedAt,
            attestations: counts,
            nextAction: "view_only",
          };
        }
        if (wad.status === "superseded") {
          return {
            canAttest: false,
            canSeal: false,
            title: "Superseded by a newer Signed Deal",
            buttonText: null,
            helperText: "A newer Signed Deal has replaced this one. Attest on the active deal instead.",
            viewerRole,
            hasAttested,
            viewerAttestedAt,
            attestations: counts,
            nextAction: "view_only",
          };
        }

        // Active (draft / awaiting_attestations) states.
        if (canSeal) {
          return {
            canAttest: false,
            canSeal: true,
            title: "Ready to seal",
            buttonText: "Seal Signed Deal",
            helperText: "Both signatories have attested. Sealing finalises the evidence bundle.",
            viewerRole,
            hasAttested,
            viewerAttestedAt,
            attestations: counts,
            nextAction: "seal",
          };
        }

        if (canAttest) {
          if (wad.status === "draft") {
            return {
              canAttest: true,
              canSeal: false,
              title: "Attestations open",
              buttonText: "Attest as first signatory",
              helperText:
                "You'll be the first to attest. The other party still needs to attest before this deal can be sealed.",
              viewerRole,
              hasAttested,
              viewerAttestedAt,
              attestations: counts,
              nextAction: "attest",
            };
          }
          // awaiting_attestations
          return {
            canAttest: true,
            canSeal: false,
            title: "Your attestation is required",
            buttonText: "Attest & advance to seal",
            helperText:
              "The other signatory has already attested. Your attestation will move this deal to Ready to seal.",
            viewerRole,
            hasAttested,
            viewerAttestedAt,
            attestations: counts,
            nextAction: "attest",
          };
        }

        // Party but already attested → waiting for the other side.
        if (isParty && hasAttested) {
          return {
            canAttest: false,
            canSeal: false,
            title: "Awaiting other party",
            buttonText: null,
            helperText: "You've attested. Waiting for the counterparty signatory to attest.",
            viewerRole,
            hasAttested,
            viewerAttestedAt,
            attestations: counts,
            nextAction: "await_other_party",
          };
        }

        // Non-party / witness viewer.
        if (wad.status === "draft") {
          return {
            canAttest: false,
            canSeal: false,
            title: "Attestations not yet open",
            buttonText: null,
            helperText:
              "This Signed Deal is still in draft. Once it moves to Awaiting attestations, the buyer and seller signatories can attest here.",
            viewerRole,
            hasAttested,
            viewerAttestedAt,
            attestations: counts,
            nextAction: "view_only",
          };
        }
        return {
          canAttest: false,
          canSeal: false,
          title: "Awaiting buyer & seller attestations",
          buttonText: null,
          helperText:
            "Only the nominated buyer and seller signatories for this trade can attest. You're viewing as a witness/observer.",
          viewerRole,
          hasAttested,
          viewerAttestedAt,
          attestations: counts,
          nextAction: "view_only",
        };
      })();

      // Build the canonical response payload. We deliberately exclude
      // `request_id` from the ETag input because it changes per-request
      // (instrumentation) and would defeat caching. Clients that care about
      // the request id can still read it from the response body or the
      // x-request-id header on a 200; on a 304 they already know the
      // payload is unchanged so the prior request_id is irrelevant.
      const responsePayload = {
        wad_id: wad.id,
        status: wad.status,
        isTerminal,
        ui,
      };

      const etag = await computeETag(responsePayload);
      // Private + short max-age: this is per-viewer (helperText, viewerRole,
      // viewerAttestedAt all depend on the caller) so we MUST NOT let shared
      // caches store it. The ETag still lets the same client skip the body
      // on a poll within the freshness window.
      const cacheCtrl = cacheHeaders("private-short");

      const ifNoneMatch =
        req.headers.get("If-None-Match") || req.headers.get("if-none-match");
      if (ifNoneMatchMatches(ifNoneMatch, etag)) {
        return notModifiedResponse(etag, { ...headers, ...cacheCtrl });
      }

      return new Response(
        JSON.stringify({ ...responsePayload, request_id: requestId }),
        {
          status: 200,
          headers: {
            ...headers,
            ...cacheCtrl,
            ETag: etag,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // ── POST /wad/:wadId/attest ── Add attestation
    if (req.method === "POST" && parts.length === 2 && parts[1] === "attest") {
      const wadId = parts[0];

      // Idempotency-Key handling. Header is REQUIRED (hard-mode) — attestations
      // are appended to an immutable ledger; a retry without dedupe creates a
      // duplicate attestation row that is then surfaced to compliance reviewers
      // as a real second signature.
      // A repeat request with the SAME body returns the original 201 response
      // (no second insert). A repeat with the SAME key but a DIFFERENT body
      // returns 409 IDEMPOTENCY_KEY_MISMATCH so the client knows it reused
      // a key incorrectly. Keys are scoped to (org, endpoint) and expire
      // after 24h via the idempotency_keys table default.
      const idempotencyKey =
        req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key");
      if (!idempotencyKey) {
        throw new ApiException(
          "VALIDATION_ERROR",
          "Idempotency-Key header is required",
          400,
        );
      }
      const idempotencyEndpoint = `POST /wad/${wadId}/attest`;

      const rawBody = await req.text();
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        throw new ApiException("VALIDATION_ERROR", "Request body must be valid JSON", 400);
      }
      const { attested_name, role } = validateInput(attestSchema, parsedBody);

      // Hash the canonical body so two payloads with the same fields in
      // different key order still match (helper is unit-tested).
      const requestHash = await hashAttestBody({ attested_name, role });

      if (idempotencyKey) {
        const { data: existing } = await supabase
          .from("idempotency_keys")
          .select("response_data, response_status_code, request_hash")
          .eq("org_id", authCtx.orgId)
          .eq("idempotency_key", idempotencyKey)
          .eq("endpoint", idempotencyEndpoint)
          .maybeSingle();

        const decision = decideIdempotency(existing ?? null, requestHash);
        if (decision.kind === "mismatch") {
          throw new ApiException(
            "IDEMPOTENCY_KEY_MISMATCH",
            "Idempotency-Key was reused with a different request body",
            409,
          );
        }
        if (decision.kind === "replay") {
          return new Response(JSON.stringify(decision.responseData), {
            status: decision.statusCode,
            headers: {
              ...headers,
              "Content-Type": "application/json",
              "Idempotent-Replay": "true",
            },
          });
        }
      }

      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .select("*")
        .eq("id", wadId)
        .single();

      if (wadError || !wad) {
        throw new ApiException("NOT_FOUND", "WaD not found", 404);
      }

      if (wad.status === "sealed") throw new ApiException("INVALID_STATE", "Cannot attest to sealed WaD", 400);
      if (wad.status === "revoked") throw new ApiException("INVALID_STATE", "Cannot attest to revoked WaD", 400);

      // Check role authorisation
      if (role === "buyer_signatory" && wad.buyer_org_id !== authCtx.orgId) {
        throw new ApiException("FORBIDDEN", "Not authorised as buyer signatory", 403);
      }
      if (role === "seller_signatory" && wad.seller_org_id !== authCtx.orgId) {
        throw new ApiException("FORBIDDEN", "Not authorised as seller signatory", 403);
      }

      const { data: attestation, error: attError } = await supabase
        .from("wad_attestations")
        .insert({
          wad_id: wadId,
          user_id: actorUserId || authCtx.userId,
          org_id: authCtx.orgId,
          role,
          attested_name,
          attestation_text: ATTESTATION_TEXT,
          ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
          user_agent: req.headers.get("user-agent"),
        })
        .select()
        .single();

      if (attError) {
        if (attError.code === "23505") {
          throw new ApiException("CONFLICT", "Already attested to this WaD", 409);
        }
        handleDatabaseError(attError, requestId);
      }

      // Update WaD status + signatory ref
      const updateFields: Record<string, unknown> = {};
      if (wad.status === "draft") updateFields.status = "awaiting_attestations";
      if (role === "buyer_signatory") updateFields.buyer_signatory_user_id = actorUserId || authCtx.userId;
      if (role === "seller_signatory") updateFields.seller_signatory_user_id = actorUserId || authCtx.userId;

      if (Object.keys(updateFields).length > 0) {
        await supabase.from("wads").update(updateFields).eq("id", wadId);
      }

      await writeAuditLog("wad.attested", wadId, { role });

      // Persist idempotency record so a retry returns the same response.
      // Best-effort: a 23505 here means a concurrent request raced us — that's
      // fine, the next retry will hit the cached response on lookup.
      if (idempotencyKey) {
        await supabase.from("idempotency_keys").insert({
          org_id: authCtx.orgId,
          idempotency_key: idempotencyKey,
          endpoint: idempotencyEndpoint,
          request_hash: requestHash,
          response_data: attestation,
          response_status_code: 201,
        });
      }

      return new Response(JSON.stringify(attestation), {
        status: 201,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── POST /wad/:wadId/seal ── Seal the WaD
    if (req.method === "POST" && parts.length === 2 && parts[1] === "seal") {
      const wadId = parts[0];

      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .select("*")
        .eq("id", wadId)
        .single();

      if (wadError || !wad) throw new ApiException("NOT_FOUND", "WaD not found", 404);
      if (wad.status === "sealed") throw new ApiException("INVALID_STATE", "WaD is already sealed", 400);
      if (wad.status === "revoked") throw new ApiException("INVALID_STATE", "Cannot seal revoked WaD", 400);

      if (!isPartyToWad(wad, authCtx.orgId) && !isAdmin(authCtx)) {
        throw new ApiException("FORBIDDEN", "Not authorised to seal this WaD", 403);
      }

      // Batch C Phase 3A: WaD seal blocked while a challenge is open on the match.
      {
        const matchIdForGuard = (wad as { match_id?: string | null; poi_id?: string | null }).match_id || wad.poi_id;
        if (matchIdForGuard) {
          const challengeDecision = await assertNoOpenChallenge(supabase, matchIdForGuard);
          if (!challengeDecision.allowed) {
            throw new ApiException(
              "CHALLENGE_OPEN",
              challengeDecision.message ?? "Progression paused.",
              409,
              {
                challenge_id: challengeDecision.challengeId,
                challenge_status: challengeDecision.challengeStatus,
                raised_at: challengeDecision.raisedAt,
              },
            );
          }
        }
      }

      // Fetch attestations + documents in parallel
      const [attResult, docResult] = await Promise.all([
        supabase.from("wad_attestations").select("*").eq("wad_id", wadId),
        supabase.from("match_documents").select("id, sha256_hash, doc_type").eq("match_id", wad.poi_id).neq("status", "revoked"),
      ]);

      const attestations = attResult.data || [];
      const documents = docResult.data || [];

      const hasBuyer = attestations.some(a => a.role === "buyer_signatory");
      const hasSeller = attestations.some(a => a.role === "seller_signatory");
      if (!hasBuyer || !hasSeller) {
        throw new ApiException("VALIDATION_ERROR", "Both buyer and seller must attest before sealing", 400);
      }

      const canonicalPayload = buildCanonicalPayload(wad, attestations, documents);
      const sealHash = await generateHash(canonicalPayload);
      const ledgerEntryHash = await generateHash({
        prev: wad.prev_ledger_entry_hash,
        seal: sealHash,
        timestamp: new Date().toISOString(),
      });

      const { data: sealedWad, error: sealError } = await supabase
        .from("wads")
        .update({
          status: "sealed",
          canonical_payload_json: canonicalPayload,
          seal_hash: sealHash,
          sealed_at: new Date().toISOString(),
          ledger_entry_hash: ledgerEntryHash,
        })
        .eq("id", wadId)
        .select()
        .single();

      if (sealError) handleDatabaseError(sealError, requestId);

      await writeAuditLog("wad.sealed", wadId, { seal_hash: sealHash });

      // ── Revenue notification → support@izenzo.co.za ──
      // Sealing is the moment a trade is certified ("the sale completes").
      // Best-effort, never blocks the seal response. Idempotency keyed on
      // wad.id so re-attempts never spam the inbox.
      (async () => {
        const [buyerOrgRes, sellerOrgRes] = await Promise.all([
          wad.buyer_org_id
            ? supabase.from("organizations").select("name").eq("id", wad.buyer_org_id).maybeSingle()
            : Promise.resolve({ data: null }),
          wad.seller_org_id
            ? supabase.from("organizations").select("name").eq("id", wad.seller_org_id).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        const buyerName = (buyerOrgRes.data?.name as string) || wad.buyer_org_id || "Unknown buyer";
        const sellerName = (sellerOrgRes.data?.name as string) || wad.seller_org_id || "Unknown seller";

        await emitRevenueNotification(supabase, {
          eventType: "wad_sealed",
          idempotencyKey: `revenue-wad-sealed-${wadId}`,
          referenceId: wadId,
          orgId: wad.seller_org_id || wad.buyer_org_id || null,
          orgName: sellerName,
          headline: `WaD sealed — ${sellerName} → ${buyerName}`,
          details: {
            Buyer: buyerName,
            Seller: sellerName,
            "POI / Match ID": wad.poi_id || "—",
            Attestations: attestations.length,
            "Documents bound": documents.length,
            "Seal hash": sealHash.slice(0, 16) + "…",
          },
          consoleUrl: `https://api.trade.izenzo.co.za/desk/match/${wad.poi_id || ""}`,
          consoleLabel: "Open trade",
        });
      })();

      return new Response(JSON.stringify(sealedWad), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── POST /wad/:wadId/revoke ── Revoke WaD (admin only)
    if (req.method === "POST" && parts.length === 2 && parts[1] === "revoke") {
      const wadId = parts[0];
      const body = await req.json();
      const { reason } = validateInput(revokeSchema, body);

      if (!isAdmin(authCtx)) {
        throw new ApiException("FORBIDDEN", "Only admins can revoke WaDs", 403);
      }

      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .select("*")
        .eq("id", wadId)
        .single();

      if (wadError || !wad) throw new ApiException("NOT_FOUND", "WaD not found", 404);
      if (wad.status === "revoked") throw new ApiException("INVALID_STATE", "WaD is already revoked", 400);

      const { data: revokedWad, error: revokeError } = await supabase
        .from("wads")
        .update({
          status: "revoked",
          revoked_at: new Date().toISOString(),
          revoked_by: actorUserId,
          revoked_reason: reason,
        })
        .eq("id", wadId)
        .select()
        .single();

      if (revokeError) handleDatabaseError(revokeError, requestId);

      await writeAuditLog("wad.revoked", wadId, { reason });

      return new Response(JSON.stringify(revokedWad), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── GET /wad/:wadId/certificate ── Download PDF certificate
    if (req.method === "GET" && parts.length === 2 && parts[1] === "certificate") {
      const wadId = parts[0];

      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .select("*")
        .eq("id", wadId)
        .single();

      if (wadError || !wad) throw new ApiException("NOT_FOUND", "WaD not found", 404);
      if (wad.status !== "sealed") throw new ApiException("VALIDATION_ERROR", "Certificate only available for sealed WaDs", 400);

      if (!isPartyToWad(wad, authCtx.orgId) && !isAdmin(authCtx)) {
        throw new ApiException("FORBIDDEN", "Not authorised to download this certificate", 403);
      }

      // Fetch attestations + POI in parallel
      const [attResult, poiResult] = await Promise.all([
        supabase.from("wad_attestations").select("*").eq("wad_id", wadId).order("attested_at", { ascending: true }),
        supabase.from("matches").select("*").eq("id", wad.poi_id).single(),
      ]);

      const attestations = attResult.data || [];
      const poi = poiResult.data;
      const generatedAt = new Date().toISOString();

      // ── Build PDF ──
      const pdfDoc = await PDFDocument.create();
      pdfDoc.setTitle(`Signed Deal Certificate - ${wadId}`);
      pdfDoc.setSubject("Signed Deal Certificate");
      pdfDoc.setProducer("Izenzo Platform");
      pdfDoc.setCreator("Izenzo Platform");
      pdfDoc.setCreationDate(new Date());

      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const courier = await pdfDoc.embedFont(StandardFonts.Courier);

      const PAGE_W = 595.28; // A4
      const PAGE_H = 841.89;
      const MARGIN = 50;
      const CONTENT_W = PAGE_W - 2 * MARGIN;
      const LINE_H = 16;
      const SMALL_LINE_H = 13;

      let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      let y = PAGE_H - MARGIN;

      // pdf-lib's StandardFonts (Helvetica/Courier) only support the WinAnsi
      // (CP1252) glyph set. Any character outside that range — emoji, smart
      // quotes, em/en dashes, ellipsis, accented Unicode from user content —
      // will throw "WinAnsi cannot encode" mid-render and surface to the user
      // as "An internal error occurred". Sanitise every string before drawing
      // via the shared safePdfText helper (see _shared/pdf-sanitizer.ts and
      // its test suite for the exact codepoint coverage matrix).
      const safe = safePdfText;

      // Utility: draw text with wrapping, returns new y
      const drawWrapped = (
        rawText: string,
        x: number,
        startY: number,
        maxW: number,
        font: typeof helvetica,
        size: number,
        color: any = rgb(0.15, 0.15, 0.15),
        lineH = SMALL_LINE_H
      ): number => {
        const text = safe(rawText);
        const words = text.split(" ");
        let line = "";
        let cy = startY;
        for (const word of words) {
          const test = line ? `${line} ${word}` : word;
          const tw = font.widthOfTextAtSize(test, size);
          if (tw > maxW && line) {
            if (cy < MARGIN + 40) {
              // Add footer to current page
              drawFooter(page);
              page = pdfDoc.addPage([PAGE_W, PAGE_H]);
              cy = PAGE_H - MARGIN;
            }
            page.drawText(line, { x, y: cy, size, font, color });
            cy -= lineH;
            line = word;
          } else {
            line = test;
          }
        }
        if (line) {
          if (cy < MARGIN + 40) {
            drawFooter(page);
            page = pdfDoc.addPage([PAGE_W, PAGE_H]);
            cy = PAGE_H - MARGIN;
          }
          page.drawText(line, { x, y: cy, size, font, color });
          cy -= lineH;
        }
        return cy;
      };

      const drawFooter = (p: typeof page) => {
        const footerY = MARGIN - 15;
        p.drawLine({
          start: { x: MARGIN, y: footerY + 12 },
          end: { x: PAGE_W - MARGIN, y: footerY + 12 },
          thickness: 0.5,
          color: grayscale(0.7),
        });
        p.drawText(safe(`Generated: ${generatedAt}`), {
          x: MARGIN,
          y: footerY,
          size: 7,
          font: helvetica,
          color: grayscale(0.5),
        });
        p.drawText("Izenzo - Governed Infrastructure for Trade and Compliance", {
          x: PAGE_W - MARGIN - helvetica.widthOfTextAtSize("Izenzo - Governed Infrastructure for Trade and Compliance", 7),
          y: footerY,
          size: 7,
          font: helvetica,
          color: grayscale(0.5),
        });
      };

      const drawSectionHeader = (label: string): void => {
        if (y < MARGIN + 80) {
          drawFooter(page);
          page = pdfDoc.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - MARGIN;
        }
        y -= 8;
        page.drawLine({
          start: { x: MARGIN, y: y + 4 },
          end: { x: PAGE_W - MARGIN, y: y + 4 },
          thickness: 0.5,
          color: grayscale(0.8),
        });
        y -= LINE_H;
        page.drawText(safe(label), {
          x: MARGIN,
          y,
          size: 12,
          font: helveticaBold,
          color: rgb(0.1, 0.1, 0.1),
        });
        y -= LINE_H + 2;
      };

      const drawField = (label: string, value: string, mono = false): void => {
        if (y < MARGIN + 40) {
          drawFooter(page);
          page = pdfDoc.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - MARGIN;
        }
        page.drawText(safe(label), {
          x: MARGIN,
          y,
          size: 9,
          font: helveticaBold,
          color: grayscale(0.4),
        });
        y -= SMALL_LINE_H;
        y = drawWrapped(
          value || "-",
          MARGIN,
          y,
          CONTENT_W,
          mono ? courier : helvetica,
          mono ? 8 : 10,
          rgb(0.15, 0.15, 0.15),
          SMALL_LINE_H
        );
        y -= 4;
      };

      // ══════════════════════════════════════
      // PAGE CONTENT
      // ══════════════════════════════════════

      // ── Header / Title ──
      // Decorative top bar
      page.drawRectangle({
        x: 0, y: PAGE_H - 8,
        width: PAGE_W, height: 8,
        color: rgb(0.16, 0.65, 0.53), // teal brand colour
      });

      y -= 20;
      page.drawText("CERTIFICATE", {
        x: MARGIN,
        y,
        size: 28,
        font: helveticaBold,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= 24;
      page.drawText("Signed Deal (WaD) - Sealed Evidence Record", {
        x: MARGIN,
        y,
        size: 12,
        font: helvetica,
        color: grayscale(0.4),
      });
      y -= LINE_H;

      // ── TEST MODE banner (only when bypasses were applied during issuance) ──
      const testModeMeta = (wad.evidence_bundle as any)?.test_mode;
      if (testModeMeta?.issued_under_test_mode) {
        const bypassedNames = (testModeMeta.bypassed_gates as Array<{ gate: string }>)
          .map((b) => b.gate.replace(/_/g, " "))
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(", ");
        // Amber alert strip across the page
        page.drawRectangle({
          x: MARGIN - 4,
          y: y - 4,
          width: CONTENT_W + 8,
          height: 32,
          color: rgb(0.98, 0.85, 0.4),
        });
        page.drawText(safe("\u26A0 TEST MODE \u2014 DEMO GRADE ONLY"), {
          x: MARGIN,
          y: y + 14,
          size: 11,
          font: helveticaBold,
          color: rgb(0.4, 0.2, 0),
        });
        page.drawText(safe(`Issued without: ${bypassedNames}. Not contractually durable.`), {
          x: MARGIN,
          y: y + 2,
          size: 8,
          font: helvetica,
          color: rgb(0.4, 0.2, 0),
        });
        y -= 40;
      }

      // ── Certificate Identity ──
      drawSectionHeader("Certificate Details");
      drawField("WaD Identifier", wadId, true);
      drawField("POI Identifier", wad.poi_id, true);
      drawField("Certificate Status", "SEALED");
      drawField("Issued", wad.sealed_at ? new Date(wad.sealed_at).toUTCString() : "-");
      drawField("Generated", new Date(generatedAt).toUTCString());

      // ── Transaction Summary ──
      drawSectionHeader("Transaction Summary");
      drawField("Commodity", poi?.commodity || "-");
      drawField("Quantity", `${poi?.quantity_amount ?? "-"} ${poi?.quantity_unit ?? ""}`);
      drawField("Price", `${poi?.price_currency ?? ""} ${poi?.price_amount ?? "-"}`);
      drawField("Intent Confirmed", poi?.settled_at ? new Date(poi.settled_at).toUTCString() : "-");

      // ── Parties ──
      drawSectionHeader("Parties");
      drawField("Buyer", poi?.buyer_name || "-");
      drawField("Buyer Organisation", wad.buyer_org_id || "-", true);
      drawField("Seller", poi?.seller_name || "-");
      drawField("Seller Organisation", wad.seller_org_id || "-", true);

      // ── Attestations ──
      drawSectionHeader("Attestations");
      if (attestations.length === 0) {
        drawField("Attestations", "None recorded");
      } else {
        for (const att of attestations) {
          const roleLabel = att.role.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
          drawField(
            `${roleLabel} - ${att.attested_name}`,
            `Attested: ${new Date(att.attested_at).toUTCString()}`
          );
          y = drawWrapped(
            `"${att.attestation_text}"`,
            MARGIN + 10,
            y,
            CONTENT_W - 10,
            helvetica,
            8,
            grayscale(0.45),
            SMALL_LINE_H
          );
          y -= 6;
        }
      }

      // ── Cryptographic Seal ──
      drawSectionHeader("Cryptographic Verification");
      drawField("Seal Hash (SHA-256)", wad.seal_hash || "-", true);
      drawField("Ledger Entry Hash", wad.ledger_entry_hash || "-", true);
      if (wad.prev_ledger_entry_hash) {
        drawField("Previous Ledger Hash", wad.prev_ledger_entry_hash, true);
      }
      const evidenceBundleHash = await generateHash(wad.evidence_bundle);
      drawField("Evidence Bundle Hash", evidenceBundleHash, true);

      // ── Evidence Summary ──
      const evidence = wad.evidence_bundle as any;
      if (evidence) {
        drawSectionHeader("Evidence Summary");
        drawField("Documents Included", String(evidence?.documents?.length || 0));
        drawField("Event Chain Length", String(evidence?.event_count || 0));
        if (evidence?.documents?.length > 0) {
          for (const doc of evidence.documents.slice(0, 10)) {
            const docLabel = doc.title || doc.doc_type || "Document";
            const hashShort = doc.sha256_hash ? doc.sha256_hash.substring(0, 24) + "…" : "-";
            drawField(docLabel, `Hash: ${hashShort}`, true);
          }
          if (evidence.documents.length > 10) {
            y = drawWrapped(
              `… and ${evidence.documents.length - 10} more documents`,
              MARGIN,
              y,
              CONTENT_W,
              helvetica,
              9,
              grayscale(0.5),
              SMALL_LINE_H
            );
          }
        }
      }

      // ── Disclaimer ──
      drawSectionHeader("Disclaimer");
      y = drawWrapped(
        "This is NOT a contract. No payment. No obligation. This document is an evidence-grade record that intent was confirmed between the named parties. It does not create, evidence, or imply any legally binding agreement, payment obligation, or contractual commitment.",
        MARGIN,
        y,
        CONTENT_W,
        helvetica,
        9,
        grayscale(0.4),
        SMALL_LINE_H
      );
      y -= 6;

      // ── Verification Notice ──
      y = drawWrapped(
        `To verify this certificate, compare the Seal Hash and Ledger Entry Hash with the platform records for WaD ID ${wadId}. The seal hash is a SHA-256 digest of the canonical payload including all attestations, document hashes, and event chain data at the time of sealing.`,
        MARGIN,
        y,
        CONTENT_W,
        helvetica,
        8,
        grayscale(0.5),
        SMALL_LINE_H
      );

      // ── Footer on final page ──
      drawFooter(page);

      // Serialise PDF
      const pdfBytes = await pdfDoc.save();

      // Update certificate_generated_at if the column exists
      await supabase
        .from("wads")
        .update({ certificate_generated_at: generatedAt })
        .eq("id", wadId);

      // Audit
      const auditAction = isAdmin(authCtx) && !isPartyToWad(wad, authCtx.orgId)
        ? "admin.wad.certificate.downloaded"
        : "wad.certificate.downloaded";
      await writeAuditLog(auditAction, wadId, { format: "pdf" });

      return new Response(pdfBytes as unknown as BodyInit, {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="WaD-Certificate-${wadId.substring(0, 8)}.pdf"`,
          "Content-Length": String(pdfBytes.length),
        },
      });
    }

    // ── GET /wad ── List WaDs
    if (req.method === "GET" && parts.length === 0) {
      const poiId = url.searchParams.get("poi_id");
      const status = url.searchParams.get("status");

      let query = supabase.from("wads").select("*");

      if (!isAdmin(authCtx)) {
        query = query.or(`org_id.eq.${authCtx.orgId},buyer_org_id.eq.${authCtx.orgId},seller_org_id.eq.${authCtx.orgId}`);
      }

      if (poiId) query = query.eq("poi_id", poiId);
      if (status) query = query.eq("status", status);

      const { data: wads, error: wadsError } = await query.order("created_at", { ascending: false });
      if (wadsError) handleDatabaseError(wadsError, requestId);

      return new Response(JSON.stringify(wads || []), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);

  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
