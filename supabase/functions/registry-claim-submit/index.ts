// Batch 11 — registry-claim-submit
// Validates evidence requirements then moves claim to claim_submitted.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  evaluateClaimEvidenceRequirements,
  REGISTRY_CLAIM_EXPIRY_DAYS,
} from "../_shared/registry-claim-workflow.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const Body = z.object({
  claim_id: z.string().uuid(),
  declaration_accepted: z.literal(true),
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
    if (!parsed.success) return withCors(req, new Response(JSON.stringify({ error: "invalid_body" }), { status: 400 }));

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: claim } = await svc.from("registry_company_claims")
      .select("id, claimant_user_id, workflow_status, claimant_type, company_legal_form, is_professional_representative, country_code, company_email_domain")
      .eq("id", parsed.data.claim_id).maybeSingle();
    if (!claim) return withCors(req, new Response(JSON.stringify({ error: "claim_not_found" }), { status: 404 }));
    if (claim.claimant_user_id !== user.id) return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));

    const { data: evs } = await svc.from("registry_company_claim_evidence")
      .select("category").eq("claim_id", claim.id);
    const uploaded = (evs ?? []).map((e: any) => e.category).filter(Boolean);

    const req2 = evaluateClaimEvidenceRequirements({
      company_legal_form: (claim.company_legal_form ?? "other") as any,
      country_code: claim.country_code,
      claimant_type: (claim.claimant_type ?? "other_representative_with_mandate") as any,
      claimant_in_registry_people: false,
      uses_company_domain_email: !!claim.company_email_domain,
      is_professional_representative: !!claim.is_professional_representative,
      has_mandate_evidence: uploaded.includes("mandate_letter"),
      current_status: claim.workflow_status as any,
      uploaded_categories: uploaded as any,
    });

    if (!req2.can_submit) {
      return withCors(req, new Response(JSON.stringify({
        error: "evidence_incomplete",
        missing: req2.missing,
        blocking_reasons: req2.blocking_reasons,
      }), { status: 422, headers: { "Content-Type": "application/json" } }));
    }

    // Conflict detection: another active claim for the same company_reference
    const { data: conflicts } = await svc.from("registry_company_claims")
      .select("id").eq("company_reference", (await svc.from("registry_company_claims").select("company_reference").eq("id", claim.id).single()).data?.company_reference)
      .neq("id", claim.id)
      .in("workflow_status", ["claim_submitted", "under_review", "more_evidence_requested", "evidence_resubmitted", "approved"]);
    const conflictDetected = (conflicts?.length ?? 0) > 0;

    const newStatus = conflictDetected ? "claim_conflict_detected" : "claim_submitted";
    const sla = new Date(Date.now() + REGISTRY_CLAIM_EXPIRY_DAYS.submitted_under_review * 24 * 60 * 60 * 1000).toISOString();

    await svc.from("registry_company_claims")
      .update({ workflow_status: newStatus, status: "claim_submitted", last_status_change_at: new Date().toISOString(), sla_due_at: sla })
      .eq("id", claim.id);

    await svc.from("registry_company_claim_events").insert({
      claim_id: claim.id, audit_event_name: "registry_claim_submitted",
      actor_user_id: user.id, previous_status: claim.workflow_status, new_status: newStatus,
    });
    if (conflictDetected) {
      await svc.from("registry_company_claim_events").insert({
        claim_id: claim.id, audit_event_name: "registry_claim_conflict_detected", actor_user_id: user.id,
      });
    }
    await svc.from("audit_logs").insert({
      action: "registry_claim_submitted",
      actor_user_id: user.id,
      metadata: { claim_id: claim.id, conflict_detected: conflictDetected },
    });

    // log-only notification
    await svc.from("registry_company_claim_status_notifications").insert({
      claim_id: claim.id, recipient_user_id: user.id, channel: "in_app",
      audit_event_name: "registry_claim_submitted",
      subject: "Claim submitted",
      body: "Your claim has been submitted for review.",
      delivery_state: "logged_only",
    });
    await svc.from("audit_logs").insert({
      action: "registry_claim_notification_logged",
      actor_user_id: user.id,
      metadata: { claim_id: claim.id, kind: "claim_submitted" },
    });

    return withCors(req, new Response(JSON.stringify({ status: newStatus, conflict_detected: conflictDetected }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (e) {
    return withCors(req, new Response(JSON.stringify({ error: "internal", message: (e as Error).message }), { status: 500 }));
  }
});
