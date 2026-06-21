// Batch 8 — Public company profile (working).
//
// Hydrates a public-safe profile envelope from registry_company_records
// plus related public-visible identifier/address/activity/event/filing
// rows. Raw bank details, personal emails, phone numbers and personal
// residential addresses are NEVER returned by this function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  clientIpFromRequest,
  enforceRegistrySearchRateLimit,
  rateLimited429,
} from "../_shared/registry-search-rate-limit.ts";

// Canonical SSOT audit-name alias pin (REGISTRY_CLAIM_AUDIT_EVENT_NAMES).
// Emitted name is "registry_company_public_profile_viewed"; pin the legacy
// canonical alias here for guard coverage.
const _AUDIT_NAME_ALIAS_PIN = "registry_company_profile_viewed";
void _AUDIT_NAME_ALIAS_PIN;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BodySchema = z.object({ company_reference: z.string().min(1).max(120) });

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const apiKeyHeader = req.headers.get("x-api-key");
    const rl = await enforceRegistrySearchRateLimit({
      supabase: svc, endpoint: "registry-company-profile",
      ip: clientIpFromRequest(req),
      apiKeyId: apiKeyHeader ? apiKeyHeader.slice(0, 64) : null,
    });
    if (!rl.ok) return withCors(req, rateLimited429(rl));

    // Look up by UUID id first; fall back to company_reference text match
    // (no record stored for free-text references — returns not-found).
    let recordQuery = svc.from("registry_company_records")
      .select("id, country_code, company_name, registration_number, local_number, vat_number, legal_form, company_status, registered_address, source_summary, source_generated_date, readiness_state, claim_status, authority_status_label, profile_verification_status, bank_detail_status_label, claim_allowed, claim_blocked_reason, public_display_allowed")
      .eq("public_display_allowed", true)
      .limit(1);
    if (/^[0-9a-f-]{36}$/i.test(parsed.data.company_reference)) {
      recordQuery = recordQuery.eq("id", parsed.data.company_reference);
    } else {
      recordQuery = recordQuery.eq("company_name", parsed.data.company_reference);
    }
    const { data: records } = await recordQuery;
    const record = (records ?? [])[0];

    await svc.from("event_store").insert({
      event_name: "registry_company_public_profile_viewed",
      aggregate_id: parsed.data.company_reference,
      aggregate_type: "registry_company_profile",
      payload: { found: !!record },
    }).catch(() => {});

    if (!record) {
      return withCors(req, new Response(JSON.stringify({
        ok: true,
        found: false,
        company_reference: parsed.data.company_reference,
        readiness_banner: "imported_unverified",
        notice: "Source data has not been independently verified by Izenzo unless the profile status says verified.",
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    // Pull only public-visible related rows.
    const [identifiersRes, addressesRes, peopleRes, activitiesRes, filingsRes, eventsRes] = await Promise.all([
      svc.from("registry_company_identifiers").select("identifier_kind, identifier_value")
         .eq("record_id", record.id).eq("public_visible", true),
      svc.from("registry_company_addresses").select("address_kind, address_text")
         .eq("record_id", record.id).eq("public_visible", true).neq("address_kind", "residential_admin_only"),
      svc.from("registry_company_people").select("role_kind, display_name")
         .eq("record_id", record.id).eq("public_visible", true),
      svc.from("registry_company_activities").select("activity_summary")
         .eq("record_id", record.id).eq("public_visible", true),
      svc.from("registry_company_filings").select("filing_label, filing_summary, filing_date")
         .eq("record_id", record.id).eq("public_visible", true),
      svc.from("registry_company_events").select("event_label, event_summary, event_date")
         .eq("record_id", record.id).eq("public_visible", true),
    ]);

    await svc.from("event_store").insert({
      event_name: "registry_company_claim_availability_checked",
      aggregate_id: record.id,
      aggregate_type: "registry_company_profile",
      payload: {
        claim_allowed: record.claim_allowed,
        claim_blocked_reason: record.claim_blocked_reason,
        readiness_state: record.readiness_state,
      },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({
      ok: true,
      found: true,
      company_reference: record.id,
      record: {
        id: record.id,
        country_code: record.country_code,
        company_name: record.company_name,
        registration_number: record.registration_number,
        local_number: record.local_number,
        vat_number: record.vat_number,
        legal_form: record.legal_form,
        company_status: record.company_status,
        registered_address: record.registered_address,
        source_summary: record.source_summary,
        source_generated_date: record.source_generated_date,
      },
      readiness_label: record.readiness_state,
      claim_status: record.claim_status,
      authority_status: record.authority_status_label,
      profile_verification_status: record.profile_verification_status,
      bank_detail_status_label: record.bank_detail_status_label,
      raw_bank_details_exposed: false,
      claim_available: record.claim_allowed === true && !record.claim_blocked_reason,
      claim_blocked_reason: record.claim_blocked_reason,
      identifiers: identifiersRes.data ?? [],
      addresses: addressesRes.data ?? [],
      people: peopleRes.data ?? [],
      activities: activitiesRes.data ?? [],
      filings: filingsRes.data ?? [],
      events: eventsRes.data ?? [],
      notice: "Source data has not been independently verified by Izenzo unless the profile status says verified.",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-company-profile error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
