import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertEngagementAllowsProgression } from "../_shared/engagement-progression-guard.ts";
import { assertNoOpenChallenge, challengeOpenResponse } from "../_shared/challenge-progression-guard.ts";
import {
  assertMatchProgressable,
  buildProgressionGuardResponse,
} from "../_shared/match-progression-guard.ts";
import {
  assertCompliantFreshness,
  buildComplianceFreshnessResponse,
} from "../_shared/compliance-freshness-guard.ts";
import { tryDemoShortCircuit } from "../_shared/demo-mode-entry.ts";
import { residencyGateForMatchRequest } from "../_shared/residency-entry.ts";
import { checkResidencyHoldAny, residencyBlockResponse } from "../_shared/residency-claim-guard.ts";

/**
 * P3 WaD (Signed Deal) Edge Function - V3 Sprint 3
 *
 * POST: Issue WaD for a COMPLETED POI - enforces 7 deterministic hard-gates.
 * GET:  List or get WaD by ID.
 *
 * Hard-Gates (all must pass):
 *  1. POI is in COMPLETED state
 *  2. Both buyer & seller entities are ACTIVE
 *  3. UBO ownership is 100% for both parties
 *  4. Authority-to-Bind (ATB) is verified for both
 *  5. All mandatory governance documents are validated
 *  6. No unresolved compliance cases exist
 *  7. Token balance is sufficient for governance doc burns
 */

const WadCreateSchema = z.object({
  poi_id: z.string().uuid(),
});

function successEnvelope(data: unknown, correlationId: string) {
  return {
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    correlation_id: correlationId,
    data,
  };
}

interface HardGateResult {
  gate: string;
  passed: boolean;
  reason: string;
}

