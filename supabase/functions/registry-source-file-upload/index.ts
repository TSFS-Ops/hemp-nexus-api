// Batch 9 — Registry source file upload + auto-stage.
//
// Authenticated platform_admin or compliance_owner only. Accepts one of:
//   - records[]   : array of structured company records (manual_records / json_payload)
//   - csv_text    : CSV text body (csv_payload)
//   - raw_text    : free text from an extracted source report (text_extract / pdf_text_paste)
// Creates:
//   - registry_source_files row with provenance + licence/permitted-use
//   - registry_import_batches row in state 'draft'
//   - registry_import_batch_rows + registry_import_records_staging per record
// Emits canonical audit events.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { SOURCE_FILE_TYPES, type SourceFileType } from "../_shared/registry-import-pipeline.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const RecordSchema = z.object({
  company_name: z.string().min(1).max(255).optional(),
  country_code: z.string().min(2).max(8).optional(),
  registration_number: z.string().max(60).optional(),
  local_number: z.string().max(60).optional(),
  vat_number: z.string().max(60).optional(),
  legal_form: z.string().max(60).optional(),
  company_status: z.string().max(60).optional(),
  registered_address: z.string().max(500).optional(),
  postal_address: z.string().max(500).optional(),
  trading_names: z.array(z.string().max(255)).max(20).optional(),
  previous_names: z.array(z.string().max(255)).max(20).optional(),
  source_summary: z.string().max(500).optional(),
  source_generated_date: z.string().max(40).optional(),
  activity_summary: z.string().max(1000).optional(),
  officers: z.array(z.object({
    name: z.string().max(200).optional(),
    role: z.string().max(120).optional(),
  })).max(50).optional(),
  filings: z.array(z.object({
    label: z.string().max(120).optional(),
    summary: z.string().max(500).optional(),
    date: z.string().max(40).optional(),
  })).max(50).optional(),
  events: z.array(z.object({
    label: z.string().max(120).optional(),
    summary: z.string().max(500).optional(),
    date: z.string().max(40).optional(),
  })).max(50).optional(),
  contact_email_admin_only: z.string().max(255).optional(),
  contact_phone_admin_only: z.string().max(64).optional(),
  raw_extra: z.record(z.unknown()).optional(),
}).passthrough();

