import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "GET") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }

    // Accept BOTH path shapes so this endpoint can be reproduced from the
    // edge URL directly (debugging) or from a friendlier REST-shaped path:
    //   /functions/v1/match-evidence-counts/:matchId
    //   /functions/v1/match-evidence-counts/matches/:matchId/evidence
    const rawParts = new URL(req.url).pathname.split("/").filter(Boolean);
    const parts = [...rawParts];
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "match-evidence-counts") parts.shift();
    // REST alias: matches/:id/evidence
    if (parts[0] === "matches" && parts.length >= 2) {
      parts.shift(); // drop "matches"
      // keep parts[0] = :id ; tolerate optional trailing "evidence" segment
      if (parts[1] === "evidence") parts.splice(1, 1);
    }

    const matchId = parts[0];
    if (!matchId) throw new ApiException("BAD_REQUEST", "Match ID is required", 400);
    if (!uuidRegex.test(matchId)) throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, supabaseKey);
    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    const isAdmin = authCtx.roles.includes("platform_admin");

    const { data: match, error: matchError } = await admin
      .from("matches")
      .select("id, org_id, buyer_org_id, seller_org_id, match_type")
      .eq("id", matchId)
      .single();

    if (matchError) {
      if (matchError.code === "PGRST116") throw new ApiException("NOT_FOUND", "Match not found", 404);
      handleDatabaseError(matchError, requestId);
    }
    if (!match) throw new ApiException("NOT_FOUND", "Match not found", 404);

    const isPartyOrg =
      authCtx.orgId === match.org_id ||
      authCtx.orgId === match.buyer_org_id ||
      authCtx.orgId === match.seller_org_id;

    if (!isAdmin && !isPartyOrg) {
      throw new ApiException("FORBIDDEN", "You do not have access to this intent", 403);
    }

    // Per-side document counts (for the 1-doc-per-side POI gate). Counted by
    // uploader org_id matching the side's organisation.
    // Batch L DOC-003: expired (expiry_date < now) and deleted/archived/expired-
    // status rows are excluded — they cannot satisfy the floor. expiry_date IS NULL
    // is preserved (legacy/non-expiring evidence).
    const nowIso = new Date().toISOString();
    const activeDocFilter = (q: any) =>
      q.not("status", "in", "(deleted,archived,expired)")
        .or(`expiry_date.is.null,expiry_date.gt.${nowIso}`);
    const [matchDocsAll, buyerDocs, sellerDocs, govDocs, notes] = await Promise.all([
      activeDocFilter(admin.from("match_documents").select("id", { count: "exact", head: true }).eq("match_id", matchId)),
      match.buyer_org_id
        ? activeDocFilter(admin.from("match_documents").select("id", { count: "exact", head: true }).eq("match_id", matchId).eq("org_id", match.buyer_org_id))
        : Promise.resolve({ count: 0, error: null } as any),
      match.seller_org_id
        ? activeDocFilter(admin.from("match_documents").select("id", { count: "exact", head: true }).eq("match_id", matchId).eq("org_id", match.seller_org_id))
        : Promise.resolve({ count: 0, error: null } as any),
      admin.from("governance_documents").select("id", { count: "exact", head: true }).eq("deal_reference_id", matchId),
      admin.from("match_notes").select("id", { count: "exact", head: true }).eq("match_id", matchId),
    ]);

    if (matchDocsAll.error) handleDatabaseError(matchDocsAll.error, requestId);
    if (buyerDocs.error) handleDatabaseError(buyerDocs.error, requestId);
    if (sellerDocs.error) handleDatabaseError(sellerDocs.error, requestId);
    if (govDocs.error) handleDatabaseError(govDocs.error, requestId);
    if (notes.error) handleDatabaseError(notes.error, requestId);

    const matchDocumentsCount = matchDocsAll.count ?? 0;
    const buyerDocumentsCount = buyerDocs.count ?? 0;
    const sellerDocumentsCount = sellerDocs.count ?? 0;
    const governanceDocumentsCount = govDocs.count ?? 0;
    const notesCount = notes.count ?? 0;
    const documentCount = matchDocumentsCount + governanceDocumentsCount;
    const isUnilateral = match.match_type === "unilateral";

    // Per-side gate (1 doc per side, bilateral only). Unilateral always passes.
    const buyerSideOk = isUnilateral || !match.buyer_org_id || buyerDocumentsCount > 0;
    const sellerSideOk = isUnilateral || !match.seller_org_id || sellerDocumentsCount > 0;
    const minBundleSatisfied = buyerSideOk && sellerSideOk;

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          match_id: matchId,
          match_documents_count: matchDocumentsCount,
          buyer_documents_count: buyerDocumentsCount,
          seller_documents_count: sellerDocumentsCount,
          governance_documents_count: governanceDocumentsCount,
          document_count: documentCount,
          notes_count: notesCount,
          has_supporting_evidence: documentCount > 0 || notesCount > 0,
          is_unilateral: isUnilateral,
          min_bundle_satisfied: minBundleSatisfied,
          buyer_side_satisfied: buyerSideOk,
          seller_side_satisfied: sellerSideOk,
          // Retained for backwards compat. The waiver gate has been removed
          // (2026-04-30); waiver_required is now always false.
          waiver_required: false,
        },
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});