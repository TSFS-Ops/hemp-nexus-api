// Batch 16 — registry-my-companies
// Returns the list of companies the authenticated user has a relationship
// with (via claims, authority requests, or bank-detail submissions) along
// with safe portal status fields. NEVER returns raw bank fields, raw
// provider payloads, admin-only notes or other users' evidence.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

interface PortalCompany {
  company_id: string | null;
  company_reference: string;
  company_name: string;
  country_code: string;
  registration_number: string | null;
  lifecycle_label: string;
  claim_status: string;
  authority_status: string;
  bank_detail_status: string;
  verification_status: string;
  open_evidence_requests: number;
  open_corrections: number;
  open_disputes: number;
  last_updated_at: string | null;
}

function mapClaim(workflow: string | null): string {
  if (!workflow) return "not_started";
  if (workflow.includes("approved")) return "approved";
  if (workflow.includes("rejected")) return "rejected";
  if (workflow.includes("conflict")) return "conflicted";
  if (workflow.includes("evidence_requested") || workflow.includes("more_evidence")) {
    return "evidence_requested";
  }
  if (workflow.includes("review")) return "under_review";
  if (workflow.includes("started") || workflow.includes("in_progress")) return "in_progress";
  return "in_progress";
}

function mapAuthority(status: string | null, expiresAt: string | null, revoked: boolean): string {
  if (revoked) return "revoked";
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) return "expired";
  if (!status) return "not_requested";
  if (status.includes("approved") || status === "active") return "approved";
  if (status.includes("rejected")) return "rejected";
  if (status.includes("evidence")) return "evidence_requested";
  if (status.includes("review")) return "under_review";
  return "in_progress";
}

function mapBank(b13: string | null): string {
  if (!b13) return "not_submitted";
  switch (b13) {
    case "captured_unverified":
      return "captured_unverified";
    case "rejected":
      return "rejected";
    case "more_evidence_requested":
      return "evidence_requested";
    case "under_review":
    case "submitted":
      return "under_review";
    case "revoked":
      return "revoked";
    case "revocation_requested":
      return "revocation_requested";
    default:
      return "submitted";
  }
}

function mapVerification(status: string | null, expiresAt: string | null, disputed: boolean, revoked: boolean): string {
  if (revoked) return "revoked";
  if (disputed) return "disputed";
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) return "expired";
  if (!status) return "not_available";
  // ONLY final unexpired verified retains "verified". Any non-final or
  // expired Batch 14 status must downgrade here.
  if (status === "verified") return "verified";
  if (status === "manual_verified") return "manual_verified";
  if (status === "failed" || status === "provider_error") return "failed";
  if (status === "requested") return "requested";
  if (status === "in_progress" || status === "provider_matched" || status === "captured_unverified") {
    return "in_progress";
  }
  return "not_available";
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    }

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // 1. Companies via claims for this user
    const { data: claims } = await svc
      .from("registry_company_claims")
      .select("id, company_name, country_code, registration_number, company_reference, workflow_status, status, updated_at")
      .eq("claimant_user_id", user.id);

    const companies = new Map<string, PortalCompany>();
    for (const c of claims ?? []) {
      const key = `${c.company_reference}|${c.country_code}`;
      companies.set(key, {
        company_id: c.id,
        company_reference: c.company_reference,
        company_name: c.company_name,
        country_code: c.country_code,
        registration_number: c.registration_number,
        lifecycle_label: "Claimed",
        claim_status: mapClaim((c.workflow_status as string) ?? (c.status as string)),
        authority_status: "not_requested",
        bank_detail_status: "not_submitted",
        verification_status: "not_available",
        open_evidence_requests: 0,
        open_corrections: 0,
        open_disputes: 0,
        last_updated_at: (c.updated_at as string) ?? null,
      });
    }

    // 2. Layer authority for this user
    const { data: authorities } = await svc
      .from("registry_authority_requests")
      .select("id, company_reference, country_code, status, expires_at, revoked_at, updated_at")
      .eq("requested_by_user_id", user.id);
    for (const a of authorities ?? []) {
      const key = `${a.company_reference}|${a.country_code}`;
      const existing = companies.get(key);
      const authStatus = mapAuthority(a.status as string, a.expires_at as string | null, !!a.revoked_at);
      if (existing) {
        existing.authority_status = authStatus;
        if (a.updated_at && (!existing.last_updated_at || a.updated_at > existing.last_updated_at)) {
          existing.last_updated_at = a.updated_at as string;
        }
      }
    }

    // 3. Layer bank-detail submissions for this user
    const { data: banks } = await svc
      .from("registry_bank_detail_submissions")
      .select("id, company_reference, country_code, b13_status, updated_at, submitted_by_user_id")
      .eq("submitted_by_user_id", user.id);
    for (const b of banks ?? []) {
      const key = `${b.company_reference}|${b.country_code}`;
      const existing = companies.get(key);
      if (existing) {
        existing.bank_detail_status = mapBank(b.b13_status as string | null);
        if (b.updated_at && (!existing.last_updated_at || b.updated_at > existing.last_updated_at)) {
          existing.last_updated_at = b.updated_at as string;
        }

        // Verification layer
        const { data: ver } = await svc
          .from("registry_bank_detail_verification_decisions")
          .select("status, expires_at, disputed_at, revoked_at")
          .eq("submission_id", b.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (ver) {
          existing.verification_status = mapVerification(
            ver.status as string | null,
            ver.expires_at as string | null,
            !!ver.disputed_at,
            !!ver.revoked_at,
          );
        }

        // Open evidence requests on this submission
        const { count: evCount } = await svc
          .from("registry_bank_detail_evidence")
          .select("id", { count: "exact", head: true })
          .eq("submission_id", b.id);
        existing.open_evidence_requests += evCount ?? 0;
      }
    }

    // 4. Open corrections by user (per company)
    const { data: corrections } = await svc
      .from("registry_company_correction_requests")
      .select("company_reference, country_code, status")
      .eq("requested_by_user_id", user.id);
    for (const cr of corrections ?? []) {
      const key = `${cr.company_reference}|${cr.country_code}`;
      const existing = companies.get(key);
      if (existing && cr.status !== "resolved" && cr.status !== "rejected") {
        existing.open_corrections += 1;
      }
    }

    return withCors(
      req,
      new Response(JSON.stringify({ companies: Array.from(companies.values()) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  } catch (e) {
    return withCors(req, new Response(JSON.stringify({ error: "internal", message: (e as Error).message }), { status: 500 }));
  }
});
