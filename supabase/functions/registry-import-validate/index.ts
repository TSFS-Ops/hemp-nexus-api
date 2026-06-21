// Batch 9 — Validate every staged record in an import batch.
//
// Rules applied per row:
//   - Required: company_name, country_code, source_summary (provenance), source_generated_date (or batch upload date), at least one identifier (warning if missing).
//   - Reject: bank-detail-shaped strings in any field, sensitive personal data mapped to public visibility (cross-checked with field mappings).
//   - Warn: missing identifier, unsupported legal form.
//   - Duplicate detection: registration/local/VAT number against existing registry_company_records, registration/VAT against earlier staging rows in the same batch, exact company_name + country_code.
// Writes outcomes to registry_import_records_staging, validation_results,
// duplicate_candidates and quarantine. Updates the batch state to 'validated'
// when at least one row is valid, otherwise 'validation_failed'.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({ batch_id: z.string().uuid() });

const BANK_DETAIL_PATTERNS = [
  /\biban\b/i, /\bswift\b/i, /\bbic\b/i, /\bsort\s*code\b/i,
  /\baccount\s*number\b/i, /\brouting\s*number\b/i, /\bbank\s*account\b/i,
  /\b[0-9]{9,18}\b/, // long numeric tokens commonly seen in account numbers
];

const SUPPORTED_LEGAL_FORMS = new Set([
  "ltd","limited","plc","pty","pty ltd","cc","close corporation",
  "llp","llc","inc","gmbh","sa","sarl","npc","ngo","trust","sole prop","sole proprietor",
]);

function looksLikeBankDetail(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return BANK_DETAIL_PATTERNS.some(p => p.test(value));
}

