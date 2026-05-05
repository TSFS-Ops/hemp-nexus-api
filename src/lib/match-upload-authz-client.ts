import { fetchEdgeFunction } from "@/lib/edge-invoke";

/**
 * Read-only probe for "is my org allowed to upload to this match?".
 * Mirrors the storage RLS policy server-side and returns the exact org IDs
 * used in the decision.
 */
export interface UploadAuthzResult {
  request_id: string;
  match_id: string;
  match_found: boolean;
  match_lookup_error: string | null;
  caller: {
    user_id: string | null;
    api_key_id: string | null;
    org_id: string | null;
    rbac_roles: string[];
    is_platform_admin: boolean;
  };
  match: {
    org_id: string | null;
    buyer_org_id: string | null;
    seller_org_id: string | null;
    status: string | null;
  };
  decision: {
    participant_roles: Array<"initiator" | "buyer" | "seller">;
    is_participant: boolean;
    can_upload: boolean;
    reason:
      | "match_not_found"
      | "caller_has_no_org"
      | "participant_org_match"
      | "platform_admin_override"
      | "org_not_on_match";
  };
  storage: {
    bucket: string;
    path_prefix: string | null;
  };
}

export async function probeMatchUploadAuthz(
  matchId: string
): Promise<UploadAuthzResult> {
  return await fetchEdgeFunction<UploadAuthzResult>(
    `match-upload-authz/${matchId}`,
    { method: "GET", label: "probe upload authorisation" }
  );
}
