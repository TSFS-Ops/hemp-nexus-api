// Batch 2 — M010 Registry Provenance writer.
// Records data sources, source licences, and field-level provenance entries.
// Platform admin / compliance owner only. Emits canonical audit names.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_SOURCE_TYPES,
  REGISTRY_LICENCE_STATUSES,
  REGISTRY_CONFIDENCE_BANDS,
  REGISTRY_VERIFICATION_LEVELS,
  type RegistrySourceType,
  type RegistryLicenceStatus,
  type RegistryConfidenceBand,
  type RegistryVerificationLevel,
} from "../_shared/registry-provenance.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const SourceSchema = z.object({
  action: z.literal("record_source"),
  source_id: z.string().uuid().optional(),
  source_name: z.string().min(3).max(160),
  source_type: z.enum(REGISTRY_SOURCE_TYPES as readonly [RegistrySourceType, ...RegistrySourceType[]]),
  countries: z.array(z.string().min(2).max(8)).default([]),
  licence_status: z.enum(REGISTRY_LICENCE_STATUSES as readonly [RegistryLicenceStatus, ...RegistryLicenceStatus[]]).default("unlicensed"),
  commercial_use_allowed: z.boolean().default(false),
  public_display_allowed: z.boolean().default(false),
  api_output_allowed: z.boolean().default(false),
  outreach_allowed: z.boolean().default(false),
  institutional_demo_allowed: z.boolean().default(false),
  resale_restrictions: z.string().max(2000).optional(),
  source_reference_url: z.string().url().optional(),
  stale_at: z.string().datetime().optional(),
  owner_role: z.string().max(60).optional(),
  evidence_url: z.string().url().optional(),
  internal_notes: z.string().max(2000).optional(),
  reason: z.string().min(20).max(500),
});

const LicenceSchema = z.object({
  action: z.literal("record_licence"),
  source_id: z.string().uuid(),
  licence_reference: z.string().min(2).max(200),
  permitted_uses: z.array(z.string().min(2).max(60)).min(1),
  effective_from: z.string().datetime().optional(),
  effective_to: z.string().datetime().optional(),
  evidence_url: z.string().url().optional(),
  reason: z.string().min(20).max(500),
});

const FieldSchema = z.object({
  action: z.literal("record_field"),
  source_id: z.string().uuid(),
  subject_type: z.string().min(2).max(60),
  subject_id: z.string().min(1).max(120),
  field_name: z.string().min(1).max(80),
  raw_value: z.string().max(4000).optional(),
  confidence_band: z.enum(REGISTRY_CONFIDENCE_BANDS as readonly [RegistryConfidenceBand, ...RegistryConfidenceBand[]]).default("unverified"),
  verification_level: z.enum(REGISTRY_VERIFICATION_LEVELS as readonly [RegistryVerificationLevel, ...RegistryVerificationLevel[]]).default("none"),
  evidence_url: z.string().url().optional(),
  reason: z.string().min(20).max(500),
});

const BodySchema = z.discriminatedUnion("action", [SourceSchema, LicenceSchema, FieldSchema]);

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }));
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    const input = parsed.data;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    const isAuthorised = roleSet.has("platform_admin") || roleSet.has("compliance_owner");
    if (!isAuthorised) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    let auditEvent = "registry_source_recorded";
    let sourceId: string | null = null;
    let provenanceId: string | null = null;

    if (input.action === "record_source") {
      if (input.source_id) {
        const { error } = await svc.from("registry_data_sources").update({
          source_name: input.source_name,
          source_type: input.source_type,
          countries: input.countries,
          licence_status: input.licence_status,
          commercial_use_allowed: input.commercial_use_allowed,
          public_display_allowed: input.public_display_allowed,
          api_output_allowed: input.api_output_allowed,
          outreach_allowed: input.outreach_allowed,
          institutional_demo_allowed: input.institutional_demo_allowed,
          resale_restrictions: input.resale_restrictions ?? null,
          source_reference_url: input.source_reference_url ?? null,
          stale_at: input.stale_at ?? null,
          owner_role: input.owner_role ?? null,
          evidence_url: input.evidence_url ?? null,
          internal_notes: input.internal_notes ?? null,
        }).eq("id", input.source_id);
        if (error) throw error;
        sourceId = input.source_id;
        auditEvent = "registry_source_updated";
      } else {
        const { data, error } = await svc.from("registry_data_sources").insert({
          source_name: input.source_name,
          source_type: input.source_type,
          countries: input.countries,
          licence_status: input.licence_status,
          commercial_use_allowed: input.commercial_use_allowed,
          public_display_allowed: input.public_display_allowed,
          api_output_allowed: input.api_output_allowed,
          outreach_allowed: input.outreach_allowed,
          institutional_demo_allowed: input.institutional_demo_allowed,
          resale_restrictions: input.resale_restrictions ?? null,
          source_reference_url: input.source_reference_url ?? null,
          stale_at: input.stale_at ?? null,
          owner_role: input.owner_role ?? null,
          evidence_url: input.evidence_url ?? null,
          internal_notes: input.internal_notes ?? null,
          created_by: user.id,
        }).select("id").single();
        if (error) throw error;
        sourceId = data!.id;
        auditEvent = "registry_source_recorded";
      }
    } else if (input.action === "record_licence") {
      const { error } = await svc.from("registry_source_licences").insert({
        source_id: input.source_id,
        licence_reference: input.licence_reference,
        permitted_uses: input.permitted_uses,
        effective_from: input.effective_from ?? null,
        effective_to: input.effective_to ?? null,
        evidence_url: input.evidence_url ?? null,
        recorded_by: user.id,
      });
      if (error) throw error;
      sourceId = input.source_id;
      auditEvent = "registry_source_licence_recorded";
    } else {
      const { data, error } = await svc.from("registry_field_provenance").insert({
        source_id: input.source_id,
        subject_type: input.subject_type,
        subject_id: input.subject_id,
        field_name: input.field_name,
        raw_value: input.raw_value ?? null,
        confidence_band: input.confidence_band,
        verification_level: input.verification_level,
        evidence_url: input.evidence_url ?? null,
        created_by: user.id,
      }).select("id").single();
      if (error) throw error;
      sourceId = input.source_id;
      provenanceId = data!.id;
      auditEvent = "registry_field_provenance_recorded";
    }

    await svc.from("registry_provenance_events").insert({
      source_id: sourceId,
      provenance_id: provenanceId,
      audit_event_name: auditEvent,
      payload: { reason: input.reason, action: input.action },
      actor_id: user.id,
    });

    await svc.from("event_store").insert({
      event_name: auditEvent,
      aggregate_id: sourceId,
      aggregate_type: "registry_data_source",
      actor_id: user.id,
      payload: { reason: input.reason, action: input.action },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({ ok: true, source_id: sourceId, provenance_id: provenanceId, audit_event: auditEvent }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-provenance-record error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
