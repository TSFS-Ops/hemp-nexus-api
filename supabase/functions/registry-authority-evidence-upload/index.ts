// Batch 12 — registry-authority-evidence-upload (metadata-only path)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import {
  REGISTRY_AUTHORITY_EVIDENCE_CATEGORIES,
  REGISTRY_AUTHORITY_EVIDENCE_STATES,
} from "../_shared/registry-authority-workflow.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData } = await supabase.auth.getUser(req.headers.get("Authorization")?.replace("Bearer ", "") ?? "");
    const user = userData?.user;
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });
    if (!user.email_confirmed_at) {
      return new Response(JSON.stringify({ error: "email_verification_required" }), { status: 403, headers: corsHeaders });
    }
    const body = await req.json();
    const { authority_request_id, evidence_category, scope_code, description, external_reference, mime_type, size_bytes, state } = body ?? {};
    if (!REGISTRY_AUTHORITY_EVIDENCE_CATEGORIES.includes(evidence_category)) {
      return new Response(JSON.stringify({ error: "invalid_category" }), { status: 400, headers: corsHeaders });
    }
    const evState = state && REGISTRY_AUTHORITY_EVIDENCE_STATES.includes(state) ? state : "metadata_only";

    const { data: ar } = await supabase.from("registry_authority_requests").select("requester_user_id,status").eq("id", authority_request_id).maybeSingle();
    if (!ar || ar.requester_user_id !== user.id) {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: corsHeaders });
    }
    if (["approved","rejected","revoked","expired","cancelled","withdrawn"].includes(ar.status)) {
      return new Response(JSON.stringify({ error: "request_finalised" }), { status: 409, headers: corsHeaders });
    }

    const { data: ins, error } = await supabase.from("registry_authority_evidence").insert({
      authority_request_id,
      evidence_kind: evidence_category,
      evidence_category,
      scope_code: scope_code ?? null,
      description: description ?? null,
      external_reference: external_reference ?? null,
      mime_type: mime_type ?? null,
      size_bytes: size_bytes ?? null,
      state: evState,
      uploaded_by: user.id,
    }).select().single();
    if (error) throw error;

    await supabase.from("registry_authority_events").insert({
      authority_request_id,
      audit_event_name: evState === "uploaded" ? "registry_authority_evidence_uploaded" : "registry_authority_evidence_metadata_added",
      actor_id: user.id,
      payload: { evidence_id: ins.id, evidence_category, scope_code, state: evState },
    });

    return new Response(JSON.stringify({ ok: true, evidence_id: ins.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500, headers: corsHeaders });
  }
});
