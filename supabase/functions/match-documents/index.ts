import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";

/**
 * Match Documents List Endpoint
 *
 * Returns the list of documents the caller is allowed to see for a given match/POI.
 * Mirrors the same visibility model used by /document-download.
 *
 * GET /match-documents/:matchId
 * Query params:
 *   - order: 'asc' | 'desc' (default 'desc')
 */

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

    const url = new URL(req.url);
    const orderParam = (url.searchParams.get("order") || "desc").toLowerCase();
    const ascending = orderParam === "asc";

    const rawParts = url.pathname.split("/").filter(Boolean);
    const parts = [...rawParts];
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "match-documents") parts.shift();

    const matchId = parts[0];

    if (!matchId) {
      throw new ApiException("BAD_REQUEST", "Match ID is required", 400);
    }
    if (!uuidRegex.test(matchId)) {
      throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    const isAdmin = authCtx.roles.includes("platform_admin");

    // Fetch match (used for counterparty access checks)
    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select("id, org_id, buyer_org_id, seller_org_id")
      .eq("id", matchId)
      .single();

    if (matchError) {
      if (matchError.code === "PGRST116") {
        throw new ApiException("NOT_FOUND", "Match not found", 404);
      }
      handleDatabaseError(matchError, requestId);
    }

    if (!match) {
      throw new ApiException("NOT_FOUND", "Match not found", 404);
    }

    const userOrgId = authCtx.orgId;
    const buyerOrgId = match.buyer_org_id;
    const sellerOrgId = match.seller_org_id;
    const matchOrgId = match.org_id;

    const isPartyOrg = userOrgId === matchOrgId || userOrgId === buyerOrgId || userOrgId === sellerOrgId;
    if (!isAdmin && !isPartyOrg) {
      throw new ApiException("FORBIDDEN", "You do not have access to this intent", 403);
    }

    // Fetch documents for match - include version lineage fields
    // Supabase default limit is 1000; use explicit limit and detect truncation
    const DOC_LIMIT = 1000;
    const { data: docs, error: docsError } = await supabase
      .from("match_documents")
      .select(
        "id, match_id, org_id, uploader_org_id, uploader_user_id, doc_type, filename, storage_path, sha256_hash, file_size, mime_type, status, created_at, expiry_date, title, notes, visibility, valid_from, valid_to, version, supersedes_document_id, root_document_id, is_current_version, superseded_at, change_notes, verified_at, verified_by, verification_notes"
      )
      .eq("match_id", matchId)
      .order("created_at", { ascending })
      .limit(DOC_LIMIT);

    if (docsError) {
      handleDatabaseError(docsError, requestId);
    }

    const truncated = (docs || []).length >= DOC_LIMIT;

    // Fetch explicit grants once (used for role-based visibility)
    const grantedDocIds = new Set<string>();
    if (!isAdmin) {
      const { data: grants, error: grantsError } = await supabase
        .from("document_access")
        .select("document_id")
        .is("revoked_at", null)
        .or(`granted_to_org_id.eq.${userOrgId},granted_to_user_id.eq.${authCtx.userId}`);

      if (grantsError) {
        // Don’t fail listing if grants fetch fails; it only affects share_with_roles docs.
        console.error(`[${requestId}] Failed to fetch document grants`, grantsError);
      }

      for (const g of grants || []) {
        if (g?.document_id) grantedDocIds.add(g.document_id);
      }
    }

    const filtered = (docs || []).filter((doc) => {
      if (isAdmin) return true;

      const isRevokedOrArchived = doc.status === "revoked" || doc.status === "archived";
      const uploaderOrgId = doc.uploader_org_id || doc.org_id;

      const isUploader = uploaderOrgId === userOrgId;
      const isMatchOwnerOrg = doc.org_id === userOrgId; // match creator/owner org
      const isCounterpartyOrg = userOrgId === buyerOrgId || userOrgId === sellerOrgId;

      // Uploader org always sees their docs (even if revoked/archived)
      if (isUploader) return true;

      // Revoked/archived docs are hidden from everyone else
      if (isRevokedOrArchived) return false;

      // Match owner org can see active docs
      if (isMatchOwnerOrg) return true;

      // Counterparty visibility
      if (doc.visibility === "share_with_counterparty" && isCounterpartyOrg) return true;

      // Role-based visibility via explicit grant
      if (doc.visibility === "share_with_roles" && grantedDocIds.has(doc.id)) return true;

      return false;
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          match_id: matchId,
          documents: filtered,
          truncated,
          ...(truncated ? { warning: `Results limited to ${DOC_LIMIT} documents. Some records may not be shown.` } : {}),
        },
      }),
      {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
