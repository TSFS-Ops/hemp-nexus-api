/**
 * Governance Record Batch 1 — Critical-Event Coverage Probe.
 *
 * ASSESSMENT-ONLY. READ-ONLY. NO RUNTIME ENFORCEMENT.
 *
 * Returns a STATIC, code-derived coverage matrix describing which
 * critical governance-event classes are currently wired into the
 * `event_store` canonical write helper, which fall back to `audit_logs`
 * only, and which remain unwired. The matrix is hard-coded against
 * the file:line evidence collected during the Batch 1 audit so the
 * response is deterministic across environments.
 *
 * It does NOT:
 *   - SELECT row-level data from event_store
 *   - return any event_store payload contents
 *   - return PII
 *   - mutate event_store
 *   - mutate any audit / RLS / policy / cron / atomic / critical-event
 *     write path
 *   - schedule any pg_cron entry
 *   - call any critical-event writer
 *     (writeCriticalGovernanceEvent / writeGovernanceEventBestEffort /
 *      writeCriticalEventWithPosture)
 *   - introspect information_schema at runtime
 *
 * Security model (mirrors admin-org-retention / email-anonymisation-readiness-probe):
 *   1. Valid Bearer token
 *   2. Caller is platform_admin (has_role)
 *   3. Caller's session is AAL2 (MFA) — assertAal2
 *
 * Canonical audit (CI-guarded, single name):
 *   - governance.event_store.coverage_probed
 */

// deno-lint-ignore-file no-explicit-any

import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const COVERAGE_AUDIT_NAME = "governance.event_store.coverage_probed" as const;

/**
 * Coverage status vocabulary.
 *
 *   wired                       — at least one production call-site emits the
 *                                 canonical event_type to event_store via the
 *                                 critical writer (file:line cited).
 *   partial                     — emitted via the best-effort writer only, or
 *                                 only on some branches of the chokepoint.
 *   audit_logs_only             — event is recorded in audit_logs (and/or
 *                                 admin_audit_logs) but NOT in event_store.
 *   unwired                     — listed in CONTROLLED_TAXONOMY but no
 *                                 production caller emits it.
 *   not_applicable              — class does not exist in this build.
 *   unknown_needs_manual_review — evidence inconclusive; flagged for a later
 *                                 batch to confirm by hand.
 */
type CoverageStatus =
  | "wired"
  | "partial"
  | "audit_logs_only"
  | "unwired"
  | "not_applicable"
  | "unknown_needs_manual_review";

interface CoverageRow {
  event_class: string;
  canonical_event_type: string | null;
  expected_chokepoint: string;
  actual_chokepoint: string | null;
  writes_event_store: boolean;
  writes_audit_logs_only: boolean;
  status: CoverageStatus;
  /** File:line evidence collected during the Batch 1 audit. */
  evidence: string[];
  risk_note: string;
  /** Suggested follow-up for a later batch. Never implemented here. */
  recommended_next_action: string;
}

/**
 * Static, code-derived coverage matrix.
 *
 * Evidence references are file paths + line numbers captured during the
 * Batch 1 audit. They are intentionally embedded so the probe response
 * is reproducible without re-scanning the repository at runtime and so
 * a later batch can diff against them deterministically.
 *
 * Sources consulted (audit-time only, NOT runtime):
 *   - supabase/functions/_shared/governance-audit.ts (CONTROLLED_TAXONOMY,
 *     CRITICAL_FAMILIES, CRITICAL_SPECIFIC_NAMES)
 *   - supabase/functions/_shared/governance-audit-integration.ts
 *   - supabase/functions/_shared/admin-hq-audit.ts
 *   - supabase/functions/_shared/payment-governance.ts
 *   - supabase/functions/_shared/token-metering.ts
 *   - supabase/functions/_shared/governance-waivers.ts
 *   - supabase/functions/pois/index.ts
 *   - supabase/functions/poi-transition/index.ts
 *   - supabase/functions/p3-wad/index.ts
 *   - supabase/functions/collapse/index.ts
 *   - supabase/functions/match-challenges/index.ts
 *   - supabase/functions/admin-legal-hold/index.ts
 *   - supabase/functions/token-purchase/index.ts
 *   - supabase/functions/hq-note-add/index.ts
 *   - supabase/functions/basic-memory-record-write/index.ts
 *   - supabase/functions/admin-governance-export-{request,approve,list}/index.ts
 */
