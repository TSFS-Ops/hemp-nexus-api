/**
 * facilitation-organisation-merge — Batch 17 controlled organisation merge.
 *
 * Purpose
 *   Provide a safe, human-confirmed workflow that lets a platform admin
 *   merge a duplicate organisation that surfaced from the Unknown-Counterparty
 *   Facilitation Queue. No silent merging, no automatic merging, no requester
 *   triggering, no bulk merging. The system only:
 *     1. presents safe duplicate candidates,
 *     2. checks an eligibility gate,
 *     3. records a deliberate platform-admin confirmation,
 *     4. marks the source organisation as superseded (soft, never deleted).
 *
 * Actions
 *   - list_candidates           (platform_admin or compliance_analyst, read-only)
 *   - check_eligibility         (platform_admin or compliance_analyst, read-only)
 *   - confirm_merge             (platform_admin only)
 *
 * Negative controls (enforced by absence of code paths)
 *   no WaD insert, no POI insert, no match insert, no token movement,
 *   no payment movement, no credit movement, no outreach send,
 *   no email send, no DNC override, no compliance-block override,
 *   no Registry/KYB call, no Sanctions/PEP call, no hard-delete,
 *   no bulk merge, no audit-log rewrite, no automatic merge.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { handleHealthProbe } from "../_shared/health.ts";
import { FACILITATION_ORGANISATION_MERGE_AUDIT_NAMES } from "../_shared/facilitation-case-state.ts";

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

// ─── Validation ────────────────────────────────────────────────────────────
const ListSchema = z.object({
  action: z.literal("list_candidates"),
  case_id: z.string().uuid().optional(),
  source_org_id: z.string().uuid().optional(),
});
const CheckSchema = z.object({
  action: z.literal("check_eligibility"),
  source_org_id: z.string().uuid(),
  target_org_id: z.string().uuid(),
  case_id: z.string().uuid().optional(),
});
// Operator-approved set of safe fields that may be copied from source → target
// when (and only when) the target field is empty. No verified data is ever
// overwritten. Compliance-/sanctions-/DNC-/admin-note fields are absent by design.
const SAFE_COPY_FIELDS = [
  "legal_name",
  "trading_name",
  "registration_number",
  "tax_number",
  "vat_number",
  "website",
  "industry",
  "logo_url",
] as const;
type SafeField = (typeof SAFE_COPY_FIELDS)[number];

const ConfirmSchema = z.object({
  action: z.literal("confirm_merge"),
  source_org_id: z.string().uuid(),
  target_org_id: z.string().uuid(),
  case_id: z.string().uuid().optional(),
  fields_to_copy: z.array(z.enum(SAFE_COPY_FIELDS)).max(SAFE_COPY_FIELDS.length).default([]),
  reason: z.string().trim().min(10).max(2000),
  confirmed: z.literal(true),
});
const BodySchema = z.discriminatedUnion("action", [ListSchema, CheckSchema, ConfirmSchema]);

type Blocker =
  | "source_or_target_missing"
  | "same_organisation"
  | "source_already_merged"
  | "target_already_merged"
  | "source_frozen"
  | "target_frozen"
  | "source_on_billing_hold"
  | "target_on_billing_hold"
  | "source_under_compliance_hold"
  | "target_under_compliance_hold"
  | "source_under_legal_hold"
  | "target_under_legal_hold"
  | "source_in_open_dispute"
  | "target_in_open_dispute"
  | "source_has_active_dnc"
  | "target_has_active_dnc"
  | "source_under_sanctions_review"
  | "target_under_sanctions_review"
  | "unresolved_more_information_request"
  | "merge_already_in_progress"
  | "actor_not_platform_admin"
  | "confirmation_missing";

const BLOCKER_LABEL: Record<Blocker, string> = {
  source_or_target_missing: "One or both organisation records could not be found",
  same_organisation: "Source and target organisation are the same record",
  source_already_merged: "The source organisation has already been merged",
  target_already_merged: "The target organisation has itself been merged into another record",
  source_frozen: "The source organisation is currently frozen",
  target_frozen: "The target organisation is currently frozen",
  source_on_billing_hold: "The source organisation has an open billing hold",
  target_on_billing_hold: "The target organisation has an open billing hold",
  source_under_compliance_hold: "The source organisation is under an active compliance hold",
  target_under_compliance_hold: "The target organisation is under an active compliance hold",
  source_under_legal_hold: "The source organisation is under an active legal hold",
  target_under_legal_hold: "The target organisation is under an active legal hold",
  source_in_open_dispute: "The source organisation has an open dispute",
  target_in_open_dispute: "The target organisation has an open dispute",
  source_has_active_dnc: "The source organisation has an active do-not-contact rule",
  target_has_active_dnc: "The target organisation has an active do-not-contact rule",
  source_under_sanctions_review: "The source organisation has an unresolved sanctions / PEP review",
  target_under_sanctions_review: "The target organisation has an unresolved sanctions / PEP review",
  unresolved_more_information_request: "The linked facilitation case has an unresolved 'more information' request affecting identity",
  merge_already_in_progress: "A merge is already in progress for one of these organisations",
  actor_not_platform_admin: "Only a platform admin can confirm this merge",
  confirmation_missing: "Deliberate platform admin confirmation is required",
};

type OrgRow = {
  id: string;
  legal_name: string | null;
  trading_name: string | null;
  name: string | null;
  registration_number: string | null;
  tax_number: string | null;
  vat_number: string | null;
  website: string | null;
  industry: string | null;
  logo_url: string | null;
  jurisdictions: string[] | null;
  status: string | null;
  frozen: boolean | null;
  billing_hold: boolean | null;
  merged_into_org_id: string | null;
  merged_at: string | null;
};

const ORG_COLUMNS =
  "id,legal_name,trading_name,name,registration_number,tax_number,vat_number," +
  "website,industry,logo_url,jurisdictions,status,frozen,billing_hold," +
  "merged_into_org_id,merged_at";

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

function safeOrgSummary(o: OrgRow | null) {
  if (!o) return null;
  return {
    id: o.id,
    legal_name: o.legal_name ?? o.name ?? null,
    trading_name: o.trading_name ?? null,
    registration_number: o.registration_number ?? null,
    tax_number: o.tax_number ?? null,
    vat_number: o.vat_number ?? null,
    jurisdictions: o.jurisdictions ?? [],
    website: o.website ?? null,
    industry: o.industry ?? null,
    status: o.status ?? null,
    frozen: !!o.frozen,
    billing_hold: !!o.billing_hold,
    already_merged: !!o.merged_into_org_id,
  };
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  const hp = handleHealthProbe(req, "facilitation-organisation-merge");
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
  try {
    parsed = BodySchema.safeParse(await req.json());
  } catch {
    return json(req, { error: "Invalid JSON" }, 400);
  }
  if (!parsed.success) {
    return json(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const hasRole = async (role: string) => {
    const { data } = await admin.rpc("has_role", { _user_id: userId, _role: role });
    return !!data;
  };
  const isPlatformAdmin = await hasRole("platform_admin");
  const isComplianceAnalyst = await hasRole("compliance_analyst");

  if (!isPlatformAdmin && !isComplianceAnalyst) {
    return json(req, { error: "Not permitted" }, 403);
  }
  // Mutating action requires platform_admin and explicit confirmation.
  if (parsed.data.action === "confirm_merge" && !isPlatformAdmin) {
    return json(req, { error: BLOCKER_LABEL.actor_not_platform_admin }, 403);
  }

  // ─── list_candidates ─────────────────────────────────────────────────────
  if (parsed.data.action === "list_candidates") {
    const { case_id, source_org_id } = parsed.data;

    let baseOrg: OrgRow | null = null;
    let caseHints:
      | { legal_name?: string | null; trading_name?: string | null; jurisdiction?: string | null; registration_number?: string | null }
      | null = null;

    if (source_org_id) {
      const { data } = await admin.from("organizations").select(ORG_COLUMNS).eq("id", source_org_id).maybeSingle();
      baseOrg = (data as OrgRow | null) ?? null;
    }
    if (case_id) {
      const { data: kase } = await admin
        .from("facilitation_cases")
        .select(
          "id,counterparty_legal_name,counterparty_trading_name,counterparty_country," +
            "counterparty_registration_number",
        )
        .eq("id", case_id)
        .maybeSingle();
      if (kase) {
        const k = kase as Record<string, string | null>;
        caseHints = {
          legal_name: k.counterparty_legal_name,
          trading_name: k.counterparty_trading_name,
          jurisdiction: k.counterparty_country,
          registration_number: k.counterparty_registration_number,
        };
      }
    }

    const legal = norm(baseOrg?.legal_name ?? baseOrg?.name ?? caseHints?.legal_name);
    const trading = norm(baseOrg?.trading_name ?? caseHints?.trading_name);
    const regNum = norm(baseOrg?.registration_number ?? caseHints?.registration_number);

    const candidates: OrgRow[] = [];
    const seen = new Set<string>();
    const collect = async (qb: Promise<{ data: OrgRow[] | null }>) => {
      const { data } = await qb;
      for (const row of (data ?? []) as OrgRow[]) {
        if (baseOrg && row.id === baseOrg.id) continue;
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        candidates.push(row);
      }
    };

    if (regNum) {
      await collect(
        admin.from("organizations").select(ORG_COLUMNS).ilike("registration_number", regNum).limit(20)
          .then(({ data, error }) => ({ data: (error ? [] : (data as OrgRow[])) })),
      );
    }
    if (legal) {
      await collect(
        admin.from("organizations").select(ORG_COLUMNS).ilike("legal_name", legal).limit(20)
          .then(({ data, error }) => ({ data: (error ? [] : (data as OrgRow[])) })),
      );
      await collect(
        admin.from("organizations").select(ORG_COLUMNS).ilike("name", legal).limit(20)
          .then(({ data, error }) => ({ data: (error ? [] : (data as OrgRow[])) })),
      );
    }
    if (trading) {
      await collect(
        admin.from("organizations").select(ORG_COLUMNS).ilike("trading_name", trading).limit(20)
          .then(({ data, error }) => ({ data: (error ? [] : (data as OrgRow[])) })),
      );
    }

    return json(req, {
      ok: true,
      source: safeOrgSummary(baseOrg),
      case_hints: caseHints,
      candidates: candidates.map(safeOrgSummary).filter(Boolean),
    });
  }

  // ─── helpers shared by check + confirm ───────────────────────────────────
  const fetchOrg = async (id: string) =>
    ((await admin.from("organizations").select(ORG_COLUMNS).eq("id", id).maybeSingle()).data as OrgRow | null);

  const buildBlockers = async (source: OrgRow | null, target: OrgRow | null, caseId?: string) => {
    const out: Blocker[] = [];
    if (!source || !target) { out.push("source_or_target_missing"); return { out, source, target }; }
    if (source.id === target.id) out.push("same_organisation");

    if (source.merged_into_org_id) out.push("source_already_merged");
    if (target.merged_into_org_id) out.push("target_already_merged");
    if (source.frozen) out.push("source_frozen");
    if (target.frozen) out.push("target_frozen");
    if (source.billing_hold) out.push("source_on_billing_hold");
    if (target.billing_hold) out.push("target_on_billing_hold");

    // Active compliance / legal / dispute / DNC / sanctions checks
    const ch = await admin.from("compliance_holds")
      .select("org_id,resolved_at").is("resolved_at", null).in("org_id", [source.id, target.id]);
    for (const r of (ch.data ?? []) as Array<{ org_id: string }>) {
      if (r.org_id === source.id) out.push("source_under_compliance_hold");
      if (r.org_id === target.id) out.push("target_under_compliance_hold");
    }
    const lh = await admin.from("legal_holds")
      .select("org_id,released_at").is("released_at", null).in("org_id", [source.id, target.id]);
    for (const r of (lh.data ?? []) as Array<{ org_id: string }>) {
      if (r.org_id === source.id) out.push("source_under_legal_hold");
      if (r.org_id === target.id) out.push("target_under_legal_hold");
    }
    const dp = await admin.from("disputes")
      .select("org_id,status").not("status", "in", "(resolved,closed,withdrawn)")
      .in("org_id", [source.id, target.id]);
    for (const r of (dp.data ?? []) as Array<{ org_id: string }>) {
      if (r.org_id === source.id) out.push("source_in_open_dispute");
      if (r.org_id === target.id) out.push("target_in_open_dispute");
    }
    const dnc = await admin.from("facilitation_do_not_contact_rules")
      .select("organisation_id,revoked_at").is("revoked_at", null)
      .in("organisation_id", [source.id, target.id]);
    for (const r of (dnc.data ?? []) as Array<{ organisation_id: string }>) {
      if (r.organisation_id === source.id) out.push("source_has_active_dnc");
      if (r.organisation_id === target.id) out.push("target_has_active_dnc");
    }
    // Sanctions/PEP — open screening review (best-effort, kept conservative)
    const sc = await admin.from("screening_results")
      .select("entity_id,decision").in("entity_id", [source.id, target.id])
      .in("decision", ["review", "pending"]);
    for (const r of (sc.data ?? []) as Array<{ entity_id: string }>) {
      if (r.entity_id === source.id) out.push("source_under_sanctions_review");
      if (r.entity_id === target.id) out.push("target_under_sanctions_review");
    }

    // Linked facilitation case state — unresolved 'more information' affecting identity
    if (caseId) {
      const { data: kase } = await admin.from("facilitation_cases").select("internal_status").eq("id", caseId).maybeSingle();
      if ((kase as { internal_status?: string } | null)?.internal_status === "more_information_needed") {
        out.push("unresolved_more_information_request");
      }
    }

    // Existing merge in progress for either organisation
    const ip = await admin.from("facilitation_organisation_merges")
      .select("id,source_org_id,target_org_id,status")
      .in("status", ["confirmed", "completed", "eligibility_checked"])
      .or(
        `source_org_id.in.(${source.id},${target.id}),target_org_id.in.(${source.id},${target.id})`,
      );
    if ((ip.data ?? []).some((r) => (r as { status: string }).status !== "eligibility_checked")) {
      out.push("merge_already_in_progress");
    }

    return { out, source, target };
  };

  // ─── check_eligibility ───────────────────────────────────────────────────
  if (parsed.data.action === "check_eligibility") {
    const { source_org_id, target_org_id, case_id } = parsed.data;
    const [source, target] = await Promise.all([fetchOrg(source_org_id), fetchOrg(target_org_id)]);
    const { out: blockers } = await buildBlockers(source, target, case_id);
    const eligible = blockers.length === 0;

    // Compute proposed field-handling preview
    const proposed: Array<{ field: SafeField; will_copy: boolean; reason: string }> = [];
    if (source && target) {
      const s = source as unknown as Record<string, unknown>;
      const t = target as unknown as Record<string, unknown>;
      for (const f of SAFE_COPY_FIELDS) {
        const tv = t[f];
        const sv = s[f];
        if (tv == null || tv === "") {
          if (sv != null && sv !== "") proposed.push({ field: f, will_copy: true, reason: "Target field is empty; safe to copy from source" });
          else proposed.push({ field: f, will_copy: false, reason: "Source field is empty; nothing to copy" });
        } else {
          proposed.push({ field: f, will_copy: false, reason: "Target field is already populated; verified data is preserved" });
        }
      }
    }

    const report = {
      eligible,
      blockers,
      blocker_labels: blockers.map((b) => ({ code: b, label: BLOCKER_LABEL[b] })),
      source: safeOrgSummary(source),
      target: safeOrgSummary(target),
      proposed_field_handling: proposed,
      fields_never_copied: [
        "admin notes",
        "sanctions/PEP details",
        "raw KYB payloads",
        "DNC details",
        "internal compliance reasoning",
        "call notes",
        "audit/event payloads",
        "private requester-only notes",
        "unresolved evidence",
        "unapproved contact details",
      ],
      deferred_live_integrations: {
        registry_kyb: "BATCH_14_DEFERRED — manual records only",
        sanctions_pep: "BATCH_15_DEFERRED — manual records only",
      },
    };

    // Audit eligibility check (separate row per check; never silent)
    await admin.from("facilitation_organisation_merges").insert({
      facilitation_case_id: case_id ?? null,
      source_org_id, target_org_id,
      status: "eligibility_checked",
      blockers,
      eligibility_payload: report,
      requested_by: userId,
    });
    await admin.from("audit_logs").insert({
      action: FACILITATION_ORGANISATION_MERGE_AUDIT_NAMES[0], // eligibility_checked
      entity_type: "facilitation_organisation_merge",
      entity_id: source_org_id,
      actor_user_id: userId,
      metadata: { source_org_id, target_org_id, case_id: case_id ?? null, eligible, blockers },
    });

    return json(req, { ok: true, report });
  }

  // ─── confirm_merge ───────────────────────────────────────────────────────
  if (parsed.data.action === "confirm_merge") {
    const { source_org_id, target_org_id, case_id, fields_to_copy, reason, confirmed } = parsed.data;
    if (!confirmed) return json(req, { error: BLOCKER_LABEL.confirmation_missing }, 400);

    const [source, target] = await Promise.all([fetchOrg(source_org_id), fetchOrg(target_org_id)]);
    const { out: blockers } = await buildBlockers(source, target, case_id);

    if (blockers.length > 0) {
      const blockRec = await admin.from("facilitation_organisation_merges").insert({
        facilitation_case_id: case_id ?? null,
        source_org_id, target_org_id,
        status: "blocked",
        blockers,
        eligibility_payload: {
          source: safeOrgSummary(source), target: safeOrgSummary(target), blockers,
        },
        reason,
        requested_by: userId,
      }).select("id").maybeSingle();
      await admin.from("audit_logs").insert({
        action: FACILITATION_ORGANISATION_MERGE_AUDIT_NAMES[1], // blocked
        entity_type: "facilitation_organisation_merge",
        entity_id: source_org_id,
        actor_user_id: userId,
        metadata: {
          source_org_id, target_org_id, case_id: case_id ?? null,
          blockers, merge_record_id: blockRec.data?.id ?? null,
        },
      });
      return json(req, {
        error: "Merge is blocked",
        blockers,
        blocker_labels: blockers.map((b) => ({ code: b, label: BLOCKER_LABEL[b] })),
      }, 409);
    }

    // ── Decide which safe fields to actually copy: intersection of operator
    //    selection and the "target is empty" preview. Never overwrite.
    const s = source as unknown as Record<string, unknown>;
    const t = target as unknown as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    const fieldDecisions: Array<{ field: SafeField; copied: boolean; reason: string }> = [];
    for (const f of SAFE_COPY_FIELDS) {
      const chosen = fields_to_copy.includes(f);
      const tv = t[f]; const sv = s[f];
      const targetEmpty = tv == null || tv === "";
      const sourceHas = sv != null && sv !== "";
      if (chosen && targetEmpty && sourceHas) {
        update[f] = sv;
        fieldDecisions.push({ field: f, copied: true, reason: "Operator-approved copy into empty target field" });
      } else {
        fieldDecisions.push({
          field: f,
          copied: false,
          reason: !chosen
            ? "Operator did not select this field"
            : !targetEmpty
              ? "Target field already populated; verified data preserved"
              : "Source field is empty; nothing to copy",
        });
      }
    }

    // ── Insert the merge record (confirmed)
    const merge = await admin.from("facilitation_organisation_merges").insert({
      facilitation_case_id: case_id ?? null,
      source_org_id, target_org_id,
      status: "confirmed",
      blockers: [],
      eligibility_payload: {
        source: safeOrgSummary(source), target: safeOrgSummary(target),
      },
      field_handling: { decisions: fieldDecisions, never_copied: true },
      reason,
      requested_by: userId,
      confirmed_by: userId,
      confirmed_at: new Date().toISOString(),
    }).select("id").maybeSingle();
    const mergeId = merge.data?.id ?? null;

    await admin.from("audit_logs").insert({
      action: FACILITATION_ORGANISATION_MERGE_AUDIT_NAMES[2], // confirmed
      entity_type: "facilitation_organisation_merge",
      entity_id: source_org_id,
      actor_user_id: userId,
      metadata: {
        source_org_id, target_org_id, case_id: case_id ?? null,
        merge_record_id: mergeId, fields_to_copy, reason,
      },
    });

    // ── Apply safe field copies to target (only empty target fields)
    if (Object.keys(update).length > 0) {
      await admin.from("organizations").update(update).eq("id", target_org_id);
    }

    // ── Mark source as superseded (never hard-deleted)
    const nowIso = new Date().toISOString();
    await admin.from("organizations").update({
      merged_into_org_id: target_org_id,
      merged_at: nowIso,
      merged_by_merge_id: mergeId,
    }).eq("id", source_org_id);

    // ── Relink the facilitation case to the surviving organisation if applicable
    if (case_id) {
      await admin.from("facilitation_cases").update({
        matched_organisation_id: target_org_id,
      }).eq("id", case_id).eq("matched_organisation_id", source_org_id);
      await admin.from("facilitation_case_events").insert({
        case_id,
        actor_user_id: userId,
        action: FACILITATION_ORGANISATION_MERGE_AUDIT_NAMES[3], // completed
        from_status: "n/a", to_status: "n/a",
        payload: { merge_record_id: mergeId, source_org_id, target_org_id },
      });
    }

    // ── Mark the merge record completed
    await admin.from("facilitation_organisation_merges").update({
      status: "completed",
      completed_at: nowIso,
    }).eq("id", mergeId);

    await admin.from("audit_logs").insert({
      action: FACILITATION_ORGANISATION_MERGE_AUDIT_NAMES[3], // completed
      entity_type: "facilitation_organisation_merge",
      entity_id: source_org_id,
      actor_user_id: userId,
      metadata: {
        source_org_id, target_org_id, case_id: case_id ?? null,
        merge_record_id: mergeId,
        fields_copied: Object.keys(update),
        field_decisions: fieldDecisions,
      },
    });

    return json(req, {
      ok: true,
      merge_record_id: mergeId,
      target_org_id,
      fields_copied: Object.keys(update),
      field_decisions: fieldDecisions,
    });
  }

  return json(req, { error: "Unhandled action" }, 400);
});
