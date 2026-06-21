// Batch 9 — Field mapping writer.
// Admin/compliance create or update per-batch field mappings with a visibility tier.
// Rejects any mapping that would place forbidden personal contact fields on a public tier.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  FIELD_VISIBILITY_TIERS,
  FORBIDDEN_PUBLIC_TARGET_FIELDS,
  TARGET_FIELDS,
  type FieldVisibilityTier,
  type TargetField,
} from "../_shared/registry-import-pipeline.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const MappingSchema = z.object({
  source_field: z.string().min(1).max(120),
  target_field: z.enum(TARGET_FIELDS as readonly [TargetField, ...TargetField[]]),
  visibility: z.enum(FIELD_VISIBILITY_TIERS as readonly [FieldVisibilityTier, ...FieldVisibilityTier[]]),
  notes: z.string().max(500).optional(),
});

const BodySchema = z.object({
  batch_id: z.string().uuid(),
  mappings: z.array(MappingSchema).min(1).max(60),
});

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

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!roleSet.has("platform_admin") && !roleSet.has("compliance_owner")) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    // Enforce SSOT rule: forbidden public mapping.
    for (const m of parsed.data.mappings) {
      if (FORBIDDEN_PUBLIC_TARGET_FIELDS.includes(m.target_field) &&
          (m.visibility === "public_searchable" || m.visibility === "public_visible" || m.visibility === "masked_public")) {
        return withCors(req, new Response(JSON.stringify({
          error: "forbidden_public_mapping",
          target_field: m.target_field,
          visibility: m.visibility,
        }), { status: 422, headers: { "Content-Type": "application/json" } }));
      }
    }

    // Upsert (delete + insert per source_field to keep semantics simple).
    const sourceFields = parsed.data.mappings.map(m => m.source_field);
    await svc.from("registry_import_field_mappings")
      .delete().eq("batch_id", parsed.data.batch_id).in("source_field", sourceFields);

    const rows = parsed.data.mappings.map(m => ({
      batch_id: parsed.data.batch_id,
      source_field: m.source_field,
      target_field: m.target_field,
      visibility: m.visibility,
      notes: m.notes ?? null,
      created_by: user.id,
    }));
    const { error: insErr } = await svc.from("registry_import_field_mappings").insert(rows);
    if (insErr) throw insErr;

    await svc.from("event_store").insert({
      event_name: "registry_import_field_mapping_created",
      aggregate_id: parsed.data.batch_id,
      aggregate_type: "registry_import_batch",
      actor_id: user.id,
      payload: { mapping_count: rows.length },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({ ok: true, mapping_count: rows.length }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-import-field-map error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
