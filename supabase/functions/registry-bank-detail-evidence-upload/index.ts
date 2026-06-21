// Batch 13 — Attach evidence metadata to a bank-detail submission.
// Storage-of-bytes is out of scope; this records metadata + state. The owning
// submitter or platform_admin/compliance_owner may write.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_BANK_DETAIL_B13_EVIDENCE_CATEGORIES,
  REGISTRY_BANK_DETAIL_B13_EVIDENCE_STATES,
} from "../_shared/registry-bank-details-b13.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  submission_id: z.string().uuid(),
  evidence_kind: z.enum(REGISTRY_BANK_DETAIL_B13_EVIDENCE_CATEGORIES),
  description: z.string().min(1).max(500),
  external_reference: z.string().max(500).optional(),
  mime_type: z.string().max(120).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  state: z.enum(REGISTRY_BANK_DETAIL_B13_EVIDENCE_STATES).default("metadata_only"),
});

function json(req: Request, body: unknown, status = 200): Response {
  return withCors(req, new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json(req, { error: "unauthorized" }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json(req, { error: "invalid_body", details: parsed.error.flatten() }, 400);
    const input = parsed.data;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: sub } = await svc.from("registry_bank_detail_submissions")
      .select("id, submitter_user_id, b13_status").eq("id", input.submission_id).maybeSingle();
    if (!sub) return json(req, { error: "not_found" }, 404);

    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: { role: string }) => r.role));
    const isAdmin = roleSet.has("platform_admin") || roleSet.has("compliance_owner");
    if (sub.submitter_user_id !== user.id && !isAdmin) return json(req, { error: "forbidden" }, 403);

    const terminal = ["rejected", "revoked", "expired", "superseded", "withdrawn", "cancelled"];
    if (terminal.includes(sub.b13_status as string)) {
      return json(req, { error: "submission_terminal", current: sub.b13_status }, 409);
    }

    await svc.from("registry_bank_detail_evidence").insert({
      submission_id: input.submission_id,
      evidence_kind: input.evidence_kind,
      description: input.description,
      external_reference: input.external_reference ?? null,
      mime_type: input.mime_type ?? null,
      size_bytes: input.size_bytes ?? null,
      uploaded_by: user.id,
    });

    await svc.from("registry_bank_detail_submissions").update({ evidence_metadata_captured: true }).eq("id", input.submission_id);

    const eventName = input.state === "uploaded" ? "registry_bank_detail_evidence_uploaded" : "registry_bank_detail_evidence_metadata_added";
    await svc.from("registry_bank_detail_events").insert({
      submission_id: input.submission_id,
      audit_event_name: eventName,
      previous_status: null,
      new_status: null,
      actor_id: user.id,
      payload: { evidence_kind: input.evidence_kind, state: input.state },
    });
    await svc.from("event_store").insert({
      event_name: eventName,
      aggregate_id: input.submission_id,
      aggregate_type: "registry_bank_detail_submission",
      actor_id: user.id,
      payload: { evidence_kind: input.evidence_kind, state: input.state },
    }).catch(() => {});

    return json(req, { ok: true });
  } catch (err) {
    console.error("registry-bank-detail-evidence-upload error", err);
    return json(req, { error: "internal_error" }, 500);
  }
});
