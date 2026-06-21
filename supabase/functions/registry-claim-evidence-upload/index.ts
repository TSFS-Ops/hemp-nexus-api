// Batch 11 — registry-claim-evidence-upload
// Records evidence metadata (and optional file_path) against a claimant-owned claim.
// Auto-flags sensitive=true unless explicitly category=declaration.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  REGISTRY_EVIDENCE_CATEGORIES,
} from "../_shared/registry-claim-workflow.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const Body = z.object({
  claim_id: z.string().uuid(),
  category: z.enum(REGISTRY_EVIDENCE_CATEGORIES as unknown as [string, ...string[]]),
  document_name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  evidence_state: z.enum(["uploaded", "metadata_only"]).default("metadata_only"),
  file_path: z.string().max(500).optional(),
  external_reference: z.string().max(500).optional(),
  mime_type: z.string().max(120).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  issuing_authority: z.string().max(200).optional(),
  issue_date: z.string().optional(),
  expiry_date: z.string().optional(),
  claimant_statement: z.string().max(2000).optional(),
});

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    if (!user.email_confirmed_at) {
      return withCors(req, new Response(JSON.stringify({ error: "email_verification_required" }), { status: 403 }));
    }

    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten() }), { status: 400 }));
    }
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: claim, error: ce } = await svc
      .from("registry_company_claims")
      .select("id, claimant_user_id, workflow_status, status")
      .eq("id", parsed.data.claim_id)
      .maybeSingle();
    if (ce || !claim) return withCors(req, new Response(JSON.stringify({ error: "claim_not_found" }), { status: 404 }));
    if (claim.claimant_user_id !== user.id) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));
    }
    const blocked = ["approved", "rejected", "expired", "cancelled", "withdrawn"];
    if (blocked.includes(claim.workflow_status)) {
      return withCors(req, new Response(JSON.stringify({ error: "claim_locked", workflow_status: claim.workflow_status }), { status: 409 }));
    }

    const sensitive = parsed.data.category !== "declaration";
    const { data: ev, error: ie } = await svc
      .from("registry_company_claim_evidence")
      .insert({
        claim_id: parsed.data.claim_id,
        added_by_user_id: user.id,
        evidence_kind: parsed.data.category,
        category: parsed.data.category,
        evidence_state: parsed.data.evidence_state,
        sensitive,
        document_name: parsed.data.document_name,
        description: parsed.data.description,
        external_reference: parsed.data.external_reference ?? null,
        mime_type: parsed.data.mime_type ?? null,
        size_bytes: parsed.data.size_bytes ?? null,
        issuing_authority: parsed.data.issuing_authority ?? null,
        issue_date: parsed.data.issue_date ?? null,
        expiry_date: parsed.data.expiry_date ?? null,
        claimant_statement: parsed.data.claimant_statement ?? null,
        file_path: parsed.data.file_path ?? null,
      })
      .select("id")
      .single();
    if (ie) return withCors(req, new Response(JSON.stringify({ error: "db_error", message: ie.message }), { status: 500 }));

    const auditName = parsed.data.evidence_state === "uploaded"
      ? "registry_claim_evidence_uploaded"
      : "registry_claim_evidence_metadata_added";

    // If claim was in more_evidence_requested → flip to evidence_resubmitted
    if (claim.workflow_status === "more_evidence_requested") {
      await svc.from("registry_company_claims")
        .update({ workflow_status: "evidence_resubmitted", last_status_change_at: new Date().toISOString() })
        .eq("id", claim.id);
      await svc.from("registry_company_claim_events").insert({
        claim_id: claim.id, audit_event_name: "registry_claim_evidence_resubmitted",
        actor_user_id: user.id, previous_status: claim.workflow_status, new_status: "evidence_resubmitted",
      });
    }

    await svc.from("registry_company_claim_events").insert({
      claim_id: parsed.data.claim_id,
      audit_event_name: auditName,
      actor_user_id: user.id,
    });
    await svc.from("audit_logs").insert({
      action: auditName,
      actor_user_id: user.id,
      metadata: { claim_id: parsed.data.claim_id, evidence_id: ev.id, category: parsed.data.category, sensitive },
    });

    return withCors(req, new Response(JSON.stringify({ evidence_id: ev.id, sensitive }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (e) {
    return withCors(req, new Response(JSON.stringify({ error: "internal", message: (e as Error).message }), { status: 500 }));
  }
});
