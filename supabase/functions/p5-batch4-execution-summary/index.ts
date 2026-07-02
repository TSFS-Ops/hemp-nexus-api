/**
 * P-5 Batch 4 Stage 3 — Internal-safe execution summary edge function.
 *
 * Internal only (NOT a public funder API). Returns audience-specific
 * projections:
 *
 *   audience = "admin"  → platform_admin only. Full safe-summary view.
 *   audience = "funder" → caller must belong to the funder org that has
 *                         a non-revoked, non-expired release for the
 *                         case. Returns the funder-safe field set only.
 *
 * Admin-safe and funder-safe field sets are disjoint where the brief
 * forbids overlap: funders must never see other funders' status,
 * internal notes, raw evidence references, or audit internals.
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertActorIdvGate, IdvGateError } from "../_shared/idv-actor-gate.ts";

const ADMIN_SAFE_FIELDS = [
  "id",
  "case_reference",
  "process_type",
  "execution_status",
  "readiness_status",
  "current_milestone",
  "blocker_count",
  "warning_count",
  "due_at",
  "funder_status",
  "finality_status",
  "provider_dependency_status",
  "owner_user_id",
  "created_at",
  "updated_at",
] as const;

const FUNDER_SAFE_FIELDS = [
  "case_reference",
  "process_type",
  "execution_status",
  "current_milestone",
  "readiness_status",
  "blocker_count",
  "warning_count",
  "funder_status",
  "due_at",
] as const;

// Stage 5 — Organisation / counterparty user audience. Strictly the
// safe task-focused projection. NO admin-only, internal, funder-release
// or audit fields. NO raw evidence references / hashes (those live on
// the evidence row itself and are never returned here).
const ORG_USER_SAFE_FIELDS = [
  "id",
  "case_reference",
  "process_type",
  "execution_status",
  "readiness_status",
  "current_milestone",
  "blocker_count",
  "warning_count",
  "due_at",
] as const;

const FORBIDDEN_ORG_USER_FIELDS = new Set([
  "owner_user_id",
  "created_by",
  "linked_company_id",
  "linked_transaction_id",
  "linked_project_id",
  "linked_workstream_id",
  "responsible_party_id",
  "memory_summary_id",
  "reopen_reason",
  "provider_dependency_status",
  "finality_status",
  "funder_status",
  "internal_note",
]);

const FORBIDDEN_FUNDER_FIELDS = new Set([
  "owner_user_id",
  "created_by",
  "linked_company_id",
  "linked_transaction_id",
  "linked_project_id",
  "linked_workstream_id",
  "responsible_party_id",
  "memory_summary_id",
  "reopen_reason",
  "provider_dependency_status",
  "finality_status",
]);

function projectRow<T extends Record<string, unknown>>(
  row: T,
  allowed: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowed) if (k in row) out[k] = row[k];
  for (const k of Object.keys(out)) {
    if (FORBIDDEN_FUNDER_FIELDS.has(k) && !allowed.includes(k as never)) {
      delete out[k];
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const audience = url.searchParams.get("audience");
    const caseId = url.searchParams.get("case_id");
    if (audience !== "admin" && audience !== "funder" && audience !== "org_user") {
      return json({ error: "invalid_audience" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "authentication_required" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "invalid_session" }, 401);
    const userId = userRes.user.id;

    if (audience === "admin") {
      const { data: isAdmin } = await supabase.rpc("p5b4_is_platform_admin");
      if (!isAdmin) return json({ error: "platform_admin_required" }, 403);
      const q = supabase
        .from("p5_batch4_execution_cases")
        .select(ADMIN_SAFE_FIELDS.join(","));
      const { data, error } = caseId ? await q.eq("id", caseId) : await q.limit(100);
      if (error) return json({ error: error.message }, 500);
      const rows = (data ?? []).map((r) =>
        projectRow(r as Record<string, unknown>, ADMIN_SAFE_FIELDS),
      );

      // Admin-only optional includes for a specific case.
      const include = (url.searchParams.get("include") ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      const extras: Record<string, unknown> = {};
      if (caseId && include.length > 0) {
        if (include.includes("milestones")) {
          const { data: ms } = await supabase
            .from("p5_batch4_execution_milestones")
            .select("id,milestone_key,milestone_name,milestone_status,mandatory_type,overdue_label,due_at,completed_at,sort_order")
            .eq("case_id", caseId)
            .order("sort_order", { ascending: true });
          extras.milestones = ms ?? [];
        }
        if (include.includes("blockers")) {
          const { data: bs } = await supabase
            .from("p5_batch4_blockers")
            .select("id,blocker_key,blocker_name,blocker_type,blocker_status,external_safe_label,internal_detail,opened_at,resolved_at")
            .eq("case_id", caseId)
            .order("opened_at", { ascending: false });
          extras.blockers = bs ?? [];
        }
        if (include.includes("evidence")) {
          const { data: ev } = await supabase
            .from("p5_batch4_evidence_items")
            .select("id,evidence_type,evidence_label,evidence_status,requirement_type,requested_at,reviewed_at,reject_reason")
            .eq("case_id", caseId)
            .order("requested_at", { ascending: true });
          extras.evidence = ev ?? [];
        }
        if (include.includes("audit")) {
          const { data: au } = await supabase
            .from("p5_batch4_audit_events")
            .select("id,event_type,external_safe,internal,actor_user_id,created_at")
            .eq("case_id", caseId)
            .order("created_at", { ascending: false })
            .limit(200);
          extras.audit = au ?? [];
        }
      }
      return json({ audience, cases: rows, ...extras });
    }

    // ---------------------------------------------------------------
    // audience === "org_user"
    // Organisation / counterparty surface. Scoped strictly to cases
    // owned by the calling user (owner_user_id = auth.uid()). Returns
    // ONLY the safe task-focused projection. NO funder data, NO audit,
    // NO internal blocker detail, NO raw evidence references / hashes.
    // ---------------------------------------------------------------
    if (audience === "org_user") {
      const q = supabase
        .from("p5_batch4_execution_cases")
        .select(ORG_USER_SAFE_FIELDS.join(","))
        .eq("owner_user_id", userId);
      const { data, error } = caseId
        ? await q.eq("id", caseId)
        : await q.limit(100);
      if (error) return json({ error: error.message }, 500);
      const rows = (data ?? []).map((r) => {
        const projected = projectRow(
          r as Record<string, unknown>,
          ORG_USER_SAFE_FIELDS,
        );
        for (const k of Object.keys(projected)) {
          if (FORBIDDEN_ORG_USER_FIELDS.has(k)) delete projected[k];
        }
        return projected;
      });

      const include = (url.searchParams.get("include") ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      const extras: Record<string, unknown> = {};
      if (caseId && rows.length > 0 && include.length > 0) {
        if (include.includes("milestones")) {
          const { data: ms } = await supabase
            .from("p5_batch4_execution_milestones")
            .select("id,milestone_key,milestone_name,milestone_status,mandatory_type,overdue_label,due_at,sort_order")
            .eq("case_id", caseId)
            .order("sort_order", { ascending: true });
          extras.milestones = ms ?? [];
        }
        if (include.includes("blockers")) {
          // External-safe label ONLY. Internal detail / blocker_key /
          // blocker_type are admin-only fields and never returned.
          const { data: bs } = await supabase
            .from("p5_batch4_blockers")
            .select("id,blocker_name,blocker_status,external_safe_label,opened_at,resolved_at")
            .eq("case_id", caseId)
            .order("opened_at", { ascending: false });
          extras.blockers = bs ?? [];
        }
        if (include.includes("evidence")) {
          // No file_reference / file_hash / reviewer identity. reject_reason
          // is the only feedback field returned — needed so the user knows
          // why their submission needs replacement.
          const { data: ev } = await supabase
            .from("p5_batch4_evidence_items")
            .select("id,evidence_type,evidence_label,evidence_status,requirement_type,requested_at,reject_reason")
            .eq("case_id", caseId)
            .order("requested_at", { ascending: true });
          extras.evidence = ev ?? [];
        }
      }
      return json({ audience, cases: rows, ...extras });
    }

    const { data: funderOrg } = await supabase.rpc("p5b4_current_funder_org");
    if (!funderOrg) return json({ error: "no_active_funder_membership" }, 403);

    const { data: releases, error: relErr } = await supabase
      .from("p5_batch4_funder_releases")
      .select("id,case_id,access_expires_at,status,download_allowed,nda_required,pack_reference")
      .eq("funder_org_id", funderOrg)
      .neq("status", "revoked")
      .gt("access_expires_at", new Date().toISOString());
    if (relErr) return json({ error: relErr.message }, 500);
    const releaseByCase = new Map<string, Record<string, unknown>>();
    for (const r of releases ?? []) releaseByCase.set(r.case_id as string, r as Record<string, unknown>);
    const allowedCaseIds = new Set(releaseByCase.keys());
    if (caseId && !allowedCaseIds.has(caseId)) {
      return json({ error: "case_not_released_to_funder" }, 403);
    }

    const ids = caseId ? [caseId] : [...allowedCaseIds];
    if (ids.length === 0) return json({ audience, cases: [] });

    const { data, error } = await supabase
      .from("p5_batch4_execution_cases")
      .select(FUNDER_SAFE_FIELDS.join(",") + ",id")
      .in("id", ids);
    if (error) return json({ error: error.message }, 500);
    const rows = (data ?? []).map((r) => {
      const projected = projectRow(r as Record<string, unknown>, FUNDER_SAFE_FIELDS);
      const caseRowId = (r as Record<string, unknown>).id as string;
      projected.id = caseRowId;
      const rel = releaseByCase.get(caseRowId);
      if (rel) {
        projected.release_id = rel.id;
        projected.access_expires_at = rel.access_expires_at;
        projected.release_status = rel.status;
        projected.download_allowed = rel.download_allowed;
        projected.nda_required = rel.nda_required;
        projected.pack_reference = rel.pack_reference;
      }
      return projected;
    });
    // Audit funder view
    if (caseId) {
      await supabase.rpc("p5b4_record_audit_event_v1", {
        p_case_id: caseId,
        p_event_type: "funder_pack_viewed",
        p_external_safe: "Funder viewed released pack.",
        p_internal: `funder_user=${userId}`,
      });
    }
    return json({ audience, cases: rows });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
