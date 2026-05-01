/**
 * Admin Org Reconciliation Report — read-only diagnostic endpoint.
 *
 * Purpose: pulls every signal that determines whether an org SHOULD be
 * able to mint POIs / contact counterparties under Izenzo's name, plus
 * the receipts that show whether it ACTUALLY did, so an operator can
 * spot contradictions in seconds instead of stitching half a dozen
 * tables together by hand.
 *
 * Background: a recent audit found two POIs minted by an org with no
 * `trade_approvals` row at all (server-side gate was missing on /pois;
 * since fixed). This endpoint exists so that defect class never has to
 * be discovered via incident again — any operator can spot-check any
 * org and the report renders the contradiction explicitly.
 *
 * Auth: requires the caller to satisfy public.is_admin() (platform admin
 * or auditor — same gate used by every other /admin-* function in this
 * project). No service-role bypass — the caller's JWT is verified.
 *
 * Method: GET /admin-org-reconciliation?org_id=<uuid>
 *
 * Returns: structured JSON with sections:
 *   - org                : organisation row (status / frozen / legal_name)
 *   - trade_approval     : current approval row + computed validity
 *   - kyb                : entity / owners / docs completeness counts
 *   - legitimacy         : authoritative verdict from the shared gate
 *                          (the same one the /pois endpoint enforces)
 *   - recent_pois        : last 10 POIs with state + creation timestamp
 *   - token_ledger       : last 10 ledger rows (mint / debit / refund)
 *   - audit_logs         : last 10 audit entries (mint denials, etc.)
 *   - contradictions     : derived flags pointing at obvious mismatches
 *
 * Contradictions explicitly checked (exit early if true):
 *   - POI rows exist but trade_approval is missing / not approved / expired
 *   - Org marked frozen but recent POIs were minted after the freeze
 *   - Legitimacy verdict says "allowed" but no approval row exists
 *     (or vice versa: "blocked" but POIs were minted recently anyway)
 *   - KYB documents present but no entity record (orphan docs)
 *   - UBO records sum to <25% (under common KYB thresholds) yet
 *     the org has approved trade approval
 *
 * The endpoint is intentionally READ-ONLY — it runs only SELECTs and
 * never mutates state. It is also intentionally verbose: every section
 * returns the raw rows alongside the derived flags so an operator can
 * verify the reasoning rather than trusting the summary blindly.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  checkOrgLegitimacy,
  getActiveGovernanceProfile,
} from "../_shared/legitimacy.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonResponse(req, req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  }));
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;

  if (req.method !== "GET") {
    return jsonResponse(req, req, { error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Auth: verify the caller is a platform admin / auditor ──────────
    const authHeader =
      req.headers.get("Authorization") ?? req.headers.get("authorisation");
    if (!authHeader) {
      return jsonResponse(req, { error: "Unauthorised" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } =
      await admin.auth.getUser(token);
    if (authError || !caller) {
      return jsonResponse(req, { error: "Invalid token" }, 401);
    }

    const { data: isAdmin } = await admin.rpc("is_admin", {
      user_id: caller.id,
    });
    if (!isAdmin) {
      return jsonResponse(req, { error: "Admin access required" }, 403);
    }

    // ── Validate the org_id query param ────────────────────────────────
    const url = new URL(req.url);
    const orgId = url.searchParams.get("org_id");
    if (!orgId || !UUID_RE.test(orgId)) {
      return jsonResponse(req, { error: "Missing or malformed org_id query parameter (expected UUID)" },
        400,
      );
    }

    // ── Pull every section in parallel ─────────────────────────────────
    // Limit: 10 most recent rows for each timeline-style section. Enough
    // to spot a pattern, small enough to keep the response under a few KB
    // and to avoid hitting the default 1000-row Supabase fetch ceiling.
    const RECENT_LIMIT = 10;

    const [
      orgResult,
      approvalsResult,
      entitiesResult,
      ownersResult,
      docsResult,
      poisResult,
      ledgerResult,
      auditResult,
      legitimacy,
    ] = await Promise.all([
      admin
        .from("organizations")
        .select(
          "id, name, legal_name, status, frozen, frozen_at, frozen_reason, created_at, updated_at",
        )
        .eq("id", orgId)
        .maybeSingle(),
      admin
        .from("trade_approvals")
        .select("id, status, risk_band, approved_at, valid_until, updated_at")
        .eq("org_id", orgId)
        .order("updated_at", { ascending: false }),
      admin
        .from("entities")
        .select(
          "id, entity_type, legal_name, jurisdiction_code, registration_number, status, updated_at",
        )
        .eq("org_id", orgId),
      admin
        .from("ubo_records")
        .select("id, full_name, ownership_percentage, status, updated_at")
        .eq("org_id", orgId),
      admin
        .from("kyc_documents")
        .select(
          "id, doc_type, status, expiry_date, verified_at, created_at",
        )
        .eq("org_id", orgId),
      admin
        .from("pois")
        .select(
          "id, state, completion_probability, industry_code, jurisdiction_code, created_at",
        )
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(RECENT_LIMIT),
      admin
        .from("token_ledger")
        .select(
          "id, action_type, endpoint, tokens_burned, outcome, remaining_balance, created_at",
        )
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(RECENT_LIMIT),
      admin
        .from("audit_logs")
        .select(
          "id, action, entity_type, entity_id, actor_user_id, metadata, created_at",
        )
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(RECENT_LIMIT),
      // The legitimacy gate consults trade_approvals + governance_profiles
      // and is the EXACT same code path that /pois enforces server-side.
      // Calling it here means the report cannot drift from the live gate.
      checkOrgLegitimacy(admin, orgId, "poi_mint"),
    ]);

    if (orgResult.error) {
      return jsonResponse(req, { error: "Failed to load organisation", detail: orgResult.error.message },
        500,
      );
    }
    if (!orgResult.data) {
      return jsonResponse(req, { error: "Org not found", org_id: orgId }, 404);
    }

    const org = orgResult.data;
    const allApprovals = approvalsResult.data ?? [];
    const currentApproval = allApprovals[0] ?? null;
    const entities = entitiesResult.data ?? [];
    const owners = ownersResult.data ?? [];
    const docs = docsResult.data ?? [];
    const recentPois = poisResult.data ?? [];
    const ledger = ledgerResult.data ?? [];
    const auditLogs = auditResult.data ?? [];

    // ── Derived approval window state ──────────────────────────────────
    const now = new Date();
    const approvalState = (() => {
      if (!currentApproval) return "missing";
      if (currentApproval.status !== "approved") return currentApproval.status;
      if (
        currentApproval.valid_until &&
        new Date(currentApproval.valid_until) < now
      ) {
        return "expired";
      }
      return "approved";
    })();

    // ── Derived KYB completeness ───────────────────────────────────────
    // Mirrors the rules used in CompanyIdentityTab: an entity row is
    // required, declared owners must sum to ≥25%, and at least one
    // verified document is expected. We don't fail on these — we surface
    // them so the operator can compare against the legitimacy verdict.
    const totalOwnership = owners.reduce(
      (sum, o) => sum + Number(o.ownership_percentage ?? 0),
      0,
    );
    const verifiedDocs = docs.filter(
      (d) => d.status === "verified" || d.status === "approved",
    ).length;
    const kyb = {
      entity_present: entities.length > 0,
      entity_count: entities.length,
      owner_count: owners.length,
      total_declared_ownership_pct: Number(totalOwnership.toFixed(2)),
      docs_total: docs.length,
      docs_verified: verifiedDocs,
      ubo_threshold_met: totalOwnership >= 25,
    };

    // ── Resolve the governance profile separately so the operator can
    //    see WHICH gate posture is active (entry / poi_mint / wad_only).
    const profile = await getActiveGovernanceProfile(admin, orgId);

    // ── Contradiction detector ─────────────────────────────────────────
    // Each entry includes the raw signal pair so an operator can verify
    // the conclusion, not just trust it. New rules are cheap to add —
    // think of this as an evolving lint suite for the trust graph.
    const contradictions: Array<{
      severity: "high" | "medium" | "low";
      code: string;
      message: string;
      evidence: Record<string, unknown>;
    }> = [];

    if (recentPois.length > 0 && approvalState !== "approved") {
      contradictions.push({
        severity: "high",
        code: "pois_without_active_approval",
        message:
          "Recent POIs exist but trade_approvals is missing / not approved / expired. " +
          "These POIs would not be allowed under the current server-side gate.",
        evidence: {
          recent_poi_count: recentPois.length,
          oldest_recent_poi: recentPois[recentPois.length - 1]?.created_at,
          newest_recent_poi: recentPois[0]?.created_at,
          trade_approval_state: approvalState,
        },
      });
    }

    if (org.frozen && recentPois.length > 0 && org.frozen_at) {
      const frozenAt = new Date(org.frozen_at);
      const minted_after_freeze = recentPois.filter(
        (p) => new Date(p.created_at) > frozenAt,
      );
      if (minted_after_freeze.length > 0) {
        contradictions.push({
          severity: "high",
          code: "pois_minted_after_freeze",
          message:
            "Org is marked frozen but POIs were minted after the freeze timestamp.",
          evidence: {
            frozen_at: org.frozen_at,
            frozen_reason: org.frozen_reason,
            minted_after_freeze_count: minted_after_freeze.length,
            sample_poi_ids: minted_after_freeze.slice(0, 3).map((p) => p.id),
          },
        });
      }
    }

    if (legitimacyVerdictContradictsHistory(governanceProfile, recentPois, approvalState)) {
      contradictions.push({
        severity: "high",
        code: "legitimacy_verdict_contradicts_mint_history",
        message:
          governanceProfile.allowed
            ? "Legitimacy gate currently says ALLOWED but trade_approvals is not in an approved state — investigate gate posture or stale cache."
            : "Legitimacy gate currently says BLOCKED but POIs were minted recently — confirm the /pois server-side gate is wired (this defect class shipped in production until recently).",
        evidence: {
          legitimacy_verdict: governanceProfile,
          trade_approval_state: approvalState,
          recent_poi_count: recentPois.length,
        },
      });
    }

    if (docs.length > 0 && entities.length === 0) {
      contradictions.push({
        severity: "medium",
        code: "orphan_kyc_docs",
        message:
          "KYC documents exist for this org but no entity record is present — docs are not attached to anything verifiable.",
        evidence: { doc_count: docs.length, entity_count: 0 },
      });
    }

    if (
      approvalState === "approved" &&
      owners.length > 0 &&
      totalOwnership < 25
    ) {
      contradictions.push({
        severity: "medium",
        code: "ubo_below_threshold_with_active_approval",
        message:
          "Trade approval is active but declared beneficial ownership sums to <25%. Most KYB regimes require ≥25% identified.",
        evidence: {
          total_declared_ownership_pct: Number(totalOwnership.toFixed(2)),
          owner_count: owners.length,
        },
      });
    }

    // ── Compose response ───────────────────────────────────────────────
    return jsonResponse(req, {
      generated_at: new Date().toISOString(),
      org_id: orgId,
      org: {
        ...org,
        // Surface the operational state in plain English so the report
        // skims well for non-technical reviewers.
        operational_status: org.frozen
          ? `frozen (${org.frozen_reason ?? "no reason recorded"})`
          : (org.status ?? "unknown"),
      },
      trade_approval: {
        current: currentApproval,
        derived_state: approvalState,
        history_count: allApprovals.length,
      },
      kyb,
      legitimacy: {
        verdict: governanceProfile,
        active_governance_profile: profile,
      },
      recent_pois: recentPois,
      token_ledger: ledger,
      audit_logs: auditLogs,
      contradictions,
    });
  } catch (err) {
    console.error("[admin-org-reconciliation] failure:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
});

/**
 * The legitimacy gate's verdict is the source of truth for what /pois
 * will accept right now. If that verdict says "allowed" but no approval
 * exists, the gate is reading from somewhere unexpected (cached, wrong
 * org, governance profile override). If it says "blocked" but POIs were
 * minted recently, the server-side gate at the mint endpoint is missing
 * or being bypassed — exactly the defect class that shipped in production
 * until the /pois fix landed.
 */
function legitimacyVerdictContradictsHistory(
  legitimacy: Awaited<ReturnType<typeof checkOrgLegitimacy>>,
  recentPois: Array<{ created_at: string }>,
  approvalState: string,
): boolean {
  if (legitimacy.allowed && approvalState !== "approved" && approvalState !== "deferred") {
    return true;
  }
  if (!legitimacy.allowed && recentPois.length > 0) {
    // Only flag if any POI is recent enough to post-date the gate
    // becoming live — give a 30 day grace window to avoid false alarms
    // on historical pre-gate data.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    if (recentPois.some((p) => new Date(p.created_at).getTime() > cutoff)) {
      return true;
    }
  }
  return false;
}
