/**
 * facilitation-poi-conversion — Batch 16 controlled POI conversion.
 *
 * Purpose:
 *   Allow a platform_admin to convert an unknown-counterparty facilitation
 *   case into a POI ONLY when all eligibility gates pass and a human
 *   confirms the action. The system never auto-converts; it only checks
 *   eligibility and applies the operator's deliberate decision.
 *
 * Actions:
 *   - check_eligibility          (platform_admin or compliance_analyst read-only)
 *   - confirm_link_existing      (platform_admin only)
 *   - confirm_create_reference   (platform_admin only)
 *
 * Negative controls (enforced by absence — no code paths exist):
 *   no WaD insert, no match insert, no token movement, no payment,
 *   no outreach send, no provider call, no bulk conversion,
 *   no override of DNC / compliance / duplicate blocks.
 *
 * NOTE: The `pois` table requires trade-context fields (buyer_entity_id,
 * seller_entity_id, industry_code, terms) that a facilitation case does
 * NOT carry. Per spec ("…or store a safe linkage record") this function
 * therefore offers two safe pathways:
 *   - linked_existing: attach an existing POI id owned by the requester org.
 *   - recorded_reference: record an operator-supplied POI reference string
 *     on the case without inserting into `pois`.
 * Real `pois` row creation from a facilitation case is deferred until the
 * trade-context capture is approved by the client.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { handleHealthProbe } from "../_shared/health.ts";
import { FACILITATION_POI_CONVERSION_AUDIT_NAMES } from "../_shared/facilitation-case-state.ts";

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

const CheckSchema = z.object({
  action: z.literal("check_eligibility"),
  case_id: z.string().uuid(),
});
const LinkSchema = z.object({
  action: z.literal("confirm_link_existing"),
  case_id: z.string().uuid(),
  poi_id: z.string().uuid(),
  confirmed: z.literal(true),
  reason: z.string().trim().min(3).max(2000),
});
const CreateRefSchema = z.object({
  action: z.literal("confirm_create_reference"),
  case_id: z.string().uuid(),
  poi_reference: z.string().trim().min(3).max(500),
  confirmed: z.literal(true),
  reason: z.string().trim().min(3).max(2000),
  evidence_summary: z.string().trim().max(2000).nullable().optional(),
});
const BodySchema = z.discriminatedUnion("action", [CheckSchema, LinkSchema, CreateRefSchema]);

type Blocker =
  | "case_not_found"
  | "case_closed"
  | "case_cancelled"
  | "wrong_status_for_conversion"
  | "active_compliance_block"
  | "unresolved_compliance_review"
  | "unresolved_more_information_request"
  | "duplicate_review_unresolved"
  | "confirmed_sanctions_pep_block"
  | "no_manual_registry_or_kyb_record"
  | "no_manual_sanctions_pep_record"
  | "missing_authority_evidence"
  | "missing_counterparty_identity"
  | "active_do_not_contact_block"
  | "duplicate_organisation_conflict"
  | "requester_org_not_eligible"
  | "already_converted"
  | "poi_not_owned_by_requester_org"
  | "poi_not_found";

const BLOCKER_LABEL: Record<Blocker, string> = {
  case_not_found: "The facilitation case could not be found",
  case_closed: "The case is closed",
  case_cancelled: "The case was cancelled by the requester",
  wrong_status_for_conversion: "The case must be marked ready for POI before conversion",
  active_compliance_block: "Compliance has placed a block on this case",
  unresolved_compliance_review: "An unresolved compliance review must be cleared first",
  unresolved_more_information_request: "An outstanding 'more information' request must be resolved",
  duplicate_review_unresolved: "A duplicate review on this case must be resolved first",
  confirmed_sanctions_pep_block: "A confirmed sanctions or PEP match is on file",
  no_manual_registry_or_kyb_record: "No manual registry / KYB record has been captured",
  no_manual_sanctions_pep_record: "No manual sanctions / PEP record has been captured",
  missing_authority_evidence: "Counterparty authority evidence is missing",
  missing_counterparty_identity: "Required counterparty identity fields are missing",
  active_do_not_contact_block: "An active do-not-contact rule applies to this counterparty",
  duplicate_organisation_conflict: "An unresolved duplicate-organisation conflict exists",
  requester_org_not_eligible: "The requester organisation is not eligible to use POIs",
  already_converted: "A POI conversion has already been recorded for this case",
  poi_not_owned_by_requester_org: "The selected POI does not belong to the requester organisation",
  poi_not_found: "The selected POI could not be found",
};

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  const hp = handleHealthProbe(req, "facilitation-poi-conversion");
  if (hp) return hp;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

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

  let parsed;
  try { parsed = BodySchema.safeParse(await req.json()); }
  catch { return json(req, { error: "Invalid JSON" }, 400); }
  if (!parsed.success) return json(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const hasRole = async (role: string) => {
    const { data } = await admin.rpc("has_role", { _user_id: userId, _role: role });
    return !!data;
  };
  const isPlatformAdmin = await hasRole("platform_admin");
  const isComplianceAnalyst = await hasRole("compliance_analyst");

  const caseId = parsed.data.case_id;
  const { data: kase, error: kerr } = await admin
    .from("facilitation_cases").select("*").eq("id", caseId).maybeSingle();
  if (kerr) return json(req, { error: "Database error" }, 500);
  if (!kase) return json(req, { error: BLOCKER_LABEL.case_not_found, blockers: ["case_not_found"] }, 404);

  // Read-only check is open to platform_admin + compliance_analyst.
  // Mutating actions are strictly platform_admin only.
  const isCheck = parsed.data.action === "check_eligibility";
  if (!isCheck && !isPlatformAdmin) {
    return json(req, { error: "Only platform admins can confirm a POI conversion" }, 403);
  }
  if (isCheck && !isPlatformAdmin && !isComplianceAnalyst) {
    return json(req, { error: "Not permitted" }, 403);
  }

  // ─── Build eligibility report ─────────────────────────────────────────
  const blockers: Blocker[] = [];
  const status = String(kase.internal_status ?? "");
  const requesterOrgId = (kase as { requesting_org_id?: string | null }).requesting_org_id ?? null;

  if (status === "closed") blockers.push("case_closed");
  if (status === "cancelled_by_requester") blockers.push("case_cancelled");
  if (status === "blocked_by_compliance") blockers.push("active_compliance_block");
  if (status === "compliance_review_required") blockers.push("unresolved_compliance_review");
  if (status === "more_information_needed") blockers.push("unresolved_more_information_request");
  if (status === "duplicate_review") blockers.push("duplicate_review_unresolved");
  if (status !== "ready_for_known_counterparty_poi") blockers.push("wrong_status_for_conversion");
  if ((kase as { final_outcome?: string | null }).final_outcome === "converted_to_known_counterparty_poi"
    || (kase as { poi_conversion_recorded_at?: string | null }).poi_conversion_recorded_at
    || (kase as { linked_poi_id?: string | null }).linked_poi_id) {
    blockers.push("already_converted");
  }

  // Authority evidence summary (manual capture)
  if (!(kase as { ready_for_poi_authority_summary?: string | null }).ready_for_poi_authority_summary) {
    blockers.push("missing_authority_evidence");
  }
  // Required identity fields (counterparty_country is mandatory in the schema;
  // we treat it as the jurisdiction signal for POI eligibility).
  const legalName = (kase as { counterparty_legal_name?: string | null }).counterparty_legal_name?.trim();
  const jurisdiction = (kase as { counterparty_country?: string | null }).counterparty_country?.trim();
  if (!legalName || !jurisdiction) blockers.push("missing_counterparty_identity");

  // Manual registry/KYB & sanctions/PEP records (deferred Batches 14/15 — manual only)
  const { data: reg } = await admin
    .from("facilitation_case_registry_checks")
    .select("result,confidence").eq("case_id", caseId)
    .order("created_at", { ascending: false }).limit(1);
  const lastReg = reg?.[0] as { result?: string } | undefined;
  if (!lastReg) blockers.push("no_manual_registry_or_kyb_record");

  const { data: sanc } = await admin
    .from("facilitation_case_sanctions_checks")
    .select("result,compliance_decision").eq("case_id", caseId)
    .order("created_at", { ascending: false }).limit(1);
  const lastS = sanc?.[0] as { result?: string; compliance_decision?: string } | undefined;
  if (!lastS) blockers.push("no_manual_sanctions_pep_record");
  if (lastS && (lastS.result === "confirmed_match" || lastS.compliance_decision === "blocked")) {
    blockers.push("confirmed_sanctions_pep_block");
  }

  // Active DNC by org name / email / domain
  const cpEmail = (kase as { counterparty_email?: string | null }).counterparty_email?.trim()?.toLowerCase();
  const emailDomain = cpEmail?.includes("@") ? cpEmail.split("@")[1] : null;
  const orFilters: string[] = [];
  if (legalName) orFilters.push(`and(rule_type.eq.org_name,value.ilike.${legalName})`);
  if (cpEmail) orFilters.push(`and(rule_type.eq.email,value.eq.${cpEmail})`);
  if (emailDomain) orFilters.push(`and(rule_type.eq.email_domain,value.eq.${emailDomain})`);
  if (orFilters.length > 0) {
    const { data: dnc } = await admin
      .from("facilitation_do_not_contact_rules")
      .select("id").eq("status", "active").eq("severity", "block")
      .or(orFilters.join(","));
    if (dnc && dnc.length > 0) blockers.push("active_do_not_contact_block");
  }

  // Unresolved duplicate-org conflict marker
  if ((kase as { duplicate_review_open?: boolean | null }).duplicate_review_open === true) {
    blockers.push("duplicate_organisation_conflict");
  }

  // Requester org eligibility (org must exist and not be suspended)
  if (!requesterOrgId) {
    blockers.push("requester_org_not_eligible");
  } else {
    const { data: org } = await admin
      .from("organizations").select("id,status,suspended_at")
      .eq("id", requesterOrgId).maybeSingle();
    const o = org as { status?: string | null; suspended_at?: string | null } | null;
    if (!o || (o.status && ["suspended", "closed", "archived"].includes(o.status)) || o.suspended_at) {
      blockers.push("requester_org_not_eligible");
    }
  }

  const eligible = blockers.length === 0;
  const summary = {
    case_number: (kase as { case_number?: string | null }).case_number ?? null,
    requester_organisation_id: requesterOrgId,
    counterparty_legal_name: legalName ?? null,
    counterparty_trading_name: (kase as { counterparty_trading_name?: string | null }).counterparty_trading_name ?? null,
    jurisdiction: jurisdiction ?? null,
    role: (kase as { role?: string | null }).role ?? null,
    product_or_commodity: (kase as { product_or_commodity?: string | null }).product_or_commodity ?? null,
    authority_evidence_summary_present:
      !!(kase as { ready_for_poi_authority_summary?: string | null }).ready_for_poi_authority_summary,
    manual_registry_or_kyb_status: lastReg?.result ?? "not_recorded",
    manual_sanctions_pep_status: lastS?.result ?? "not_recorded",
    sanctions_compliance_decision: lastS?.compliance_decision ?? null,
    dnc_active: blockers.includes("active_do_not_contact_block"),
    duplicate_conflict_open:
      (kase as { duplicate_review_open?: boolean | null }).duplicate_review_open === true,
    already_converted: blockers.includes("already_converted"),
    internal_status: status,
  };
  const report = {
    eligible,
    blockers,
    blocker_labels: blockers.map((b) => ({ code: b, label: BLOCKER_LABEL[b] })),
    summary,
    deferred_live_integrations: {
      registry_kyb: "BATCH_14_DEFERRED — manual records only",
      sanctions_pep: "BATCH_15_DEFERRED — manual records only",
    },
  };

  // Audit: every eligibility check is recorded.
  await admin.from("facilitation_case_events").insert({
    case_id: caseId,
    actor_user_id: userId,
    action: FACILITATION_POI_CONVERSION_AUDIT_NAMES[0], // eligibility_checked
    from_status: status, to_status: status,
    payload: { eligible, blockers, action_requested: parsed.data.action },
  });

  if (isCheck) return json(req, { ok: true, report });

  if (!eligible) {
    await admin.from("facilitation_case_events").insert({
      case_id: caseId,
      actor_user_id: userId,
      action: FACILITATION_POI_CONVERSION_AUDIT_NAMES[1], // blocked
      from_status: status, to_status: status,
      payload: { blockers, action_requested: parsed.data.action },
    });
    return json(req, {
      error: "Conversion is not eligible",
      blockers,
      blocker_labels: report.blocker_labels,
    }, 409);
  }

  const nowIso = new Date().toISOString();

  // ─── confirm_link_existing ──────────────────────────────────────────────
  if (parsed.data.action === "confirm_link_existing") {
    const p = parsed.data;
    const { data: poi } = await admin
      .from("pois").select("id,org_id").eq("id", p.poi_id).maybeSingle();
    if (!poi) {
      await admin.from("facilitation_case_events").insert({
        case_id: caseId, actor_user_id: userId,
        action: FACILITATION_POI_CONVERSION_AUDIT_NAMES[1],
        from_status: status, to_status: status,
        payload: { blockers: ["poi_not_found"], action_requested: p.action },
      });
      return json(req, { error: BLOCKER_LABEL.poi_not_found, blockers: ["poi_not_found"] }, 409);
    }
    if (requesterOrgId && (poi as { org_id?: string | null }).org_id !== requesterOrgId) {
      await admin.from("facilitation_case_events").insert({
        case_id: caseId, actor_user_id: userId,
        action: FACILITATION_POI_CONVERSION_AUDIT_NAMES[1],
        from_status: status, to_status: status,
        payload: { blockers: ["poi_not_owned_by_requester_org"], action_requested: p.action },
      });
      return json(req, {
        error: BLOCKER_LABEL.poi_not_owned_by_requester_org,
        blockers: ["poi_not_owned_by_requester_org"],
      }, 409);
    }

    // confirmed (decision recorded)
    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: userId,
      action: FACILITATION_POI_CONVERSION_AUDIT_NAMES[2], // confirmed
      from_status: status, to_status: status,
      payload: { method: "linked_existing", poi_id: p.poi_id, reason: p.reason },
    });

    const { error: uerr } = await admin.from("facilitation_cases").update({
      internal_status: "converted_to_known_counterparty_poi",
      final_outcome: "linked_to_existing_organisation",
      linked_poi_id: p.poi_id,
      poi_conversion_method: "linked_existing",
      poi_conversion_reference: p.poi_id,
      poi_conversion_reason: p.reason,
      poi_conversion_recorded_at: nowIso,
      poi_conversion_recorded_by: userId,
      poi_conversion_confirmed_by: userId,
      poi_conversion_eligibility_payload: report,
      closed_at: nowIso,
    }).eq("id", caseId);
    if (uerr) return json(req, { error: "Failed to record conversion" }, 500);

    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: userId,
      action: FACILITATION_POI_CONVERSION_AUDIT_NAMES[4], // linked_existing
      from_status: status, to_status: "converted_to_known_counterparty_poi",
      payload: { poi_id: p.poi_id },
    });

    return json(req, { ok: true, method: "linked_existing", poi_id: p.poi_id });
  }

  // ─── confirm_create_reference ───────────────────────────────────────────
  if (parsed.data.action === "confirm_create_reference") {
    const p = parsed.data;

    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: userId,
      action: FACILITATION_POI_CONVERSION_AUDIT_NAMES[2], // confirmed
      from_status: status, to_status: status,
      payload: { method: "recorded_reference", reason: p.reason },
    });

    const { error: uerr } = await admin.from("facilitation_cases").update({
      internal_status: "converted_to_known_counterparty_poi",
      final_outcome: "converted_to_known_counterparty_poi",
      poi_conversion_method: "recorded_reference",
      poi_conversion_reference: p.poi_reference,
      poi_conversion_reason: p.reason,
      poi_conversion_evidence_summary: p.evidence_summary ?? null,
      poi_conversion_recorded_at: nowIso,
      poi_conversion_recorded_by: userId,
      poi_conversion_confirmed_by: userId,
      poi_conversion_eligibility_payload: report,
      closed_at: nowIso,
    }).eq("id", caseId);
    if (uerr) return json(req, { error: "Failed to record conversion" }, 500);

    await admin.from("facilitation_case_events").insert({
      case_id: caseId, actor_user_id: userId,
      action: FACILITATION_POI_CONVERSION_AUDIT_NAMES[3], // created
      from_status: status, to_status: "converted_to_known_counterparty_poi",
      payload: {
        method: "recorded_reference",
        poi_reference: p.poi_reference,
        note: "Safe linkage record. Real pois row creation deferred pending approved trade-context capture.",
      },
    });

    return json(req, { ok: true, method: "recorded_reference", poi_reference: p.poi_reference });
  }

  return json(req, { error: "Unhandled action" }, 400);
});