const BodySchema = z.object({
  source_name: z.string().min(2).max(200),
  source_type: z.enum(SOURCE_FILE_TYPES as readonly [SourceFileType, ...SourceFileType[]]),
  source_id: z.string().uuid().optional(),
  country_code: z.string().min(2).max(8),
  provider_name: z.string().max(200).optional(),
  licence_reference: z.string().min(2).max(200),
  permitted_uses: z.array(z.string().min(2).max(60)).min(1),
  source_generated_date: z.string().max(40).optional(),
  source_reference: z.string().max(500).optional(),
  storage_url: z.string().url().optional(),
  batch_reference: z.string().min(3).max(120),
  records: z.array(RecordSchema).optional(),
  csv_text: z.string().optional(),
  raw_text: z.string().optional(),
});

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (cells[i] ?? "").trim(); });
    return row;
  });
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
    if (!parsed.success) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    const input = parsed.data;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has("platform_admin") && !roleSet.has("compliance_owner")) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    // Resolve records to stage from one of the supported inputs.
    let records: Record<string, unknown>[] = input.records ?? [];
    if (records.length === 0 && input.csv_text) {
      records = parseCsv(input.csv_text);
    }
    if (records.length === 0 && input.raw_text) {
      // Text extracts are saved as a single staged row carrying the raw_text in raw_extra.
      records = [{ raw_extra: { raw_text: input.raw_text.slice(0, 50000) } }];
    }

    // Create source file.
    const { data: sf, error: sfErr } = await svc.from("registry_source_files").insert({
      source_id: input.source_id ?? null,
      source_name: input.source_name,
      source_type: input.source_type,
      source_reference: input.source_reference ?? null,
      storage_url: input.storage_url ?? null,
      country_code: input.country_code.toUpperCase(),
      provider_name: input.provider_name ?? null,
      licence_reference: input.licence_reference,
      permitted_uses: input.permitted_uses,
      source_generated_date: input.source_generated_date ?? null,
      raw_payload: records.length > 0 ? records as unknown as Record<string, unknown> : null,
      raw_text: input.raw_text ?? null,
      parsing_status: "parsed",
      parsing_summary: { record_count: records.length, source_type: input.source_type },
      uploaded_by: user.id,
    }).select("id").single();
    if (sfErr) throw sfErr;

    // Create batch in draft.
    const { data: batch, error: batchErr } = await svc.from("registry_import_batches").insert({
      batch_reference: input.batch_reference,
      source_id: input.source_id ?? null,
      source_file_id: sf!.id,
      country_code: input.country_code.toUpperCase(),
      licence_reference: input.licence_reference,
      permitted_uses: input.permitted_uses,
      state: "uploaded",
      uploaded_by: user.id,
    }).select("id").single();
    if (batchErr) throw batchErr;

    // Stage records.
    for (let i = 0; i < records.length; i++) {
      const raw = records[i];
      const { data: rowRes, error: rowErr } = await svc.from("registry_import_batch_rows").insert({
        batch_id: batch!.id,
        row_number: i + 1,
        raw_payload: raw,
        validation_state: "pending",
      }).select("id").single();
      if (rowErr) throw rowErr;

      await svc.from("registry_import_records_staging").insert({
        batch_id: batch!.id,
        batch_row_id: rowRes!.id,
        row_number: i + 1,
        country_code: ((raw as Record<string, unknown>).country_code as string | undefined)
          ?? input.country_code.toUpperCase(),
        company_name: (raw as Record<string, unknown>).company_name as string | undefined ?? null,
        registration_number: (raw as Record<string, unknown>).registration_number as string | undefined ?? null,
        local_number: (raw as Record<string, unknown>).local_number as string | undefined ?? null,
        vat_number: (raw as Record<string, unknown>).vat_number as string | undefined ?? null,
        legal_form: (raw as Record<string, unknown>).legal_form as string | undefined ?? null,
        company_status: (raw as Record<string, unknown>).company_status as string | undefined ?? null,
        registered_address: (raw as Record<string, unknown>).registered_address as string | undefined ?? null,
        postal_address: (raw as Record<string, unknown>).postal_address as string | undefined ?? null,
        trading_names: ((raw as Record<string, unknown>).trading_names as string[] | undefined) ?? [],
        previous_names: ((raw as Record<string, unknown>).previous_names as string[] | undefined) ?? [],
        source_summary: (raw as Record<string, unknown>).source_summary as string | undefined ?? null,
        source_generated_date: ((raw as Record<string, unknown>).source_generated_date as string | undefined) ?? input.source_generated_date ?? null,
        activity_summary: (raw as Record<string, unknown>).activity_summary as string | undefined ?? null,
        officers: ((raw as Record<string, unknown>).officers as unknown[] | undefined) ?? [],
        filings:  ((raw as Record<string, unknown>).filings  as unknown[] | undefined) ?? [],
        events:   ((raw as Record<string, unknown>).events   as unknown[] | undefined) ?? [],
        contact_email_admin_only: (raw as Record<string, unknown>).contact_email_admin_only as string | undefined ?? null,
        contact_phone_admin_only: (raw as Record<string, unknown>).contact_phone_admin_only as string | undefined ?? null,
        raw_extra: ((raw as Record<string, unknown>).raw_extra as Record<string, unknown> | undefined) ?? {},
      });
    }

    await svc.from("event_store").insert([
      { event_name: "registry_source_file_uploaded", aggregate_id: sf!.id, aggregate_type: "registry_source_file", actor_id: user.id, payload: { source_name: input.source_name, source_type: input.source_type, record_count: records.length } },
      { event_name: "registry_source_file_parsed",   aggregate_id: sf!.id, aggregate_type: "registry_source_file", actor_id: user.id, payload: { record_count: records.length } },
    ]).catch(() => {});

    return withCors(req, new Response(JSON.stringify({
      ok: true,
      source_file_id: sf!.id,
      batch_id: batch!.id,
      record_count: records.length,
      readiness_default: "imported_unverified",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-source-file-upload error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
