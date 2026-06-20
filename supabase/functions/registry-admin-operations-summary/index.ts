// Batch 6 — M015 Business Registry Admin Operations Dashboard summary.
// Read-only admin endpoint that returns counts and warning chips. Emits a
// single audit event: registry_admin_operations_viewed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

async function count(svc: ReturnType<typeof createClient>, table: string, filters?: Record<string, string>): Promise<number> {
  let q = svc.from(table).select("id", { count: "exact", head: true });
  if (filters) for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { count } = await q;
  return count ?? 0;
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return withCors(req, new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }));
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: roles } = await svc.from("user_roles").select("role").eq("user_id", user.id);
    const set = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!(set.has("platform_admin") || set.has("compliance_owner"))) {
      return withCors(req, new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }

    const [
      decisionsProposed, decisionsUnderReview,
      claimsQueue,
      authorityQueue,
      bankCaptured, bankPending,
      apiBlocked,
      draftsQueued, approvalsQueued,
      dncActive,
      readinessShellOnly,
    ] = await Promise.all([
      count(svc, "business_decisions", { status: "proposed" }),
      count(svc, "business_decisions", { status: "under_review" }),
      count(svc, "registry_company_claims", { status: "claim_submitted" }),
      count(svc, "registry_authority_requests", { status: "submitted" }).catch(() => 0),
      count(svc, "registry_bank_detail_submissions", { status: "captured_unverified" }).catch(() => 0),
      count(svc, "registry_bank_detail_submissions", { status: "verification_pending" }).catch(() => 0),
      count(svc, "registry_api_request_logs", { result_state: "not_usable" }).catch(() => 0),
      count(svc, "registry_outreach_drafts", { status: "needs_review" }),
      count(svc, "registry_outreach_approvals", { status: "queued" }),
      count(svc, "registry_outreach_do_not_contact", { active: "true" }).catch(async () => {
        const { count } = await svc.from("registry_outreach_do_not_contact").select("id", { count: "exact", head: true }).eq("active", true);
        return count ?? 0;
      }),
      count(svc, "registry_readiness_states", { state: "shell_ready" }).catch(() => 0),
    ]);

    const summary = {
      generated_at: new Date().toISOString(),
      sections: [
        { code: "product_readiness", label: "Product readiness", count: readinessShellOnly, warn: readinessShellOnly > 0, href: "/admin/registry/readiness" },
        { code: "business_decisions", label: "Business decisions awaiting review", count: decisionsProposed + decisionsUnderReview, warn: decisionsProposed + decisionsUnderReview > 0, href: "/admin/registry/decisions" },
        { code: "country_coverage", label: "Country coverage warnings", count: 0, warn: false, href: "/admin/registry/coverage" },
        { code: "provenance", label: "Provenance / source warnings", count: 0, warn: false, href: "/admin/registry/provenance" },
        { code: "import_batches", label: "Import batches", count: 0, warn: false, href: "/admin/registry/imports" },
        { code: "claims", label: "Claim queue", count: claimsQueue, warn: claimsQueue > 0, href: "/admin/registry/claims" },
        { code: "authority", label: "Authority queue", count: authorityQueue, warn: authorityQueue > 0, href: "/admin/registry/authority" },
        { code: "bank_details", label: "Bank-detail queue (captured/pending)", count: bankCaptured + bankPending, warn: bankCaptured + bankPending > 0, href: "/admin/registry/bank-details" },
        { code: "api_blocked", label: "Blocked institutional API requests", count: apiBlocked, warn: apiBlocked > 0, href: "/admin/registry/api" },
        { code: "outreach_drafts", label: "Outreach draft queue", count: draftsQueued, warn: draftsQueued > 0, href: "/admin/registry/outreach-drafts" },
        { code: "outreach_approvals", label: "Outreach approval queue", count: approvalsQueued, warn: approvalsQueued > 0, href: "/admin/registry/outreach-approvals" },
        { code: "do_not_contact", label: "Do-not-contact list", count: dncActive, warn: false, href: "/admin/registry/do-not-contact" },
        { code: "stale_records", label: "Stale records / review due", count: 0, warn: false, href: "/admin/registry" },
        { code: "provider_readiness", label: "Provider readiness", count: 0, warn: true, href: "/admin/registry/readiness", note: "No external providers integrated (Batch 6 placeholder)." },
        { code: "disputes", label: "Unresolved disputes", count: 0, warn: false, href: "/admin/registry" },
        { code: "audit_summary", label: "Audit events (last 24h)", count: 0, warn: false, href: "/admin/registry" },
      ],
      notes: {
        no_auto_send: "AI may draft outreach, but it must not send outreach automatically. A human reviewer must approve the wording, permitted-use basis and recipient before any send is logged or performed.",
        no_production_data: "Batch 6 does not ingest real registry data and does not integrate external providers.",
      },
    };

    await svc.from("event_store").insert({
      event_name: "registry_admin_operations_viewed",
      aggregate_id: null,
      aggregate_type: "registry_admin_operations",
      actor_id: user.id,
      payload: { section_count: summary.sections.length },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify(summary), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-admin-operations-summary error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
