/**
 * facilitation-management-metrics — Batch 8 management metrics.
 *
 * Allowed roles: platform_admin OR compliance_analyst.
 *
 * Returns a flat metrics object. Any metric whose underlying timestamps do
 * not exist yet (e.g. no closed cases this period) is returned as `null`
 * so the UI can show "Not available yet" — never guessed.
 *
 * No mutations. No outreach.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { handleHealthProbe } from "../_shared/health.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(req: Request, body: unknown, status = 200) {
  return withCors(req, new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  }));
}

const HOUR_MS = 36e5;
function avgHours(rows: { a: string | null; b: string | null }[]): number | null {
  const diffs: number[] = [];
  for (const { a, b } of rows) {
    if (!a || !b) continue;
    const d = new Date(b).getTime() - new Date(a).getTime();
    if (isFinite(d) && d >= 0) diffs.push(d / HOUR_MS);
  }
  if (diffs.length === 0) return null;
  return Math.round((diffs.reduce((s, x) => s + x, 0) / diffs.length) * 10) / 10;
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  const __hp = handleHealthProbe(req, "facilitation-management-metrics");
  if (__hp) return __hp;
  if (req.method !== "POST" && req.method !== "GET") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json(req, { error: "Unauthorized" }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: cerr } = await userClient.auth.getClaims(token);
  if (cerr || !claims?.claims?.sub) return json(req, { error: "Unauthorized" }, 401);
  const userId = claims.claims.sub as string;

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["platform_admin", "compliance_analyst"])
    .maybeSingle();
  if (!roleRow) return json(req, { error: "Forbidden" }, 403);

  // ── Pull a single working dataset; small enough for in-memory aggregation.
  const { data: cases, error } = await admin
    .from("facilitation_cases")
    .select(
      [
        "id",
        "internal_status",
        "case_owner_id",
        "created_at",
        "closed_at",
        "is_overdue",
        "overdue_reasons",
        "counterparty_country",
        "sector",
        "final_outcome",
        "info_request_response_at",
        "info_request_requested_at",
        "ready_for_poi_at",
        "poi_conversion_recorded_at",
        "next_action_due_at",
      ].join(","),
    )
    .limit(10000);
  if (error) return json(req, { error: error.message }, 500);
  const list = (cases ?? []) as Record<string, string | boolean | null>[];

  const now = Date.now();
  const weekAgo = now - 7 * 24 * HOUR_MS;
  const monthAgo = now - 30 * 24 * HOUR_MS;

  const open = list.filter((c) => !c.closed_at).length;
  const newThisWeek = list.filter((c) => c.created_at && new Date(c.created_at as string).getTime() >= weekAgo).length;
  const newThisMonth = list.filter((c) => c.created_at && new Date(c.created_at as string).getTime() >= monthAgo).length;
  const overdue = list.filter((c) => c.is_overdue === true).length;

  // ── Event-driven averages (owner assignment, triage, first outreach).
  const caseIds = list.map((c) => c.id as string);
  let firstOwnerAssignedById = new Map<string, string>();
  let firstTriageReviewedById = new Map<string, string>();
  let firstOutreachReadyById = new Map<string, string>();
  if (caseIds.length > 0) {
    const { data: evs } = await admin
      .from("facilitation_case_events")
      .select("case_id, action, created_at")
      .in("case_id", caseIds)
      .in("action", [
        "facilitation_case.assigned",
        "facilitation_case.status_changed",
        "facilitation_case.contact_attempt_recorded",
      ])
      .order("created_at", { ascending: true })
      .limit(10000);
    for (const e of (evs ?? []) as { case_id: string; action: string; created_at: string }[]) {
      if (e.action === "facilitation_case.assigned" && !firstOwnerAssignedById.has(e.case_id)) {
        firstOwnerAssignedById.set(e.case_id, e.created_at);
      }
      if (e.action === "facilitation_case.status_changed" && !firstTriageReviewedById.has(e.case_id)) {
        firstTriageReviewedById.set(e.case_id, e.created_at);
      }
      if (e.action === "facilitation_case.contact_attempt_recorded" && !firstOutreachReadyById.has(e.case_id)) {
        firstOutreachReadyById.set(e.case_id, e.created_at);
      }
    }
  }

  // Batch 9D — first actual contact attempt timestamp per case (from
  // facilitation_case_contact_attempts.contact_at, earliest per case).
  const firstContactAttemptById = new Map<string, string>();
  if (caseIds.length > 0) {
    const { data: attempts } = await admin
      .from("facilitation_case_contact_attempts")
      .select("case_id, contact_at")
      .in("case_id", caseIds)
      .order("contact_at", { ascending: true })
      .limit(10000);
    for (const a of (attempts ?? []) as { case_id: string; contact_at: string | null }[]) {
      if (!a.contact_at) continue;
      if (!firstContactAttemptById.has(a.case_id)) firstContactAttemptById.set(a.case_id, a.contact_at);
    }
  }

  const avgToAssign = avgHours(
    list.map((c) => ({ a: (c.created_at as string) ?? null, b: firstOwnerAssignedById.get(c.id as string) ?? null })),
  );
  const avgToTriage = avgHours(
    list.map((c) => ({ a: (c.created_at as string) ?? null, b: firstTriageReviewedById.get(c.id as string) ?? null })),
  );
  const avgToFirstOutreach = avgHours(
    list.map((c) => ({ a: (c.created_at as string) ?? null, b: firstOutreachReadyById.get(c.id as string) ?? null })),
  );
  // Batch 9D — first review = first admin status_changed event (same anchor
  // as triage, kept under its own label for the management spec).
  const avgToFirstReview = avgToTriage;
  // Batch 9D — first contact = earliest logged contact_attempt.contact_at,
  // anchored from case creation (existing accepted anchor).
  const avgToFirstContact = avgHours(
    list.map((c) => ({ a: (c.created_at as string) ?? null, b: firstContactAttemptById.get(c.id as string) ?? null })),
  );
  const avgToClose = avgHours(
    list.map((c) => ({ a: (c.created_at as string) ?? null, b: (c.closed_at as string) ?? null })),
  );

  // ── Outcome rates (denominator = closed cases).
  const closed = list.filter((c) => !!c.closed_at);
  const denom = closed.length;
  const convertedToPoi = closed.filter(
    (c) => c.internal_status === "converted_to_known_counterparty_poi" || !!c.poi_conversion_recorded_at,
  ).length;
  const unableToContact = closed.filter((c) => c.final_outcome === "unable_to_proceed").length;
  const counterpartyDeclined = closed.filter(
    (c) => c.internal_status === "counterparty_declined" || c.final_outcome === "counterparty_declined",
  ).length;
  const complianceBlocked = closed.filter((c) => c.internal_status === "blocked_by_compliance").length;
  const duplicateRate = closed.filter((c) => c.internal_status === "duplicate_review").length;

  // Batch 9D — overall conversion rate (successful closures / closed).
  const SUCCESSFUL_FINAL_OUTCOMES = new Set([
    "converted_to_known_counterparty_poi",
    "linked_to_existing_organisation",
    "new_counterparty_profile_created",
  ]);
  const SUCCESSFUL_INTERNAL_STATUSES = new Set([
    "converted_to_known_counterparty_poi",
    "ready_for_known_counterparty_poi",
  ]);
  const conversionNumerator = closed.filter(
    (c) =>
      (typeof c.final_outcome === "string" && SUCCESSFUL_FINAL_OUTCOMES.has(c.final_outcome)) ||
      (typeof c.internal_status === "string" && SUCCESSFUL_INTERNAL_STATUSES.has(c.internal_status)),
  ).length;

  // Batch 9D — breached-deadline-type breakdown (group by exact
  // overdue_reasons[] code; counts each reason once per breached case).
  const OVERDUE_REASON_CODES = [
    "owner_assignment_overdue",
    "initial_triage_overdue",
    "more_information_response_overdue",
    "first_outreach_overdue",
    "follow_up_outreach_overdue",
    "compliance_review_overdue",
    "next_action_overdue",
    "stale_no_activity",
  ] as const;
  const breachedCases = list.filter((c) => c.is_overdue === true);
  const breachedCount = breachedCases.length;
  const breachedCounts = new Map<string, number>();
  for (const c of breachedCases) {
    const reasons = Array.isArray((c as { overdue_reasons?: string[] }).overdue_reasons)
      ? (c as { overdue_reasons: string[] }).overdue_reasons
      : [];
    for (const r of reasons) {
      if ((OVERDUE_REASON_CODES as readonly string[]).includes(r)) {
        breachedCounts.set(r, (breachedCounts.get(r) ?? 0) + 1);
      }
    }
  }
  const breachedBreakdown = [...breachedCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([deadline_type, count]) => ({
      deadline_type,
      count,
      pct_of_breached: pct(count, breachedCount),
    }));

  // ── Grouping.
  const groupBy = (key: "counterparty_country" | "sector") => {
    const m = new Map<string, number>();
    for (const c of list) {
      const v = ((c[key] as string) ?? "").trim();
      if (!v) continue;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([label, count]) => ({ label, count }));
  };

  // ── SLA compliance % = closed-without-overdue / closed.
  const closedNotOverdue = closed.filter((c) => c.is_overdue !== true).length;
  const slaCompliancePct = pct(closedNotOverdue, denom);

  return json(req, {
    generated_at: new Date().toISOString(),
    cohort_size: list.length,
    headline: {
      open_cases: open,
      new_cases_this_week: newThisWeek,
      new_cases_this_month: newThisMonth,
      overdue_cases: overdue,
    },
    averages_hours: {
      time_to_owner_assignment: avgToAssign,
      time_to_triage: avgToTriage,
      time_to_first_review: avgToFirstReview,
      time_to_first_outreach: avgToFirstOutreach,
      time_to_first_contact: avgToFirstContact,
      time_to_close: avgToClose,
    },
    outcome_rates_pct: {
      conversion_to_poi: pct(convertedToPoi, denom),
      unable_to_contact: pct(unableToContact, denom),
      counterparty_declined: pct(counterpartyDeclined, denom),
      compliance_block: pct(complianceBlocked, denom),
      duplicate: pct(duplicateRate, denom),
    },
    conversion_rate: {
      numerator: conversionNumerator,
      denominator: denom,
      rate_pct: pct(conversionNumerator, denom),
    },
    breached_deadline_breakdown: {
      total_breached: breachedCount,
      items: breachedBreakdown,
    },
    grouping: {
      by_country: groupBy("counterparty_country"),
      by_sector: groupBy("sector"),
    },
    sla_compliance_pct: slaCompliancePct,
  });
});