interface StagingRow {
  id: string;
  company_name: string | null;
  country_code: string | null;
  registration_number: string | null;
  local_number: string | null;
  vat_number: string | null;
  legal_form: string | null;
  registered_address: string | null;
  source_summary: string | null;
  source_generated_date: string | null;
  contact_email_admin_only: string | null;
  contact_phone_admin_only: string | null;
  raw_extra: Record<string, unknown>;
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }));

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return withCors(req, new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers: { "Content-Type": "application/json" } }));

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has("platform_admin") && !roleSet.has("compliance_owner")) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    const batchId = parsed.data.batch_id;

    // Mark batch validating + audit start
    await svc.from("registry_import_batches").update({ state: "validating" }).eq("id", batchId);
    await svc.from("event_store").insert({
      event_name: "registry_import_validation_started",
      aggregate_id: batchId, aggregate_type: "registry_import_batch", actor_id: user.id,
      payload: {},
    }).catch(() => {});

    const { data: rows } = await svc.from("registry_import_records_staging")
      .select("id, company_name, country_code, registration_number, local_number, vat_number, legal_form, registered_address, source_summary, source_generated_date, contact_email_admin_only, contact_phone_admin_only, raw_extra")
      .eq("batch_id", batchId)
      .order("row_number");

    const stagingRows = (rows ?? []) as StagingRow[];

    // Field mappings to check forbidden public mappings cross-check.
    const { data: mappings } = await svc.from("registry_import_field_mappings")
      .select("target_field, visibility").eq("batch_id", batchId);
    const hasForbiddenPublicMapping = (mappings ?? []).some((m: { target_field: string; visibility: string }) =>
      (m.target_field === "contact_email" || m.target_field === "contact_phone") &&
      (m.visibility === "public_searchable" || m.visibility === "public_visible" || m.visibility === "masked_public"));

    let validCount = 0, warnCount = 0, quarantinedCount = 0, rejectedCount = 0, dupCount = 0;

    // Track in-batch identifiers to detect intra-batch duplicates.
    const intraReg = new Map<string, string>();
    const intraVat = new Map<string, string>();
    const intraNameCountry = new Map<string, string>();

    for (const row of stagingRows) {
      const issues: Array<{ rule_code: string; severity: "info"|"warning"|"error"|"block"; message: string; field_name?: string }> = [];
      let quarantineReason: string | null = null;

      if (!row.company_name) issues.push({ rule_code: "missing_company_name", severity: "error", message: "Company name is required.", field_name: "company_name" });
      if (!row.country_code) issues.push({ rule_code: "missing_country_code", severity: "error", message: "Country code is required.", field_name: "country_code" });
      if (row.country_code && !/^[A-Z]{2,3}$/.test(row.country_code)) issues.push({ rule_code: "invalid_country_code", severity: "error", message: "Country code must be ISO 2 or 3 letters.", field_name: "country_code" });
      if (!row.source_summary) issues.push({ rule_code: "missing_source", severity: "error", message: "Source summary is required.", field_name: "source_summary" });
      if (!row.source_generated_date) issues.push({ rule_code: "missing_source_generated_date", severity: "warning", message: "Source generated date missing — upload date will be used.", field_name: "source_generated_date" });

      const hasIdentifier = !!(row.registration_number || row.local_number || row.vat_number);
      if (!hasIdentifier) issues.push({ rule_code: "identifier_missing_review_required", severity: "warning", message: "No registration/local/tax number provided.", field_name: "registration_number" });

      if (row.legal_form && !SUPPORTED_LEGAL_FORMS.has(row.legal_form.trim().toLowerCase())) {
        issues.push({ rule_code: "unsupported_legal_form", severity: "warning", message: `Legal form not in supported list: ${row.legal_form}`, field_name: "legal_form" });
      }

      // Bank-detail / sensitive scan across public-shaped fields
      const publicFields: Array<[string, unknown]> = [
        ["company_name", row.company_name],
        ["registration_number", row.registration_number],
        ["local_number", row.local_number],
        ["vat_number", row.vat_number],
        ["registered_address", row.registered_address],
        ["source_summary", row.source_summary],
      ];
      for (const [name, value] of publicFields) {
        if (looksLikeBankDetail(value)) {
          issues.push({ rule_code: "raw_bank_detail_detected", severity: "block", message: `Bank-detail-shaped content detected in ${name}.`, field_name: name });
          quarantineReason = "raw_bank_detail_detected";
        }
      }

      if (hasForbiddenPublicMapping) {
        issues.push({ rule_code: "sensitive_personal_data_mapped_public", severity: "block", message: "Field mappings expose personal contact fields to public tier.", field_name: "contact_email" });
        quarantineReason = quarantineReason ?? "sensitive_personal_data_mapped_public";
      }

      // Duplicate detection — DB lookups
      const reasons: string[] = [];
      let dupConfidence: "low"|"medium"|"high"|"exact_identifier_match"|null = null;
      let dupCandidateId: string | null = null;

      if (row.registration_number) {
        const { data: hits } = await svc.from("registry_company_records")
          .select("id").eq("registration_number", row.registration_number).limit(1);
        if (hits && hits.length > 0) {
          reasons.push("registration_number_match");
          dupConfidence = "exact_identifier_match";
          dupCandidateId = hits[0].id;
        }
        const intra = intraReg.get(row.registration_number);
        if (intra && intra !== row.id) {
          reasons.push("intra_batch_registration_number");
          dupConfidence = "exact_identifier_match";
        }
        intraReg.set(row.registration_number, row.id);
      }
      if (row.vat_number) {
        const { data: hits } = await svc.from("registry_company_records")
          .select("id").eq("vat_number", row.vat_number).limit(1);
        if (hits && hits.length > 0) {
          reasons.push("vat_number_match");
          dupConfidence = dupConfidence ?? "exact_identifier_match";
          dupCandidateId = dupCandidateId ?? hits[0].id;
        }
        const intra = intraVat.get(row.vat_number);
        if (intra && intra !== row.id) { reasons.push("intra_batch_vat_number"); dupConfidence = dupConfidence ?? "exact_identifier_match"; }
        intraVat.set(row.vat_number, row.id);
      }
      if (row.company_name && row.country_code) {
        const nameKey = `${row.country_code.toUpperCase()}|${row.company_name.trim().toLowerCase()}`;
        const intra = intraNameCountry.get(nameKey);
        if (intra && intra !== row.id) { reasons.push("intra_batch_name_country"); dupConfidence = dupConfidence ?? "high"; }
        intraNameCountry.set(nameKey, row.id);

        if (!dupConfidence) {
          const { data: hits } = await svc.from("registry_company_records")
            .select("id").eq("country_code", row.country_code.toUpperCase()).eq("company_name", row.company_name).limit(1);
          if (hits && hits.length > 0) {
            reasons.push("name_country_match");
            dupConfidence = "high";
            dupCandidateId = dupCandidateId ?? hits[0].id;
          }
        }
      }

      // Compute outcome.
      const hasBlock = issues.some(i => i.severity === "block");
      const hasError = issues.some(i => i.severity === "error");
      const hasWarn  = issues.some(i => i.severity === "warning");

      let outcome: "valid"|"valid_with_warnings"|"quarantined"|"rejected"|"duplicate_review_required" = "valid";
      if (hasBlock) outcome = "quarantined";
      else if (hasError) outcome = "rejected";
      else if (dupConfidence === "exact_identifier_match" || dupConfidence === "high") outcome = "duplicate_review_required";
      else if (hasWarn) outcome = "valid_with_warnings";

      // Persist results.
      // Clear previous validation rows for idempotency.
      await svc.from("registry_import_record_validation_results").delete().eq("staging_id", row.id);
      if (issues.length > 0) {
        await svc.from("registry_import_record_validation_results").insert(
          issues.map(i => ({
            staging_id: row.id,
            rule_code: i.rule_code,
            severity: i.severity,
            message: i.message,
            field_name: i.field_name ?? null,
          })),
        );
      }

      await svc.from("registry_import_records_staging").update({
        validation_outcome: outcome,
        quarantine_reason: quarantineReason,
        duplicate_status: dupConfidence ?? "none",
      }).eq("id", row.id);

      if (outcome === "quarantined") {
        await svc.from("registry_import_quarantine").insert({
          staging_id: row.id,
          reason_code: quarantineReason ?? "missing_required_field",
          reason_detail: issues.filter(i => i.severity === "block").map(i => i.message).join("; "),
          status: "open",
        });
        await svc.from("event_store").insert({
          event_name: "registry_import_record_quarantined",
          aggregate_id: row.id, aggregate_type: "registry_import_records_staging", actor_id: user.id,
          payload: { reason_code: quarantineReason },
        }).catch(() => {});
        quarantinedCount++;
      }

      if (dupConfidence) {
        await svc.from("registry_import_duplicate_candidates").insert({
          staging_id: row.id,
          candidate_record_id: dupCandidateId,
          candidate_staging_id: null,
          confidence: dupConfidence,
          match_reasons: reasons,
        });
        await svc.from("event_store").insert({
          event_name: "registry_import_duplicate_candidate_detected",
          aggregate_id: row.id, aggregate_type: "registry_import_records_staging", actor_id: user.id,
          payload: { confidence: dupConfidence, reasons },
        }).catch(() => {});
        dupCount++;
      }

      if (outcome === "valid") validCount++;
      else if (outcome === "valid_with_warnings") warnCount++;
      else if (outcome === "rejected") rejectedCount++;
    }

    const summary = {
      total: stagingRows.length,
      valid: validCount,
      valid_with_warnings: warnCount,
      quarantined: quarantinedCount,
      rejected: rejectedCount,
      duplicates_flagged: dupCount,
    };
    const newState = (validCount + warnCount) > 0 ? "validated" : "validation_failed";
    await svc.from("registry_import_batches").update({
      state: newState,
      validation_summary: summary,
    }).eq("id", batchId);

    await svc.from("event_store").insert({
      event_name: "registry_import_validation_completed",
      aggregate_id: batchId, aggregate_type: "registry_import_batch", actor_id: user.id,
      payload: summary,
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({ ok: true, summary, state: newState }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-import-validate error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
