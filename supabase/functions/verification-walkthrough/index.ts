/**
 * verification-walkthrough
 *
 * Operational proof harness for the strict-verification repair block.
 * Lets a platform admin:
 *
 *   action=seed       -> create a real, isolated synthetic match + intel row
 *                        + pending operator_verification_request, all tagged
 *                        as walkthrough fixtures so they can be cleaned up.
 *
 *   action=invariants -> run INV-B / INV-D / INV-G across the full live
 *                        production data set and return violation counts +
 *                        universe sizes so vacuous passes can be distinguished
 *                        from substantive ones.
 *
 *   action=cleanup    -> delete the walkthrough fixtures (and their audit
 *                        rows) created by this admin via `seed`.
 *
 * All actions require:
 *   • a valid Supabase JWT (verified in code, not via gateway)
 *   • the calling user to hold the `platform_admin` role
 *
 * The completion step itself is performed by the existing
 * AdminVerificationQueuePanel "Action" dialog — this function never closes
 * a request on the admin's behalf, so the audit row INV-G inspects is
 * written by the same code path real admins use in production.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const FIXTURE_TAG = "walkthrough_fixture_v1";

// Match states we treat as "non-open" for INV-B / INV-D.
const NON_OPEN_STATES = ["sealed", "cancelled", "expired", "closed", "declined", "rejected"];
const NON_OPEN_STATUSES = [...NON_OPEN_STATES, "settled"];

interface AuthCtx {
  userId: string;
  service: SupabaseClient;
  req: Request;
}

async function authenticate(req: Request): Promise<AuthCtx | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(req, { error: "missing_bearer_token" }, 401);
  }
  const token = authHeader.slice("Bearer ".length);

  // Use anon client to verify JWT identity (verify_jwt=false on this function).
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json(req, { error: "invalid_token" }, 401);
  }
  const userId = userData.user.id;

  // Service-role client for the actual work + role check via has_role().
  const service = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: hasRole, error: roleErr } = await service.rpc("has_role", {
    _user_id: userId,
    _role: "platform_admin",
  });
  if (roleErr || hasRole !== true) {
    return json(req, { error: "platform_admin_required" }, 403);
  }

  return { userId, service, req };
}

function json(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  }));
}

async function actionSeed(ctx: AuthCtx) {
  const { service, userId } = ctx;

  // Resolve the admin's profile/org so the synthetic match + intel + audit
  // rows respect existing NOT NULL constraints and RLS scoping.
  const { data: profile, error: profileErr } = await service
    .from("profiles")
    .select("id, org_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr || !profile?.org_id) {
    return json(ctx.req, { error: "no_org_context", detail: profileErr?.message ?? null }, 400);
  }
  const orgId = profile.org_id as string;

  const stamp = Date.now();
  const subjectName = `Walkthrough Subject ${stamp}`;
  const buyerName = `Walkthrough Buyer ${stamp}`;
  const sellerName = `Walkthrough Seller ${stamp}`;

  // 1) Synthetic match. We deliberately leave it in 'open' state so it
  //    qualifies as the parent of a *valid* pending OVR (INV-B should still
  //    show 0 violations after seeding — the seed must not create a violation).
  const { data: matchRow, error: matchErr } = await service
    .from("matches")
    .insert({
      org_id: orgId,
      created_by: userId,
      buyer_name: buyerName,
      seller_name: sellerName,
      buyer_id: `walkthrough-${stamp}-buyer`,
      seller_id: `walkthrough-${stamp}-seller`,
      commodity: "WALKTHROUGH_FIXTURE",
      status: "open",
      state: "open",
      hash: `walkthrough-${stamp}`,
      metadata: { fixture: FIXTURE_TAG, created_by_walkthrough: userId },
    })
    .select("id")
    .single();
  if (matchErr) return json(ctx.req, { error: "seed_match_failed", detail: matchErr.message }, 500);

  const matchId = matchRow.id as string;

  // 2) Counterparty intel row attached to the open match. Will let INV-D
  //    show a non-zero universe (intel_total > 0) instead of vacuous pass.
  const { data: intelRow, error: intelErr } = await service
    .from("match_counterparty_intel")
    .insert({
      match_id: matchId,
      org_id: orgId,
      side: "buyer",
      counterparty_name: buyerName,
      website_url: "https://example.com/walkthrough",
      linkedin_url: "https://www.linkedin.com/company/walkthrough-fixture",
      notes: `[${FIXTURE_TAG}] seeded by walkthrough harness`,
      created_by: userId,
    })
    .select("id")
    .single();
  if (intelErr) {
    // Roll back the match so we don't leave orphans on a partial failure.
    await service.from("matches").delete().eq("id", matchId);
    return json(ctx.req, { error: "seed_intel_failed", detail: intelErr.message }, 500);
  }

  // 3) Pending operator_verification_request. This is what the admin will
  //    later complete via the existing Action dialog, producing the audit row
  //    that converts INV-G from vacuous to substantive.
  const { data: ovrRow, error: ovrErr } = await service
    .from("operator_verification_requests")
    .insert({
      match_id: matchId,
      org_id: orgId,
      subject_name: subjectName,
      kind: "org",
      status: "pending",
      reason: `[${FIXTURE_TAG}] Walkthrough harness — safe to action and then cleanup.`,
      raised_by: userId,
    })
    .select("id")
    .single();
  if (ovrErr) {
    await service.from("match_counterparty_intel").delete().eq("id", intelRow.id);
    await service.from("matches").delete().eq("id", matchId);
    return json(req, { error: "seed_ovr_failed", detail: ovrErr.message }, 500);
  }

  return json(req, {
    ok: true,
    fixture: FIXTURE_TAG,
    match_id: matchId,
    intel_id: intelRow.id,
    request_id: ovrRow.id,
    subject_name: subjectName,
  });
}

async function actionInvariants(ctx: AuthCtx) {
  const { service, userId } = ctx;

  // Resolve the admin's profile/org so the synthetic match + intel + audit
  // rows respect existing NOT NULL constraints and RLS scoping.
  const { data: profile, error: profileErr } = await service
    .from("profiles")
    .select("id, org_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr || !profile?.org_id) {
    return json(ctx.req, { error: "no_org_context", detail: profileErr?.message ?? null }, 400);
  }
  const orgId = profile.org_id as string;

  const stamp = Date.now();
  const subjectName = `Walkthrough Subject ${stamp}`;
  const buyerName = `Walkthrough Buyer ${stamp}`;
  const sellerName = `Walkthrough Seller ${stamp}`;

  // 1) Synthetic match. We deliberately leave it in 'open' state so it
  //    qualifies as the parent of a *valid* pending OVR (INV-B should still
  //    show 0 violations after seeding — the seed must not create a violation).
  const { data: matchRow, error: matchErr } = await service
    .from("matches")
    .insert({
      org_id: orgId,
      created_by: userId,
      buyer_name: buyerName,
      seller_name: sellerName,
      buyer_id: `walkthrough-${stamp}-buyer`,
      seller_id: `walkthrough-${stamp}-seller`,
      commodity: "WALKTHROUGH_FIXTURE",
      status: "open",
      state: "open",
      hash: `walkthrough-${stamp}`,
      metadata: { fixture: FIXTURE_TAG, created_by_walkthrough: userId },
    })
    .select("id")
    .single();
  if (matchErr) return json(ctx.req, { error: "seed_match_failed", detail: matchErr.message }, 500);

  const matchId = matchRow.id as string;

  // 2) Counterparty intel row attached to the open match. Will let INV-D
  //    show a non-zero universe (intel_total > 0) instead of vacuous pass.
  const { data: intelRow, error: intelErr } = await service
    .from("match_counterparty_intel")
    .insert({
      match_id: matchId,
      org_id: orgId,
      side: "buyer",
      counterparty_name: buyerName,
      website_url: "https://example.com/walkthrough",
      linkedin_url: "https://www.linkedin.com/company/walkthrough-fixture",
      notes: `[${FIXTURE_TAG}] seeded by walkthrough harness`,
      created_by: userId,
    })
    .select("id")
    .single();
  if (intelErr) {
    // Roll back the match so we don't leave orphans on a partial failure.
    await service.from("matches").delete().eq("id", matchId);
    return json(ctx.req, { error: "seed_intel_failed", detail: intelErr.message }, 500);
  }

  // 3) Pending operator_verification_request. This is what the admin will
  //    later complete via the existing Action dialog, producing the audit row
  //    that converts INV-G from vacuous to substantive.
  const { data: ovrRow, error: ovrErr } = await service
    .from("operator_verification_requests")
    .insert({
      match_id: matchId,
      org_id: orgId,
      subject_name: subjectName,
      kind: "org",
      status: "pending",
      reason: `[${FIXTURE_TAG}] Walkthrough harness — safe to action and then cleanup.`,
      raised_by: userId,
    })
    .select("id")
    .single();
  if (ovrErr) {
    await service.from("match_counterparty_intel").delete().eq("id", intelRow.id);
    await service.from("matches").delete().eq("id", matchId);
    return json(req, { error: "seed_ovr_failed", detail: ovrErr.message }, 500);
  }

  return json(req, {
    ok: true,
    fixture: FIXTURE_TAG,
    match_id: matchId,
    intel_id: intelRow.id,
    request_id: ovrRow.id,
    subject_name: subjectName,
  });
}

async function actionInvariants(ctx: AuthCtx) {
  const { service } = ctx;

  // Universe sizes.
  const [
    { count: ovrTotal },
    { count: ovrPending },
    { count: ovrClosed },
    { count: intelTotal },
    { count: matchesTotal },
  ] = await Promise.all([
    service.from("operator_verification_requests").select("*", { count: "exact", head: true }),
    service.from("operator_verification_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
    service.from("operator_verification_requests").select("*", { count: "exact", head: true }).in("status", ["completed", "cancelled"]),
    service.from("match_counterparty_intel").select("*", { count: "exact", head: true }),
    service.from("matches").select("*", { count: "exact", head: true }),
  ]);

  // Build a non-open match id set (cap at 5000; if your matches table grows
  // beyond that we'd swap this for a server-side RPC).
  const { data: nonOpenMatches, error: nonOpenErr } = await service
    .from("matches")
    .select("id")
    .or(
      [
        `state.in.(${NON_OPEN_STATES.join(",")})`,
        `status.in.(${NON_OPEN_STATUSES.join(",")})`,
      ].join(","),
    )
    .limit(5000);
  if (nonOpenErr) return json(req, { error: "non_open_query_failed", detail: nonOpenErr.message }, 500);
  const nonOpenIds = (nonOpenMatches ?? []).map((r) => r.id as string);

  // INV-B: pending OVRs whose parent match is non-open.
  let invBViolations = 0;
  if (nonOpenIds.length > 0) {
    const { count, error } = await service
      .from("operator_verification_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
      .in("match_id", nonOpenIds);
    if (error) return json(req, { error: "inv_b_failed", detail: error.message }, 500);
    invBViolations = count ?? 0;
  }

  // INV-D: intel rows whose parent match is non-open.
  let invDViolations = 0;
  if (nonOpenIds.length > 0) {
    const { count, error } = await service
      .from("match_counterparty_intel")
      .select("*", { count: "exact", head: true })
      .in("match_id", nonOpenIds);
    if (error) return json(req, { error: "inv_d_failed", detail: error.message }, 500);
    invDViolations = count ?? 0;
  }

  // INV-G: completed/cancelled OVRs without an audit_logs entry.
  // Pull closed OVR ids (cap 5000), then check which appear in audit_logs.
  let invGViolations = 0;
  let invGSampleMissing: string[] = [];
  const { data: closedOvrs, error: closedErr } = await service
    .from("operator_verification_requests")
    .select("id")
    .in("status", ["completed", "cancelled"])
    .limit(5000);
  if (closedErr) return json(req, { error: "inv_g_query_failed", detail: closedErr.message }, 500);
  const closedIds = (closedOvrs ?? []).map((r) => r.id as string);
  if (closedIds.length > 0) {
    const { data: audited, error: audErr } = await service
      .from("audit_logs")
      .select("entity_id")
      .eq("entity_type", "operator_verification_request")
      .in("entity_id", closedIds);
    if (audErr) return json(req, { error: "inv_g_audit_failed", detail: audErr.message }, 500);
    const auditedSet = new Set((audited ?? []).map((r) => r.entity_id as string));
    const missing = closedIds.filter((id) => !auditedSet.has(id));
    invGViolations = missing.length;
    invGSampleMissing = missing.slice(0, 5);
  }

  return json(req, {
    ok: true,
    universe: {
      ovr_total: ovrTotal ?? 0,
      ovr_pending: ovrPending ?? 0,
      ovr_closed: ovrClosed ?? 0,
      intel_total: intelTotal ?? 0,
      matches_total: matchesTotal ?? 0,
      matches_non_open: nonOpenIds.length,
    },
    invariants: {
      inv_b: {
        name: "Pending verification on non-open match",
        violations: invBViolations,
        substantive: (ovrPending ?? 0) > 0 && nonOpenIds.length > 0,
      },
      inv_d: {
        name: "Intel attached to non-open match",
        violations: invDViolations,
        substantive: (intelTotal ?? 0) > 0 && nonOpenIds.length > 0,
      },
      inv_g: {
        name: "Closed verification missing audit row",
        violations: invGViolations,
        substantive: closedIds.length > 0,
        sample_missing: invGSampleMissing,
      },
    },
  });
}

async function actionCleanup(ctx: AuthCtx) {
  const { service, userId } = ctx;

  // Find every fixture match created by this admin via the walkthrough.
  const { data: fixtureMatches, error: findErr } = await service
    .from("matches")
    .select("id")
    .eq("created_by", userId)
    .eq("commodity", "WALKTHROUGH_FIXTURE");
  if (findErr) return json(ctx.req, { error: "cleanup_find_failed", detail: findErr.message }, 500);

  const matchIds = (fixtureMatches ?? []).map((r) => r.id as string);
  if (matchIds.length === 0) {
    return json(ctx.req, { ok: true, deleted: { matches: 0, intel: 0, requests: 0, audits: 0 } });
  }

  // Find OVR ids before deletion so we can sweep their audit_logs entries.
  const { data: ovrs } = await service
    .from("operator_verification_requests")
    .select("id")
    .in("match_id", matchIds);
  const ovrIds = (ovrs ?? []).map((r) => r.id as string);

  let auditDeleted = 0;
  if (ovrIds.length > 0) {
    const { error: auditDelErr, count } = await service
      .from("audit_logs")
      .delete({ count: "exact" })
      .eq("entity_type", "operator_verification_request")
      .in("entity_id", ovrIds);
    if (auditDelErr) return json(ctx.req, { error: "cleanup_audit_failed", detail: auditDelErr.message }, 500);
    auditDeleted = count ?? 0;
  }

  const { error: ovrDelErr, count: ovrCount } = await service
    .from("operator_verification_requests")
    .delete({ count: "exact" })
    .in("match_id", matchIds);
  if (ovrDelErr) return json(ctx.req, { error: "cleanup_ovr_failed", detail: ovrDelErr.message }, 500);

  const { error: intelDelErr, count: intelCount } = await service
    .from("match_counterparty_intel")
    .delete({ count: "exact" })
    .in("match_id", matchIds);
  if (intelDelErr) return json(ctx.req, { error: "cleanup_intel_failed", detail: intelDelErr.message }, 500);

  const { error: matchDelErr, count: matchCount } = await service
    .from("matches")
    .delete({ count: "exact" })
    .in("id", matchIds);
  if (matchDelErr) return json(ctx.req, { error: "cleanup_match_failed", detail: matchDelErr.message }, 500);

  return json(ctx.req, {
    ok: true,
    deleted: {
      matches: matchCount ?? 0,
      intel: intelCount ?? 0,
      requests: ovrCount ?? 0,
      audits: auditDeleted,
    },
  });
}

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req); if (__pf) return __pf;
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;

  let body: { action?: string };
  try {
    body = await req.json(req, );
  } catch {
    return json(req, { error: "invalid_json" }, 400);
  }

  switch (body.action) {
    case "seed":
      return await actionSeed(auth);
    case "invariants":
      return await actionInvariants(auth);
    case "cleanup":
      return await actionCleanup(auth);
    default:
      return json(req, { error: "unknown_action", allowed: ["seed", "invariants", "cleanup"] }, 400);
  }
});
