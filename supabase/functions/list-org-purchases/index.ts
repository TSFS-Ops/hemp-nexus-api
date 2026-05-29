// DEC-007 — Read-only listing of the caller's org token purchases plus
// any refund requests (pending, blocked, approved, declined, superseded).
// Used by the Desk Billing page to render:
//   • the "Request refund" affordance per eligible purchase row
//   • the "Refund request pending" / blocked badges
//   • the resolved-refund history so approved/declined outcomes do not
//     silently disappear from the user's view after admin action
//     (Batch 1 fix #2 — refund history incompleteness).
//
// Pagination (Batch 1 fix #3 — purchase list hard limit):
//   Accepts optional { limit, offset } in the request body. Defaults to
//   limit=25/offset=0 to preserve previous behaviour, with a hard ceiling
//   of 200. Returns `total_count` and `has_more` so the UI can render
//   "load more" affordances and know when older rows exist. To prevent
//   silent loss of refund-relevant rows for orgs with > limit purchases,
//   any purchase referenced by a non-resolved refund (pending / blocked)
//   that falls outside the current page is fetched explicitly and merged
//   into the returned `purchases` array (flagged with `out_of_page=true`).
//
// Read-only. Triggers no provider action. RLS-safe (service-role used
// only after resolving caller -> org_id via profile).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/cors.ts";

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

Deno.serve(async (req) => {
  const corsHeaders = __buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin"));
  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u, error: uerr } = await userClient.auth.getUser();
  if (uerr || !u?.user) return json({ error: "unauthorized" }, 401);

  // Parse pagination params (best-effort; ignore parse errors and fall
  // back to defaults so a missing/empty body keeps prior behaviour).
  let limit = DEFAULT_LIMIT;
  let offset = 0;
  if (req.method === "POST") {
    try {
      const txt = await req.text();
      if (txt.trim()) {
        const body = JSON.parse(txt) as { limit?: unknown; offset?: unknown };
        if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
          limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(body.limit)));
        }
        if (typeof body.offset === "number" && Number.isFinite(body.offset)) {
          offset = Math.max(0, Math.floor(body.offset));
        }
      }
    } catch {
      // ignore — use defaults
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile } = await admin
    .from("profiles")
    .select("org_id")
    .eq("id", u.user.id)
    .maybeSingle();
  const orgId = profile?.org_id;
  if (!orgId) return json({ error: "no_org", code: "NO_ORG" }, 400);

  // Page of purchases + total count for pagination metadata.
  const { data: pageRows, count, error: pErr } = await admin
    .from("token_purchases")
    .select(
      "id, package_id, token_amount, amount_usd, status, created_at, paystack_reference",
      { count: "exact" },
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (pErr) {
    console.error("[list-org-purchases] purchases", pErr);
    return json({ error: "query_failed" }, 500);
  }
  const purchases = (pageRows ?? []).map((p) => ({ ...p, out_of_page: false }));

  // All refund_requests for this org. We need:
  //   • pending / blocked → drive UI affordances (existing behaviour)
  //   • approved / declined / superseded → drive resolved-history view
  //     (Batch 1 fix #2 — refund history incompleteness)
  const { data: refundRows, error: rErr } = await admin
    .from("refund_requests")
    .select(
      "id, token_purchase_id, status, reason_code, reason_detail, reviewed_at, reviewed_by, decision_reason, created_at",
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (rErr) {
    console.error("[list-org-purchases] refunds", rErr);
    return json({ error: "query_failed" }, 500);
  }

  const allRefunds = refundRows ?? [];

  // Existing back-compat shapes.
  const pendingRefunds = allRefunds
    .filter((r) => r.status === "pending")
    .map((r) => ({ token_purchase_id: r.token_purchase_id, status: r.status }));

  // Latest blocked outcome per purchase.
  const blockedByPurchase: Record<string, { status: string; created_at: string }> = {};
  for (const row of allRefunds) {
    if (row.status !== "blocked_credits_used" && row.status !== "blocked_expired") continue;
    if (!blockedByPurchase[row.token_purchase_id]) {
      blockedByPurchase[row.token_purchase_id] = {
        status: row.status,
        created_at: row.created_at,
      };
    }
  }
  const blockedRefunds = Object.entries(blockedByPurchase).map(([id, v]) => ({
    token_purchase_id: id,
    status: v.status,
    created_at: v.created_at,
  }));

  // Resolved refund history (approved / declined / superseded) — newest
  // first. Surfaced separately so the UI can show post-decision outcomes
  // without conflicting with the pending/blocked affordances.
  const resolvedRefunds = allRefunds.filter(
    (r) => r.status === "approved" || r.status === "declined" || r.status === "superseded",
  );

  // Prevent silent loss of refund-relevant rows when an org has more
  // purchases than the current page. Any purchase referenced by a
  // non-resolved (pending/blocked) refund that is NOT already in the
  // page result gets pulled in explicitly and marked out_of_page.
  const pageIds = new Set(purchases.map((p) => p.id));
  const relevantUnpaged = Array.from(
    new Set(
      allRefunds
        .filter(
          (r) =>
            r.status === "pending" ||
            r.status === "blocked_credits_used" ||
            r.status === "blocked_expired",
        )
        .map((r) => r.token_purchase_id)
        .filter((id) => !pageIds.has(id)),
    ),
  );
  if (relevantUnpaged.length > 0) {
    const { data: extraRows, error: extraErr } = await admin
      .from("token_purchases")
      .select(
        "id, package_id, token_amount, amount_usd, status, created_at, paystack_reference",
      )
      .eq("org_id", orgId)
      .in("id", relevantUnpaged);
    if (extraErr) {
      console.error("[list-org-purchases] extra-purchases", extraErr);
      // Non-fatal: continue with what we have rather than fail the page.
    } else {
      for (const row of extraRows ?? []) {
        purchases.push({ ...row, out_of_page: true });
      }
    }
  }

  const totalCount = typeof count === "number" ? count : purchases.length;
  const hasMore = offset + (pageRows?.length ?? 0) < totalCount;

  return json({
    success: true,
    purchases,
    pending_refunds: pendingRefunds,
    blocked_refunds: blockedRefunds,
    resolved_refunds: resolvedRefunds,
    pagination: {
      limit,
      offset,
      total_count: totalCount,
      has_more: hasMore,
    },
  });
});