const COVERAGE_MATRIX: ReadonlyArray<CoverageRow> = [
  // ── POI ────────────────────────────────────────────────────────────────
  {
    event_class: "poi.mint",
    canonical_event_type: "poi.created",
    expected_chokepoint:
      "pois edge function (bilateral + unilateral mint paths)",
    actual_chokepoint: "supabase/functions/pois/index.ts",
    writes_event_store: true,
    writes_audit_logs_only: false,
    status: "wired",
    evidence: [
      "supabase/functions/pois/index.ts:14 — imports writeCriticalEventWithPosture",
      "supabase/functions/pois/index.ts:577 — event_type: \"poi.created\" (bilateral mint)",
      "supabase/functions/pois/index.ts:688 — event_type: \"poi.created\" (unilateral mint)",
    ],
    risk_note:
      "Critical writer used; mint paths covered. Verify atomic_generate_poi_v2 + writer share a single DB transaction in a later batch.",
    recommended_next_action:
      "Batch 2: assert tx wrapping (writer throw must roll back POI insert).",
  },
  {
    event_class: "poi.state_transition",
    canonical_event_type: "poi.state_changed",
    expected_chokepoint: "poi-transition + pois edge functions",
    actual_chokepoint:
      "supabase/functions/poi-transition/index.ts, supabase/functions/pois/index.ts",
    writes_event_store: true,
    writes_audit_logs_only: false,
    status: "wired",
    evidence: [
      "supabase/functions/poi-transition/index.ts:19 — imports writeCriticalEventWithPosture",
      "supabase/functions/poi-transition/index.ts:461 — event_type: \"poi.state_changed\"",
      "supabase/functions/pois/index.ts:368 — event_type: \"poi.state_changed\"",
    ],
    risk_note: "State transitions covered. No evidence of unwired branches in audit-time scan.",
    recommended_next_action:
      "Batch 2: enumerate every status enum value reachable in atomic_poi_transition vs. emitted event branches.",
  },
  {
    event_class: "poi.finality",
    canonical_event_type: "finality.recorded",
    expected_chokepoint: "collapse edge function (deterministic finality)",
    actual_chokepoint: "supabase/functions/collapse/index.ts",
    writes_event_store: true,
    writes_audit_logs_only: false,
    status: "wired",
    evidence: [
      "supabase/functions/collapse/index.ts:22 — imports writeCriticalEventWithPosture",
      "supabase/functions/collapse/index.ts:685 — idempotency_key: \"finality.recorded|...\"",
      "supabase/functions/_shared/governance-policy-versions.ts:47 — FINALITY_POLICY_VERSION pinned",
    ],
    risk_note:
      "Critical writer used and policy version pinned. No second finality path found.",
    recommended_next_action:
      "Batch 2: confirm finality.recorded and execution.permitted are in the same DB transaction.",
  },

  // ── WaD ────────────────────────────────────────────────────────────────
  {
    event_class: "wad.seal",
    canonical_event_type: "wad.passed",
    expected_chokepoint: "wad edge function (9-gate seal path)",
    actual_chokepoint: "supabase/functions/wad/index.ts",
    writes_event_store: false,
    writes_audit_logs_only: true,
    status: "unknown_needs_manual_review",
    evidence: [
      "supabase/functions/wad/index.ts:1109 — trigger_event_type: \"wad.sealed\" (notification trigger, not event_store)",
      "supabase/functions/p3-wad/index.ts:715 — event_type: \"trust.wad.issued\" (legacy trust.* namespace, not controlled taxonomy)",
      "Controlled taxonomy declares wad.passed / wad.failed but no caller emits them via writeCriticalEventWithPosture.",
    ],
    risk_note:
      "Seal path appears to write only audit_logs / trust.* legacy namespace. Critical wad.passed / wad.failed in CONTROLLED_TAXONOMY are not emitted by any production caller. Needs manual walk-through before Batch 2 fail-closed wiring.",
    recommended_next_action:
      "Batch 2: confirm whether wad.passed/wad.failed should subsume the trust.wad.* legacy events, then wire the critical writer at the seal commit boundary.",
  },
  {
    event_class: "wad.check_failed",
    canonical_event_type: "wad.check_failed",
    expected_chokepoint: "p3-wad edge function (per-gate evaluation)",
    actual_chokepoint: "supabase/functions/p3-wad/index.ts",
    writes_event_store: true,
    writes_audit_logs_only: false,
    status: "partial",
    evidence: [
      "supabase/functions/p3-wad/index.ts:22 — imports writeGovernanceEventBestEffort",
      "supabase/functions/p3-wad/index.ts:478 — event_type: \"wad.check_failed\" (best-effort writer)",
      "supabase/functions/p3-wad/index.ts:604 — event_type: \"wad.manual_review_required\" (best-effort writer)",
    ],
    risk_note:
      "Best-effort writer means a transient DB failure on event_store is silently swallowed while the WaD gate decision still applies. CRITICAL_FAMILIES includes \"wad\" so the validator would accept these as critical — caller chose best-effort.",
    recommended_next_action:
      "Batch 2: decide whether per-gate failures must be fail-closed; if yes, swap to writeCriticalEventWithPosture and propagate throws.",
  },

  // ── Execution ──────────────────────────────────────────────────────────
  {
    event_class: "execution.permitted",
    canonical_event_type: "execution.permitted",
    expected_chokepoint: "collapse edge function (release-to-execute)",
    actual_chokepoint: "supabase/functions/collapse/index.ts",
    writes_event_store: true,
    writes_audit_logs_only: false,
    status: "wired",
    evidence: [
      "supabase/functions/collapse/index.ts:658 — idempotency_key: \"...|execution.permitted|...\"",
      "supabase/functions/_shared/governance-policy-versions.ts:46 — EXECUTION_POLICY_VERSION pinned",
    ],
    risk_note: "Critical writer used and policy version pinned.",
    recommended_next_action:
      "Batch 2: confirm execution.blocked is emitted at every block branch (separate row below).",
  },
  {
    event_class: "execution.blocked",
    canonical_event_type: "execution.blocked",
    expected_chokepoint:
      "every place that refuses to release execution (collapse, poi-transition, match)",
    actual_chokepoint: null,
    writes_event_store: false,
    writes_audit_logs_only: false,
    status: "unwired",
    evidence: [
      "supabase/functions/_shared/governance-audit.ts:80 — \"execution.blocked\" declared in CONTROLLED_TAXONOMY",
      "No production caller emits \"execution.blocked\" (rg over supabase/functions/ found no event_type literal).",
    ],
    risk_note:
      "Block decisions exist in code but are not recorded as execution.blocked governance events. Under fail-closed enforcement this would prevent every blocked execution from completing — must be wired before any enforcement batch.",
    recommended_next_action:
      "Batch 2 (scope only — no live wiring): enumerate every block branch in collapse + poi-transition and propose where execution.blocked should be emitted.",
  },

  // ── Credit / token burn ────────────────────────────────────────────────
  {
    event_class: "credit.burn",
    canonical_event_type: "credit.burned",
    expected_chokepoint: "token-metering shared helper",
    actual_chokepoint: "supabase/functions/_shared/token-metering.ts",
    writes_event_store: false,
    writes_audit_logs_only: false,
    status: "partial",
    evidence: [
      "supabase/functions/_shared/token-metering.ts:5 — imports writeCriticalEventWithPosture",
      "supabase/functions/_shared/token-metering.ts:242 — event_type: \"credit.burned\"",
      "supabase/functions/_shared/token-metering.ts:283 — event_type: \"credit.burn_attempted\" (best-effort)",
      "supabase/functions/_shared/token-metering.ts:305 — event_type: \"credit.burn_blocked\" (best-effort)",
      "supabase/functions/_shared/token-metering.ts:607,648,669 — secondary emission paths",
    ],
    risk_note:
      "credit.burned uses the critical writer, but burn_attempted and burn_blocked use the best-effort writer. A failed write on a blocked burn would leave no governance record of the block.",
    recommended_next_action:
      "Batch 2: confirm whether burn_attempted / burn_blocked must be fail-closed; if blocking decisions must be provable, upgrade to writeCriticalEventWithPosture.",
  },

  // ── Payment ────────────────────────────────────────────────────────────
  {
    event_class: "payment.event",
    canonical_event_type: "payment.event_created",
    expected_chokepoint: "payment-governance shared helper + token-purchase",
    actual_chokepoint:
      "supabase/functions/_shared/payment-governance.ts, supabase/functions/token-purchase/index.ts",
    writes_event_store: true,
    writes_audit_logs_only: false,
    status: "wired",
    evidence: [
      "supabase/functions/_shared/payment-governance.ts:25 — imports writeCriticalEventWithPosture",
      "supabase/functions/_shared/payment-governance.ts:112 — event_type: \"payment.event_created\"",
      "supabase/functions/token-purchase/index.ts:1146 — event_type: \"payment.event_created\"",
    ],
    risk_note: "Critical writer used at both call-sites.",
    recommended_next_action:
      "Batch 2: confirm Paystack webhook commit path also routes through payment-governance helper.",
  },

  // ── Dispute ────────────────────────────────────────────────────────────
  {
    event_class: "dispute.opened",
    canonical_event_type: "dispute.opened",
    expected_chokepoint: "match-challenges edge function (dispute raise)",
    actual_chokepoint: "supabase/functions/match-challenges/index.ts",
    writes_event_store: true,
    writes_audit_logs_only: false,
    status: "wired",
    evidence: [
      "supabase/functions/match-challenges/index.ts:29 — imports writeCriticalEventWithPosture",
      "supabase/functions/match-challenges/index.ts:375 — idempotency_key pinned to dispute.opened",
      "supabase/functions/_shared/governance-policy-versions.ts:48 — DISPUTE_POLICY_VERSION pinned",
    ],
    risk_note: "Critical writer used and policy version pinned.",
    recommended_next_action:
      "Batch 2: confirm atomic dispute open inserts match_challenges row and emits event in the same tx.",
  },
  {
    event_class: "dispute.release_and_close",
    canonical_event_type: "dispute.released | dispute.closed",
    expected_chokepoint: "match-challenges edge function (state transitions)",
    actual_chokepoint: "supabase/functions/match-challenges/index.ts",
    writes_event_store: true,
    writes_audit_logs_only: false,
    status: "wired",
    evidence: [
      "supabase/functions/match-challenges/index.ts:570 — event_type: p.to_status === \"withdrawn\" ? \"dispute.released\" : \"dispute.closed\"",
      "supabase/functions/match-challenges/index.ts:583 — idempotency_key pinned per outcome",
    ],
    risk_note:
      "Both terminal transitions covered by the critical writer; ownership of the resolving action is enforced separately (see mem://governance/dispute-management-actions).",
    recommended_next_action:
      "Batch 2: verify no third terminal status exists that would bypass these two branches.",
  },

  // ── Legal hold ─────────────────────────────────────────────────────────
  {
    event_class: "legal_hold.apply_release",
    canonical_event_type: "legal_hold.applied | legal_hold.released",
    expected_chokepoint: "admin-legal-hold edge function",
    actual_chokepoint: "supabase/functions/admin-legal-hold/index.ts",
    writes_event_store: true,
    writes_audit_logs_only: false,
    status: "wired",
    evidence: [
      "supabase/functions/admin-legal-hold/index.ts:246 — idempotency_key pinned to legal_hold.applied",
      "supabase/functions/admin-legal-hold/index.ts:355 — idempotency_key pinned to legal_hold.released",
      "supabase/functions/admin-legal-hold/index.ts:319,418 — paired admin_audit_logs writes preserved",
      "supabase/functions/_shared/governance-policy-versions.ts:52-53 — LEGAL_HOLD_POLICY_VERSION pinned",
    ],
    risk_note:
      "Both event_store and admin_audit_logs receive paired writes; AAL2-gated. Atomic apply path documented as single tx.",
    recommended_next_action:
      "Batch 2: assert tx atomicity in code (single insert into legal_holds + event_store row).",
  },

  // ── Memory ─────────────────────────────────────────────────────────────
  {
    event_class: "memory.write",
    canonical_event_type: "memory.record_created",
    expected_chokepoint: "basic-memory-record-write edge function",
    actual_chokepoint: "supabase/functions/basic-memory-record-write/index.ts",
    writes_event_store: false,
    writes_audit_logs_only: true,
    status: "unwired",
    evidence: [
      "supabase/functions/_shared/governance-audit.ts:105 — \"memory.record_created\" declared in CONTROLLED_TAXONOMY",
      "rg over supabase/functions/ for event_type: \"memory.record_created\" — no caller emits it.",
      "supabase/functions/basic-memory-record-write/index.ts — writes audit_logs but does not import the critical writer.",
    ],
    risk_note:
      "Memory writes are critical per the binding decisions ('If the platform cannot prove a critical governance event, it must not complete that critical event.') but currently produce no event_store row. Under fail-closed enforcement every memory write would be blocked until wired.",
    recommended_next_action:
      "Batch 2: scope wiring memory.record_created via writeCriticalEventWithPosture in basic-memory-record-write; preserve existing audit_logs row.",
  },

  // ── Export ─────────────────────────────────────────────────────────────
  {
    event_class: "export.governance_record",
    canonical_event_type: "export.governance_record_exported",
    expected_chokepoint:
      "admin-governance-export-{request,approve} edge functions",
    actual_chokepoint:
      "supabase/functions/admin-governance-export-request/index.ts, supabase/functions/admin-governance-export-approve/index.ts",
    writes_event_store: false,
    writes_audit_logs_only: true,
    status: "audit_logs_only",
    evidence: [
      "supabase/functions/_shared/governance-audit.ts:106 — \"export.governance_record_exported\" declared in CONTROLLED_TAXONOMY",
      "rg over supabase/functions/ for event_type: \"export.governance_record_exported\" — no caller emits it.",
      "Admin Export Controls Batch 2-11 guards confirm canonical data.admin_export_* audit_logs names instead (see RELEASE_GATE.md).",
    ],
    risk_note:
      "Exports of the governance record itself are tracked in audit_logs (data.admin_export_*) but not in event_store. Binding decisions list 'export events' as a critical class — drift between the two surfaces is the gap.",
    recommended_next_action:
      "Batch 2: decide whether data.admin_export_* should be mirrored as export.governance_record_exported in event_store, or whether audit_logs is the canonical surface for export and the binding decision should be amended.",
  },

  // ── Admin override / HQ decision ───────────────────────────────────────
  {
    event_class: "admin.hq_decision",
    canonical_event_type: "admin.hq_decision_recorded",
    expected_chokepoint:
      "admin-hq-audit shared helper (wraps every sensitive HQ decision)",
    actual_chokepoint: "supabase/functions/_shared/admin-hq-audit.ts",
    writes_event_store: true,
    writes_audit_logs_only: false,
    status: "wired",
    evidence: [
      "supabase/functions/_shared/admin-hq-audit.ts:22 — imports writeCriticalEventWithPosture",
      "supabase/functions/_shared/admin-hq-audit.ts:74-75 — event_type: \"admin.hq_decision_recorded\"",
      "supabase/functions/_shared/governance-audit.ts:228-247 — listed in CRITICAL_SPECIFIC_NAMES (fail-closed by name)",
    ],
    risk_note:
      "Critical writer used and event name pinned in CRITICAL_SPECIFIC_NAMES. Per-callsite coverage (every admin override actually routes through this helper) is the open question.",
    recommended_next_action:
      "Batch 2: enumerate every admin-* edge function and confirm each sensitive mutation passes through admin-hq-audit (or document why not).",
  },

  // ── HQ notes / corrections ─────────────────────────────────────────────
  {
    event_class: "hq.note_added",
    canonical_event_type: "hq.note_added",
    expected_chokepoint: "hq-note-add edge function",
    actual_chokepoint: "supabase/functions/hq-note-add/index.ts",
    writes_event_store: true,
    writes_audit_logs_only: false,
    status: "wired",
    evidence: [
      "supabase/functions/hq-note-add/index.ts:19 — imports writeCriticalEventWithPosture",
      "supabase/functions/hq-note-add/index.ts:133 — writeCriticalEventWithPosture call-site",
      "supabase/functions/_shared/governance-audit.ts:233 — pinned in CRITICAL_SPECIFIC_NAMES",
    ],
    risk_note:
      "Fail-closed by name. Note text is append-only (original event never edited).",
    recommended_next_action:
      "Batch 2: nothing required for this class.",
  },
  {
    event_class: "hq.event_corrected",
    canonical_event_type: "hq.event_corrected",
    expected_chokepoint: "hq-note-add (correction branch)",
    actual_chokepoint: "supabase/functions/hq-note-add/index.ts",
    writes_event_store: true,
    writes_audit_logs_only: false,
    status: "wired",
    evidence: [
      "supabase/functions/_shared/governance-audit.ts:234 — pinned in CRITICAL_SPECIFIC_NAMES",
      "src/lib/governance/governance-record.ts:192 — categoriser maps hq.event_corrected to hq_correction",
    ],
    risk_note: "Same writer as hq.note_added; same fail-closed posture.",
    recommended_next_action: "Batch 2: nothing required for this class.",
  },

  // ── Governance waivers / bypasses ─────────────────────────────────────
  {
    event_class: "governance.waiver_lifecycle",
    canonical_event_type:
      "governance.waiver_granted | renewed | consumed | expired",
    expected_chokepoint: "governance-waivers shared helper",
    actual_chokepoint: "supabase/functions/_shared/governance-waivers.ts",
    writes_event_store: true,
    writes_audit_logs_only: false,
    status: "wired",
    evidence: [
      "supabase/functions/_shared/governance-waivers.ts:28 — imports writeCriticalEventWithPosture",
      "supabase/functions/_shared/governance-waivers.ts:186,374,421 — three lifecycle call-sites",
      "supabase/functions/_shared/governance-audit.ts:239-246 — all four lifecycle names pinned in CRITICAL_SPECIFIC_NAMES",
    ],
    risk_note: "Lifecycle fully wired and fail-closed by name.",
    recommended_next_action:
      "Batch 2: confirm bypass_* lifecycle parity (same helper).",
  },
];