Deno.serve(async (req: Request) => {
  // OPS-010: short-circuit live side effects for demo data.
  try {
    const _demoAdmin = (await import("https://esm.sh/@supabase/supabase-js@2.39.3")).createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const _demoBlocked = await tryDemoShortCircuit(_demoAdmin, req, { op: "p3-wad", artefact: true });
    if (_demoBlocked) return _demoBlocked;
    // DATA-009 Phase 2 residency gate.
    const _resGate = await residencyGateForMatchRequest(_demoAdmin, req);
    if (_resGate) return _resGate;
    void checkResidencyHoldAny; void residencyBlockResponse;
  } catch (_e) { /* OPS-010 best-effort; live flow continues */ }
  if (req.method === "OPTIONS") return handleCors(req);

  const correlationId = req.headers.get("X-Correlation-ID") || crypto.randomUUID();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const orgId = authCtx.orgId;
    if (!orgId) throw new ApiException("FORBIDDEN", "No organisation found", 403);

    const url = new URL(req.url);

    // ── POST: Issue WaD with hard-gate enforcement ──
    if (req.method === "POST") {
      const idempotencyKey = req.headers.get("Idempotency-Key");
      if (!idempotencyKey) {
        throw new ApiException("VALIDATION_ERROR", "Idempotency-Key header is required", 400);
      }

      // Idempotency check
      const { data: existing } = await admin
        .from("idempotency_keys")
        .select("response_data, response_status_code")
        .eq("org_id", orgId)
        .eq("idempotency_key", idempotencyKey)
        .eq("endpoint", "p3-wad")
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify(existing.response_data), {
          status: existing.response_status_code,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const parsed = WadCreateSchema.parse(body);

      // Fetch POI
      const { data: poi } = await admin
        .from("pois")
        .select("*")
        .eq("id", parsed.poi_id)
        .maybeSingle();

      if (!poi) throw new ApiException("NOT_FOUND", "POI not found", 404);

      // Verify caller is party to the intent
      if (poi.org_id !== orgId) {
        throw new ApiException("FORBIDDEN", "Not authorised to create WaD for this intent", 403);
      }

      // ── ENGAGEMENT HOLD-POINT GUARD (Batch B Phase 4) ──
      // WaD issuance is engagement-scoped progression. Use the canonical
      // current-engagement guard so historical accepted rows do NOT pass
      // when a renewed pending child supersedes them.
      {
        const matchIdForGuard = (poi as { match_id?: string | null }).match_id || poi.id;



        // ── MT-008 / MT-009 server-side progression guard (p3 WaD issuance) ──
        {
          const mtDecision = await assertMatchProgressable({
            supabase: admin,
            matchId: matchIdForGuard,
            action: "finality",
            sourceFunction: "p3-wad:issue",
            actorUserId: userId ?? null,
            actorOrgId: orgId ?? null,
          });
          const blocked = buildProgressionGuardResponse(mtDecision);
          if (blocked) return blocked;
        }

        // ── COMP-002 / COMP-012 compliance freshness guard (p3 WaD issue) ──
        {
          const compDecision = await assertCompliantFreshness({
            supabase: admin,
            matchId: matchIdForGuard,
            action: "p3_wad",
            sourceFunction: "p3-wad:issue",
            actorUserId: userId ?? null,
            actorOrgId: orgId ?? null,
          });
          const blockedComp = buildComplianceFreshnessResponse(compDecision);
          if (blockedComp) return blockedComp;
        }

        // Batch C Phase 3A: p3 WaD issuance blocked while a challenge is open.
        const challengeDecision = await assertNoOpenChallenge(admin, matchIdForGuard);
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

        const decision = await assertEngagementAllowsProgression(admin, matchIdForGuard);
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

      // ── Run Hard-Gates ──
      const gates: HardGateResult[] = [];
      const carryForwardLog: Array<{ gate: string; entity_id: string; snapshot_id: string; signal: string }> = [];

      // ── Discovery Eligibility carry-forward pre-fetch ──
      // If a Discovery eligibility snapshot exists for an entity, is PASS, and is
      // unexpired, its signals can satisfy the equivalent WaD gate without
      // forcing duplicate evidence (David's Item 8: "no duplication of checks").
      // We fetch once, here, then consult below in each gate.
      const fetchValidSnap = async (entityId: string | null) => {
        if (!entityId) return null;
        const { data } = await admin
          .from("discovery_eligibility_snapshots")
          .select("id, eligibility_status, expires_at, signals, created_at")
          .eq("entity_id", entityId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!data) return null;
        if (data.eligibility_status !== "PASS") return null;
        if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
        return data;
      };
      const [buyerDiscSnap, sellerDiscSnap] = await Promise.all([
        fetchValidSnap(poi.buyer_entity_id),
        fetchValidSnap(poi.seller_entity_id),
      ]);
      const recordCarry = (gate: string, entityId: string, snapId: string, signal: string) => {
        carryForwardLog.push({ gate, entity_id: entityId, snapshot_id: snapId, signal });
      };

      // Gate 1: Intent state must be COMPLETED
      gates.push({
        gate: "POI_STATE",
        passed: poi.state === "COMPLETED",
        reason: poi.state === "COMPLETED"
          ? "POI is in COMPLETED state"
          : `POI is in ${poi.state} state - must be COMPLETED`,
      });

      // Gate 2: Both entities must be ACTIVE or VERIFIED
      // Carry-forward: a valid Discovery snapshot with id_verified === true
      // satisfies entity activation for that party.
      const [buyerRes, sellerRes] = await Promise.all([
        admin.from("entities").select("id, status, entity_type").eq("id", poi.buyer_entity_id).maybeSingle(),
        admin.from("entities").select("id, status, entity_type").eq("id", poi.seller_entity_id).maybeSingle(),
      ]);
      const validStatuses = ["active", "ACTIVE", "verified", "VERIFIED"];
      const buyerSigs = (buyerDiscSnap?.signals || {}) as any;
      const sellerSigs = (sellerDiscSnap?.signals || {}) as any;
      const buyerActive =
        (buyerRes.data && validStatuses.includes(buyerRes.data.status)) ||
        (buyerDiscSnap && buyerSigs?.id_verified === true);
      const sellerActive =
        (sellerRes.data && validStatuses.includes(sellerRes.data.status)) ||
        (sellerDiscSnap && sellerSigs?.id_verified === true);
      if (buyerDiscSnap && buyerSigs?.id_verified === true) recordCarry("ENTITY_STATUS", poi.buyer_entity_id, buyerDiscSnap.id, "id_verified");
      if (sellerDiscSnap && sellerSigs?.id_verified === true) recordCarry("ENTITY_STATUS", poi.seller_entity_id, sellerDiscSnap.id, "id_verified");
      gates.push({
        gate: "ENTITY_STATUS",
        passed: !!(buyerActive && sellerActive),
        reason: buyerActive && sellerActive
          ? "Both buyer and seller entities are active/verified (carry-forward where applicable)"
          : `Buyer: ${buyerRes.data?.status || "NOT_FOUND"}, Seller: ${sellerRes.data?.status || "NOT_FOUND"}`,
      });

      // Gate 3: UBO ownership 100% for both entities (company type)
      // Carry-forward: a valid Discovery snapshot with company_exists === true and
      // operating_footprint_score >= 5 satisfies UBO completeness for that party,
      // because Discovery already cleared structural KYB to issue PASS.
      const [buyerUbo, sellerUbo] = await Promise.all([
        admin.from("ubo_links").select("ownership_percentage, status").eq("company_entity_id", poi.buyer_entity_id),
        admin.from("ubo_links").select("ownership_percentage, status").eq("company_entity_id", poi.seller_entity_id),
      ]);
      const buyerUboTotal = (buyerUbo.data || []).reduce((sum: number, o: any) => sum + Number(o.ownership_percentage || 0), 0);
      const sellerUboTotal = (sellerUbo.data || []).reduce((sum: number, o: any) => sum + Number(o.ownership_percentage || 0), 0);
      const buyerUboAllVerified = (buyerUbo.data || []).length > 0 && (buyerUbo.data || []).every((o: any) => o.status === "verified");
      const sellerUboAllVerified = (sellerUbo.data || []).length > 0 && (sellerUbo.data || []).every((o: any) => o.status === "verified");
      const buyerIsIndividual = buyerRes.data && (!buyerUbo.data || buyerUbo.data.length === 0);
      const sellerIsIndividual = sellerRes.data && (!sellerUbo.data || sellerUbo.data.length === 0);
      const buyerUboCarry =
        !!buyerDiscSnap && buyerSigs?.company_exists === true && Number(buyerSigs?.operating_footprint_score || 0) >= 5;
      const sellerUboCarry =
        !!sellerDiscSnap && sellerSigs?.company_exists === true && Number(sellerSigs?.operating_footprint_score || 0) >= 5;
      if (buyerUboCarry) recordCarry("UBO_COMPLETENESS", poi.buyer_entity_id, buyerDiscSnap!.id, "company_exists+footprint");
      if (sellerUboCarry) recordCarry("UBO_COMPLETENESS", poi.seller_entity_id, sellerDiscSnap!.id, "company_exists+footprint");
      const uboPass =
        (buyerIsIndividual || buyerUboCarry || (buyerUboTotal >= 100 && buyerUboAllVerified)) &&
        (sellerIsIndividual || sellerUboCarry || (sellerUboTotal >= 100 && sellerUboAllVerified));
      gates.push({
        gate: "UBO_COMPLETENESS",
        passed: uboPass,
        reason: uboPass
          ? "UBO ownership verified (direct evidence or Discovery carry-forward) for both parties"
          : `Buyer UBO: ${buyerIsIndividual ? "N/A (individual)" : buyerUboTotal + "%" + (buyerUboAllVerified ? " ✓" : " (unverified links)")}, Seller UBO: ${sellerIsIndividual ? "N/A (individual)" : sellerUboTotal + "%" + (sellerUboAllVerified ? " ✓" : " (unverified links)")}`,
      });

      // Gate 4: Authority-to-Bind verified for both
      // Carry-forward: a valid Discovery snapshot with authority_document_present === true
      // satisfies ATB for that party.
      const [buyerAtb, sellerAtb] = await Promise.all([
        admin.from("authority_records").select("id, status").eq("company_entity_id", poi.buyer_entity_id).eq("status", "verified").limit(1),
        admin.from("authority_records").select("id, status").eq("company_entity_id", poi.seller_entity_id).eq("status", "verified").limit(1),
      ]);
      const buyerAtbCarry = !!buyerDiscSnap && buyerSigs?.authority_document_present === true;
      const sellerAtbCarry = !!sellerDiscSnap && sellerSigs?.authority_document_present === true;
      if (buyerAtbCarry) recordCarry("AUTHORITY_TO_BIND", poi.buyer_entity_id, buyerDiscSnap!.id, "authority_document_present");
      if (sellerAtbCarry) recordCarry("AUTHORITY_TO_BIND", poi.seller_entity_id, sellerDiscSnap!.id, "authority_document_present");
      const buyerAtbOk = buyerIsIndividual || buyerAtbCarry || (buyerAtb.data && buyerAtb.data.length > 0);
      const sellerAtbOk = sellerIsIndividual || sellerAtbCarry || (sellerAtb.data && sellerAtb.data.length > 0);
      gates.push({
        gate: "AUTHORITY_TO_BIND",
        passed: !!(buyerAtbOk && sellerAtbOk),
        reason: buyerAtbOk && sellerAtbOk
          ? "Authority-to-Bind verified (direct evidence or Discovery carry-forward) for both parties"
          : `Buyer ATB: ${buyerAtbOk ? "verified" : "missing"}, Seller ATB: ${sellerAtbOk ? "verified" : "missing"}`,
      });

      // Gate 4b: Jurisdiction selection must exist and not be escalated
      const { data: jurisdictionSel } = await admin
        .from("jurisdiction_selections")
        .select("selected_jurisdiction, selection_method, escalation_reason")
        .eq("match_id", poi.match_id || poi.id)
        .eq("org_id", orgId)
        .maybeSingle();

      // Hard requirement: an explicit jurisdiction_selections record must exist.
      // Falling back to poi.jurisdiction_code silently is NOT acceptable for WaD issuance.
      const jurisdictionPass = jurisdictionSel
        ? jurisdictionSel.selection_method !== "escalated" && !!jurisdictionSel.selected_jurisdiction
        : false;
      const jurisdictionCode = jurisdictionSel?.selected_jurisdiction || poi.jurisdiction_code;
      gates.push({
        gate: "JURISDICTION_SELECTION",
        passed: jurisdictionPass,
        reason: jurisdictionPass
          ? `Jurisdiction ${jurisdictionCode} selected (${jurisdictionSel.selection_method})`
          : jurisdictionSel
            ? (jurisdictionSel.escalation_reason || `Jurisdiction selection is escalated or incomplete (method: ${jurisdictionSel.selection_method})`)
            : "No jurisdiction selection found. Complete jurisdiction selection before WaD issuance.",
      });

      // Gate 5: Mandatory governance documents validated (using selected jurisdiction)
      const { data: mandatoryDocs } = await admin
        .from("governance_doc_registry")
        .select("id, doc_type, fixed_token_burn_amount")
        .eq("org_id", orgId)
        .eq("mandatory_flag", true)
        .eq("active", true)
        .eq("jurisdiction_code", jurisdictionCode)
        .eq("industry_code", poi.industry_code);

      let govDocsPass = true;
      const missingDocs: string[] = [];
      if (mandatoryDocs && mandatoryDocs.length > 0) {
        for (const doc of mandatoryDocs) {
          const { data: govDoc } = await admin
            .from("governance_documents")
            .select("id, status")
            .eq("registry_id", doc.id)
            .eq("deal_reference_id", poi.id)
            .eq("status", "validated")
            .maybeSingle();
          if (!govDoc) {
            govDocsPass = false;
            missingDocs.push(doc.doc_type);
          }
        }
      }
      gates.push({
        gate: "GOVERNANCE_DOCUMENTS",
        passed: govDocsPass,
        reason: govDocsPass
          ? "All mandatory governance documents validated"
          : `Missing validated documents: ${missingDocs.join(", ")}`,
      });

      // Gate 6: No unresolved compliance cases
      const { data: openCases } = await admin
        .from("compliance_cases")
        .select("id")
        .eq("org_id", orgId)
        .or(`entity_id.eq.${poi.buyer_entity_id},entity_id.eq.${poi.seller_entity_id}`)
        .eq("status", "open")
        .limit(1);

      const compliancePass = !openCases || openCases.length === 0;
      gates.push({
        gate: "COMPLIANCE_CLEAR",
        passed: compliancePass,
        reason: compliancePass
          ? "No unresolved compliance cases"
          : "Unresolved compliance cases exist for one or both parties",
      });

      // Gate 7: Token balance sufficient (uses token_balances table)
      const { data: wallet } = await admin
        .from("token_balances")
        .select("balance")
        .eq("org_id", orgId)
        .maybeSingle();

      // Calculate total burn from registry fixed_token_burn_amount
      const totalBurnRequired = (mandatoryDocs || []).reduce((sum: number, d: any) => sum + (d.fixed_token_burn_amount || 0), 0);
      const tokenPass = wallet ? wallet.balance >= totalBurnRequired : totalBurnRequired === 0;
      gates.push({
        gate: "TOKEN_BALANCE",
        passed: tokenPass,
        reason: tokenPass
          ? `Token balance sufficient (required: ${totalBurnRequired}, available: ${wallet?.balance || 0})`
          : `Insufficient tokens. Required: ${totalBurnRequired}, Available: ${wallet?.balance || 0}`,
      });

      // Gate 8 (DISC-007): Discovery eligibility PASS + sanctions clear + identity verified
      {
        // Check eligibility for both buyer and seller entities
        let discoveryGatePass = true;
        let discoveryReason = "Discovery eligibility PASS for both parties";
        const entityIds = [poi.buyer_entity_id, poi.seller_entity_id].filter(Boolean);

        for (const eid of entityIds) {
          const { data: eligSnap } = await admin
            .from("discovery_eligibility_snapshots")
            .select("eligibility_status, eligibility_score, expires_at, signals")
            .eq("entity_id", eid)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!eligSnap) {
            discoveryGatePass = false;
            discoveryReason = `No discovery eligibility snapshot found for entity ${eid}`;
            break;
          }

          if (eligSnap.eligibility_status !== "PASS") {
            discoveryGatePass = false;
            discoveryReason = `Entity ${eid} eligibility is ${eligSnap.eligibility_status} (score: ${eligSnap.eligibility_score})`;
            break;
          }

          if (eligSnap.expires_at && new Date(eligSnap.expires_at) < new Date()) {
            discoveryGatePass = false;
            discoveryReason = `Entity ${eid} eligibility snapshot expired at ${eligSnap.expires_at}`;
            break;
          }

          // Check sanctions clear and identity verified from signals
          const sigs = eligSnap.signals as any;
          if (sigs?.sanctions_status === "CONFIRMED_MATCH") {
            discoveryGatePass = false;
            discoveryReason = `Entity ${eid} has CONFIRMED sanctions match`;
            break;
          }
          if (sigs?.id_verified === false) {
            discoveryGatePass = false;
            discoveryReason = `Entity ${eid} identity not verified`;
            break;
          }
        }

        gates.push({
          gate: "DISCOVERY_ELIGIBILITY",
          passed: discoveryGatePass,
          reason: discoveryReason,
        });

        // Emit blocked event if failed
        if (!discoveryGatePass) {
          await admin.from("event_store").insert({
            org_id: orgId,
            domain: "intel",
            aggregate_type: "gate",
            aggregate_id: parsed.poi_id,
            event_type: "trade.wad.blocked_by_discovery_gate",
            actor_id: authCtx.isApiKey ? null : authCtx.userId,
            payload: { poi_id: parsed.poi_id, reason: discoveryReason },
            event_hash: await computeHash(JSON.stringify({ poi_id: parsed.poi_id, gate: "discovery" })),
          });
        }
      }

      // ── Evaluate all gates ──
      const allPassed = gates.every((g) => g.passed);
      const failedGates = gates.filter((g) => !g.passed);

      if (!allPassed) {
        const responseData = {
          status: "ERROR",
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          error: {
            code: "HARD_GATE_FAILED",
            message: `${failedGates.length} hard-gate(s) failed`,
            gates,
          },
        };

        // Record denial in p3_wads
        await admin.from("p3_wads").insert({
          org_id: orgId,
          poi_id: parsed.poi_id,
          state: "DENIED",
          denial_reasons: failedGates.map((g) => ({ gate: g.gate, reason: g.reason })),
        });

        // ── Batch I Fix 5: UBO incomplete → durable compliance follow-up ──
        // Create an idempotent dd_approval_requests row + audit so admins have
        // a queue item, not just a 422 toast for the end user.
        const uboFailed = failedGates.find((g) => g.gate === "UBO_COMPLETENESS");
        if (uboFailed) {
          const todayUtc = new Date().toISOString().slice(0, 10);
          const dedupKey = `ubo_incomplete:${orgId}:${parsed.poi_id}:${todayUtc}`;
          await admin
            .from("dd_approval_requests")
            .upsert(
              {
                target_org_id: orgId,
                requesting_org_id: orgId,
                status: "pending",
                required_roles: ["compliance_analyst"],
                reason: `UBO completeness gate failed at WaD time: ${uboFailed.reason}`,
                kind: "ubo_incomplete",
                dedup_key: dedupKey,
                metadata: {
                  poi_id: parsed.poi_id,
                  buyer_entity_id: poi.buyer_entity_id,
                  seller_entity_id: poi.seller_entity_id,
                  reason: uboFailed.reason,
                  correlation_id: correlationId,
                },
              },
              { onConflict: "dedup_key", ignoreDuplicates: true },
            );

          await admin.from("audit_logs").insert({
            org_id: orgId,
            actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
            action: "wad.ubo_incomplete.queued",
            entity_type: "poi",
            entity_id: parsed.poi_id,
            metadata: {
              reason: uboFailed.reason,
              dedup_key: dedupKey,
              correlation_id: correlationId,
            },
          });
        }

        // Record event
        await admin.from("event_store").insert({
          org_id: orgId,
          domain: "trust",
          aggregate_type: "wad",
          aggregate_id: parsed.poi_id,
          event_type: "trust.wad.denied",
          actor_id: authCtx.isApiKey ? null : authCtx.userId,
          actor_role: authCtx.roles?.[0] || null,
          payload: { failed_gates: failedGates.map((g) => g.gate) },
          event_hash: await computeHash(JSON.stringify(failedGates)),
        });

        return new Response(JSON.stringify(responseData), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // All gates passed — propagate jurisdiction selection to the POI record
      if (jurisdictionSel?.selected_jurisdiction && jurisdictionSel.selected_jurisdiction !== poi.jurisdiction_code) {
        await admin
          .from("pois")
          .update({ jurisdiction_code: jurisdictionSel.selected_jurisdiction })
          .eq("id", parsed.poi_id);
      }

      // Issue WaD
      const { data: wad, error: wadError } = await admin
        .from("p3_wads")
        .insert({
          org_id: orgId,
          poi_id: parsed.poi_id,
          state: "ISSUED",
          issued_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (wadError) throw new ApiException("INTERNAL_ERROR", wadError.message, 500);

      // Record event
      await admin.from("event_store").insert({
        org_id: orgId,
        domain: "trust",
        aggregate_type: "wad",
        aggregate_id: wad.id,
        event_type: "trust.wad.issued",
        actor_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_role: authCtx.roles?.[0] || null,
        payload: { poi_id: parsed.poi_id, gates_passed: gates.length, carry_forward: carryForwardLog },
        event_hash: await computeHash(JSON.stringify({ wad_id: wad.id })),
      });

      const responseData = successEnvelope(
        {
          wad_id: wad.id,
          poi_id: wad.poi_id,
          state: wad.state,
          issued_at: wad.issued_at,
          hard_gates: gates,
          carry_forward: carryForwardLog,
        },
        correlationId
      );

      // Store idempotency key
      await admin.from("idempotency_keys").insert({
        org_id: orgId,
        idempotency_key: idempotencyKey,
        endpoint: "p3-wad",
        request_hash: await computeHash(JSON.stringify(parsed)),
        response_data: responseData,
        response_status_code: 201,
      });

      return new Response(JSON.stringify(responseData), {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GET: List / Get WaDs ──
    if (req.method === "GET") {
      const wadId = url.searchParams.get("wad_id");

      if (wadId) {
        const { data: wad, error } = await admin
          .from("p3_wads")
          .select("*")
          .eq("id", wadId)
          .eq("org_id", orgId)
          .maybeSingle();

        if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);
        if (!wad) throw new ApiException("NOT_FOUND", "WaD not found", 404);

        // Fetch attestations
        const { data: attestations } = await admin
          .from("p3_attestations")
          .select("*")
          .eq("wad_id", wadId)
          .order("signed_at", { ascending: true });

        return new Response(
          JSON.stringify(successEnvelope({ ...wad, attestations: attestations || [] }, correlationId)),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: wads, error } = await admin
        .from("p3_wads")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      return new Response(JSON.stringify(successEnvelope(wads || [], correlationId)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new ApiException("VALIDATION_ERROR", "Method not allowed", 405);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return new Response(
        JSON.stringify({
          status: "ERROR",
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          error: { code: "VALIDATION_ERROR", message: err.errors.map((e) => e.message).join(", ") },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (err instanceof ApiException) {
      return new Response(
        JSON.stringify({
          status: "ERROR",
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          error: { code: err.code, message: err.message },
        }),
        { status: err.statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({
        status: "ERROR",
        timestamp: new Date().toISOString(),
        correlation_id: correlationId,
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function computeHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
