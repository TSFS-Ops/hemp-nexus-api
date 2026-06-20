// Batch 6 — M017 Client-Safe Readiness summary. Returns bucketed module
// readiness using only the safe SSOT buckets. No raw bank details. No
// real registry data. Emits registry_client_readiness_viewed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { REGISTRY_CLIENT_READINESS_BUCKETS } from "../_shared/registry-outreach.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Static, client-safe module readiness map. Sourced from the readiness
// truth layer (Batch 1) and explicitly tagged for Batch-6 client-safe
// presentation. None of these may overclaim.
const MODULES: Array<{
  code: string;
  name: string;
  bucket: typeof REGISTRY_CLIENT_READINESS_BUCKETS[number];
  what_exists: string;
  what_is_missing: string;
}> = [
  { code: "M001", name: "Business Registry shell", bucket: "shell_ready", what_exists: "Landing surface and admin navigation only.", what_is_missing: "Real registry data ingestion." },
  { code: "M002", name: "Public Company Search", bucket: "shell_ready", what_exists: "Search UI and safe empty-state response.", what_is_missing: "Production data and approved coverage." },
  { code: "M003", name: "Company profile view", bucket: "shell_ready", what_exists: "Profile shell with label-only statuses.", what_is_missing: "Verified profile data and approved provenance." },
  { code: "M004", name: "Claim Your Company workflow", bucket: "client_demo_ready", what_exists: "Full workflow with audited approvals.", what_is_missing: "Production demo content under a recorded Business Decision." },
  { code: "M005", name: "Authority-to-Act workflow", bucket: "client_demo_ready", what_exists: "Workflow + admin review enforced.", what_is_missing: "External verifying-party integrations." },
  { code: "M006", name: "Consent-based bank-detail capture", bucket: "client_demo_ready", what_exists: "Consent capture with masked preview only.", what_is_missing: "Independent bank verification provider." },
  { code: "M007", name: "Verified Bank Detail status model", bucket: "provider_pending", what_exists: "State machine and audited transitions.", what_is_missing: "Verification provider; captured-unverified must NEVER show as verified." },
  { code: "M008", name: "Institutional verified-profile API facade", bucket: "shell_ready", what_exists: "Safe status envelopes only.", what_is_missing: "Verified profile production data + Business Decision sign-off." },
  { code: "M009", name: "Institutional payment-detail status API", bucket: "shell_ready", what_exists: "Status flag mapping only; never returns raw bank details.", what_is_missing: "Verification provider; only verified state returns verified flag." },
  { code: "M010", name: "Registry data provenance framework", bucket: "shell_ready", what_exists: "Provenance and licence ledger.", what_is_missing: "Licensed source feeds." },
  { code: "M011", name: "Country coverage framework", bucket: "shell_ready", what_exists: "Coverage matrix governed by Business Decisions.", what_is_missing: "Approved country activations." },
  { code: "M012", name: "Registry import-batch framework", bucket: "shell_ready", what_exists: "Import batch lifecycle governance.", what_is_missing: "Approved data feeds to ingest." },
  { code: "M013", name: "AI outreach drafter", bucket: "client_demo_ready", what_exists: "AI drafts only — drafts are clearly labelled and never auto-sent.", what_is_missing: "Approved external dispatch path (none in Batch 6)." },
  { code: "M014", name: "Human approval queue", bucket: "client_demo_ready", what_exists: "Review, edit, approve, reject, DNC, suppression.", what_is_missing: "External send integration (intentionally absent)." },
  { code: "M015", name: "Admin operations dashboard", bucket: "client_demo_ready", what_exists: "Cross-module counts and warnings.", what_is_missing: "Real workload — only operational once data exists." },
  { code: "M016", name: "API client / admin management", bucket: "client_demo_ready", what_exists: "Client + key lifecycle with audited mutations.", what_is_missing: "Production traffic + commercial agreements." },
  { code: "M017", name: "Client-safe readiness dashboard", bucket: "production_ready", what_exists: "This dashboard.", what_is_missing: "Nothing — this dashboard is the truth surface." },
  { code: "M018", name: "Business Decision register", bucket: "production_ready", what_exists: "Audited register of approved/rejected decisions.", what_is_missing: "Nothing." },
  { code: "M019", name: "Module readiness truth layer", bucket: "production_ready", what_exists: "Per-module state machine and audit.", what_is_missing: "Nothing." },
];

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user ?? null;

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    if (user) {
      await svc.from("event_store").insert({
        event_name: "registry_client_readiness_viewed",
        aggregate_id: null,
        aggregate_type: "registry_client_readiness",
        actor_id: user.id,
        payload: { module_count: MODULES.length },
      }).catch(() => {});
    }

    return withCors(req, new Response(JSON.stringify({
      generated_at: new Date().toISOString(),
      buckets: REGISTRY_CLIENT_READINESS_BUCKETS,
      modules: MODULES,
      notes: {
        no_real_registry_data: "This dashboard never exposes real registry records.",
        bank_detail_rule: "Bank details that are captured-unverified MUST NEVER be presented as verified.",
        provider_rule: "Modules marked provider_pending MUST NEVER be presented as live.",
        seed_rule: "Seed-only modules MUST NEVER be presented as production-ready.",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-client-readiness-summary error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error", message: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
