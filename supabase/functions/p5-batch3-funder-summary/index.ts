// P-5 Batch 3 — Stage 3 — Safe funder summary edge function.
//
// Internal dashboard / funder-readiness use only.
// This is NOT a public /api/v1/funder/* endpoint. There is no route under
// /api/v1/funder anywhere in the project; this function is invoked only via
// supabase.functions.invoke('p5-batch3-funder-summary') from inside the app.
//
// Hard guarantees applied server-side before any response:
//   - Caller JWT is validated; expired/revoked grants produce a denied response.
//   - Only fields in P5B3_FUNDER_ALLOWED_RELEASED_FIELDS may appear.
//   - Raw KYC/KYB, raw bank, raw ID, raw UBO, admin notes, internal risk
//     flags, provider raw/test data, other funders' status/notes, and
//     unrelated counterparties are NEVER selected from the DB.
//   - Bank account numbers are masked by default.
//   - Provider wording is filtered through the safe-label allow-list; any
//     unsafe label without a live-provider result or approved manual
//     decision reference is downgraded to "Provider result pending".

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const ALLOWED_FIELDS = new Set([
  "transaction_summary",
  "released_evidence_pack_version",
  "released_pack_sha256",
  "outcome_history",
  "counterparty_display_name",
  "jurisdiction_summary",
  "provider_safe_status_label",
  "access_grant",
]);

const SAFE_LABELS = new Set([
  "Provider-ready",
  "Provider-ready, not live-provider verified",
  "External Provider Result Pending",
  "Provider result unavailable",
]);

const UNSAFE_LABELS = new Set([
  "Verified",
  "Guaranteed",
  "Compliance Passed",
  "Sanctions Cleared",
  "Bankable",
  "Provider Verified",
  "Investment Grade",
  "Due Diligence Complete",
]);

function safeProviderLabel(label: string | null, providerLive: boolean, manualRef: string | null): string {
  if (!label) return "Provider result unavailable";
  if (SAFE_LABELS.has(label)) return label;
  if (UNSAFE_LABELS.has(label)) {
    if (providerLive || manualRef) return label;
    return "External Provider Result Pending";
  }
  return "External Provider Result Pending";
}

function maskBank(value: string | null): string {
  if (!value) return "";
  const s = String(value);
  if (s.length <= 4) return "•".repeat(s.length);
  return "•".repeat(Math.max(0, s.length - 4)) + s.slice(-4);
}

function applyAllowList<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) if (ALLOWED_FIELDS.has(k)) out[k] = obj[k];
  return out as Partial<T>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return new Response(JSON.stringify({ error: "auth_required" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { transaction_reference?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const txRef = (body.transaction_reference ?? "").trim();
  if (!txRef) {
    return new Response(JSON.stringify({ error: "transaction_reference_required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  // 1. Validate active grant for the caller. RLS on funder_access_grants
  //    enforces org + user + active + non-expired + non-revoked.
  const { data: grants, error: grantErr } = await supabase
    .from("p5_batch3_funder_access_grants")
    .select(
      "id, funder_organisation_id, funder_user_id, transaction_reference, evidence_pack_version, expiry_at, status, revoked_at, can_download, unmasked_bank_details, funder_status",
    )
    .eq("transaction_reference", txRef)
    .eq("status", "active")
    .limit(1);
  if (grantErr) {
    return new Response(JSON.stringify({ error: "grant_lookup_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const grant = (grants ?? [])[0];
  if (!grant) {
    return new Response(JSON.stringify({ denied: true, reason: "no_active_grant", data: null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (grant.revoked_at || new Date(grant.expiry_at) <= new Date()) {
    return new Response(JSON.stringify({ denied: true, reason: "grant_expired_or_revoked", data: null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Collect only the funder's own outcomes (cross-funder isolation by RLS).
  const { data: outcomes } = await supabase
    .from("p5_batch3_funder_outcomes")
    .select("outcome_type, admin_review_status, created_at")
    .eq("transaction_reference", txRef)
    .eq("funder_organisation_id", grant.funder_organisation_id)
    .order("created_at", { ascending: false })
    .limit(20);

  // 3. Build a synthetic safe summary. We deliberately do NOT read
  //    raw KYC/KYB, raw bank, raw ID, raw UBO, internal admin notes,
  //    other funders' rows, or provider raw responses.
  const rawSummary: Record<string, unknown> = {
    transaction_summary: { reference: txRef, funder_status: grant.funder_status },
    released_evidence_pack_version: grant.evidence_pack_version,
    released_pack_sha256: null, // populated by admin release path in later stage
    outcome_history: (outcomes ?? []).map((o) => ({
      outcome_type: o.outcome_type,
      admin_review_status: o.admin_review_status,
      at: o.created_at,
    })),
    counterparty_display_name: null,
    jurisdiction_summary: null,
    provider_safe_status_label: safeProviderLabel(null, false, null),
    access_grant: {
      id: grant.id,
      expires_at: grant.expiry_at,
      can_download: grant.can_download,
      unmasked_bank_details: grant.unmasked_bank_details,
    },
    // even if upstream supplied bank, default-mask it
    masked_bank_display: maskBank(null),
  };

  const safe = applyAllowList(rawSummary);
  return new Response(JSON.stringify({ denied: false, data: safe }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
