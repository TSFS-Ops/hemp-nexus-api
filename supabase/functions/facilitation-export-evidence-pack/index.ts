/**
 * facilitation-export-evidence-pack — Batch 8 per-case evidence pack.
 *
 * Allowed roles: platform_admin ONLY.
 *
 * Returns a structured JSON pack for a single case, scoped strictly to that
 * case (no unrelated tenants, no unrelated cases). Contents:
 *   case summary, intake fields, status history, admin actions,
 *   evidence/source summaries, registry/KYB manual checks,
 *   sanctions/PEP manual checks, contact attempts,
 *   organisation/profile linking record, ready-for-POI record,
 *   final outcome/conversion record (if present).
 *
 * No PDF generation in Phase 1 — JSON is the safe, exportable format.
 * No mutations. No outreach.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "npm:zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(req: Request, body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return withCors(req, new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  }));
}

const BodySchema = z.object({ case_id: z.string().uuid() });

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
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
  try { parsed = BodySchema.safeParse(await req.json()); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  if (!parsed.success) return json(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // ── platform_admin ONLY.
  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "platform_admin")
    .maybeSingle();
  if (!roleRow) return json(req, { error: "Forbidden" }, 403);

  const caseId = parsed.data.case_id;
  const { data: kase, error: kerr } = await admin.from("facilitation_cases").select("*").eq("id", caseId).maybeSingle();
  if (kerr) return json(req, { error: kerr.message }, 500);
  if (!kase) return json(req, { error: "Not found" }, 404);

  // ── Parallel fetch of all related rows (always scoped to this case_id).
  const [
    { data: events },
    { data: contacts },
    { data: registry },
    { data: sanctions },
    { data: evidenceRows },
    { data: org },
    { data: linkedOrg },
    { data: requesterProfile },
    { data: ownerProfile },
  ] = await Promise.all([
    admin.from("facilitation_case_events").select("*").eq("case_id", caseId).order("created_at"),
    admin.from("facilitation_case_contact_attempts").select("*").eq("case_id", caseId).order("contact_at"),
    admin.from("facilitation_case_registry_checks").select("*").eq("case_id", caseId).order("created_at"),
    admin.from("facilitation_case_sanctions_checks").select("*").eq("case_id", caseId).order("created_at"),
    admin.from("facilitation_case_evidence").select("id, original_filename, mime_type, size_bytes, created_at, uploaded_by").eq("case_id", caseId).order("created_at"),
    kase.requesting_org_id
      ? admin.from("organizations").select("id, name, country").eq("id", kase.requesting_org_id).maybeSingle()
      : Promise.resolve({ data: null }),
    kase.linked_organization_id
      ? admin.from("organizations").select("id, name, country").eq("id", kase.linked_organization_id).maybeSingle()
      : Promise.resolve({ data: null }),
    kase.requesting_user_id
      ? admin.from("profiles").select("id, full_name, email").eq("id", kase.requesting_user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    kase.case_owner_id
      ? admin.from("profiles").select("id, full_name, email").eq("id", kase.case_owner_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const profileLabel = (p: { full_name: string | null; email: string | null } | null) =>
    p ? (p.full_name || p.email || "—") : null;

  const pack = {
    pack_version: "1.0",
    generated_at: new Date().toISOString(),
    generated_by: userId,
    case_summary: {
      case_number: kase.case_number,
      created: kase.created_at,
      closed: kase.closed_at,
      current_status: kase.internal_status,
      user_facing_status: kase.user_facing_status,
      urgency: kase.urgency,
      is_overdue: kase.is_overdue,
      overdue_reasons: kase.overdue_reasons,
      requester_organisation: org ? { name: org.name, country: org.country } : null,
      requester_user: profileLabel(requesterProfile as never),
      case_owner: profileLabel(ownerProfile as never),
    },
    intake: {
      counterparty_legal_name: kase.counterparty_legal_name,
      counterparty_trading_name: kase.counterparty_trading_name,
      counterparty_country: kase.counterparty_country,
      counterparty_city: kase.counterparty_city,
      counterparty_website: kase.counterparty_website,
      product_or_commodity: kase.product_or_commodity,
      sector: kase.sector,
      role: kase.role,
      estimated_value: kase.estimated_value_amount,
      estimated_value_currency: kase.estimated_value_currency,
      reason: kase.reason,
      how_user_knows_counterparty: kase.how_user_knows_counterparty,
      how_user_knows_notes: kase.how_user_knows_notes,
      relationship_status: kase.relationship_status,
      registration_number: kase.registration_number,
      tax_vat_number: kase.tax_vat_number,
      physical_address: kase.physical_address,
      contact_person_title: kase.contact_person_title,
      contact_person_phone: kase.contact_person_phone,
      contact_person_email: kase.contact_person_email,
      preferred_contact_language: kase.preferred_contact_language,
      source_evidence_summary: kase.source_evidence_summary,
      target_response_date: kase.target_response_date,
      permission_to_contact: kase.permission_to_contact,
      user_declaration_accepted: kase.user_declaration_accepted,
      user_declaration_accepted_at: kase.user_declaration_accepted_at,
    },
    status_history: (events ?? [])
      .filter((e: { action: string }) => e.action === "facilitation_case.status_changed")
      .map((e: Record<string, unknown>) => ({
        at: e.created_at,
        from_status: e.from_status,
        to_status: e.to_status,
        actor_user_id: e.actor_user_id,
      })),
    admin_actions: (events ?? [])
      .filter((e: { action: string }) =>
        ![
          "facilitation_case.sla_evaluated",
          "facilitation_case.reminder_sent",
          "facilitation_case.overdue_marked",
          "facilitation_case.overdue_cleared",
        ].includes(e.action),
      )
      .map((e: Record<string, unknown>) => ({
        at: e.created_at,
        action: e.action,
        from_status: e.from_status,
        to_status: e.to_status,
        actor_user_id: e.actor_user_id,
      })),
    evidence_files: (evidenceRows ?? []).map((r: Record<string, unknown>) => ({
      filename: r.original_filename,
      mime_type: r.mime_type,
      size_bytes: r.size_bytes,
      uploaded_at: r.created_at,
      uploaded_by: r.uploaded_by,
    })),
    registry_kyb_manual_checks: (registry ?? []).map((r: Record<string, unknown>) => ({
      at: r.created_at,
      provider_name: r.provider_name,
      lookup_date: r.lookup_date,
      result: r.result,
      confidence: r.confidence,
      source_reference: r.source_reference,
      note: r.note,
      evidence_summary: r.evidence_summary,
      actor_user_id: r.actor_user_id,
    })),
    sanctions_pep_manual_checks: (sanctions ?? []).map((r: Record<string, unknown>) => ({
      at: r.created_at,
      screening_source: r.screening_source,
      screening_date: r.screening_date,
      result: r.result,
      matched_name: r.matched_name,
      risk_level: r.risk_level,
      compliance_decision: r.compliance_decision,
      note: r.note,
      evidence_summary: r.evidence_summary,
      actor_user_id: r.actor_user_id,
    })),
    contact_attempts: (contacts ?? []).map((r: Record<string, unknown>) => ({
      at: r.contact_at,
      channel: r.channel,
      recipient: r.recipient,
      contact_details_used: r.contact_details_used,
      result: r.result,
      note: r.note,
      next_action_date: r.next_action_date,
      evidence_summary: r.evidence_summary,
      actor_user_id: r.actor_user_id,
    })),
    organisation_profile_linking: kase.linked_organization_id
      ? {
        linked_organisation: linkedOrg ? { name: linkedOrg.name, country: linkedOrg.country } : null,
        linked_at: kase.linked_organization_linked_at,
        linked_by: kase.linked_organization_linked_by,
        reason: kase.linked_organization_reason,
        evidence_summary: kase.linked_organization_evidence_summary,
      }
      : null,
    profile_record: kase.profile_record_recorded_at
      ? {
        reference: kase.profile_record_reference,
        note: kase.profile_record_note,
        evidence_summary: kase.profile_record_evidence_summary,
        recorded_at: kase.profile_record_recorded_at,
        recorded_by: kase.profile_record_recorded_by,
      }
      : null,
    ready_for_poi: kase.ready_for_poi_at
      ? {
        at: kase.ready_for_poi_at,
        by: kase.ready_for_poi_by,
        authority_summary: kase.ready_for_poi_authority_summary,
      }
      : null,
    poi_conversion: kase.poi_conversion_recorded_at
      ? {
        reference: kase.poi_conversion_reference,
        reason: kase.poi_conversion_reason,
        evidence_summary: kase.poi_conversion_evidence_summary,
        recorded_at: kase.poi_conversion_recorded_at,
        recorded_by: kase.poi_conversion_recorded_by,
      }
      : null,
    final_outcome: kase.final_outcome
      ? {
        outcome: kase.final_outcome,
        closing_reason: kase.closing_reason,
        closed_at: kase.closed_at,
      }
      : null,
  };

  // Audit (best-effort).
  await admin.from("audit_logs").insert({
    action: "facilitation.management.evidence_pack_exported",
    user_id: userId,
    metadata: { case_id: caseId, case_number: kase.case_number },
  }).then(() => undefined).catch(() => undefined);

  const filename = `evidence-pack-${kase.case_number ?? caseId}-${new Date().toISOString().slice(0, 10)}.json`;
  return json(req, pack, 200, {
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });
});