function jsonResponse(req: Request, body: unknown, status = 200) {
  return withCors(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  );
}

async function writeCanonicalAudit(
  admin: any,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from("audit_logs").insert({
      org_id: null,
      actor_user_id: (payload.actor_user_id as string | null) ?? null,
      action: COVERAGE_AUDIT_NAME,
      entity_type: "event_store",
      entity_id: null,
      metadata: payload,
    });
  } catch (e) {
    console.error(`[governance-record-coverage-probe] audit write failed:`, e);
  }
}

function summarise(rows: ReadonlyArray<CoverageRow>) {
  const counts: Record<CoverageStatus, number> = {
    wired: 0,
    partial: 0,
    audit_logs_only: 0,
    unwired: 0,
    not_applicable: 0,
    unknown_needs_manual_review: 0,
  };
  for (const r of rows) counts[r.status]++;
  return {
    total_classes: rows.length,
    by_status: counts,
    fail_closed_blockers: rows
      .filter((r) =>
        r.status === "unwired" ||
        r.status === "audit_logs_only" ||
        r.status === "unknown_needs_manual_review"
      )
      .map((r) => r.event_class),
  };
}

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  let callerId: string | null = null;

  try {
    // 1. Auth
    const authHeader =
      req.headers.get("Authorization") ?? req.headers.get("authorisation");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse(req, { error: "Unauthorised" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userRes, error: authError } = await admin.auth.getUser(token);
    if (authError || !userRes?.user) {
      return jsonResponse(req, { error: "Invalid token" }, 401);
    }
    callerId = userRes.user.id;

    // 2. RBAC — platform_admin only
    const { data: hasAdmin, error: roleError } = await admin.rpc("has_role", {
      _user_id: callerId,
      _role: "platform_admin",
    });
    if (roleError) {
      return jsonResponse(req, { error: "Authorisation check failed" }, 500);
    }
    if (!hasAdmin) {
      return jsonResponse(req, { error: "Platform admin access required" }, 403);
    }

    // 3. AAL2 / MFA — required
    try {
      await assertAal2(authHeader, {
        adminClient: admin,
        callerUserId: callerId,
        action: "governance.event_store.coverage_probe",
      });
    } catch (mfaErr) {
      if (mfaErr instanceof ApiException && mfaErr.code === "MFA_REQUIRED") {
        return jsonResponse(req, { error: mfaErr.message, code: "MFA_REQUIRED" }, 403);
      }
      throw mfaErr;
    }

    // 4. Emit canonical audit BEFORE returning the report.
    await writeCanonicalAudit(admin, {
      actor_user_id: callerId,
      request_id: requestId,
      matrix_size: COVERAGE_MATRIX.length,
    });

    // 5. Return STATIC coverage matrix. No row-level event_store reads.
    //    No event_store payload contents. No PII. No introspection.
    return jsonResponse(req, {
      ok: true,
      assessment_only: true,
      reads_event_store_rows: false,
      mutates_event_store: false,
      adds_fail_closed_enforcement: false,
      audit_name: COVERAGE_AUDIT_NAME,
      coverage_matrix: COVERAGE_MATRIX,
      summary: summarise(COVERAGE_MATRIX),
      request_id: requestId,
    });
  } catch (err) {
    console.error("[governance-record-coverage-probe] error:", err);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
