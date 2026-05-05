/**
 * Match document upload permission — single source of truth.
 *
 * This is the canonical evaluator that BOTH the UI gate (the "not a
 * participant" panel in `MatchDocuments`) AND the server-side audit logger
 * (`supabase/functions/match-document-upload-log/index.ts`) must agree on,
 * and which mirrors the storage RLS INSERT policy
 * `Users can upload match documents to their org`:
 *
 *   bucket_id = 'match-documents'
 *   AND foldername[1] = caller profile.org_id
 *   AND EXISTS match m WHERE m.id::text = foldername[2]
 *                       AND ( m.org_id = caller.org_id
 *                          OR m.buyer_org_id = caller.org_id
 *                          OR m.seller_org_id = caller.org_id )
 *   OR caller has 'platform_admin'
 *
 * Any drift between UI gate / server log evaluator / RLS == James-class bug.
 * The integration test in `src/tests/match-upload-permission-matrix.test.ts`
 * pins all three to this helper.
 */

export interface MatchOrgSlots {
  org_id: string | null;       // initiator org
  buyer_org_id: string | null;
  seller_org_id: string | null;
}

export type ParticipantRole = "initiator" | "buyer" | "seller";

export interface UploadPermissionInput {
  callerOrgId: string | null;
  callerIsPlatformAdmin?: boolean;
  match: MatchOrgSlots;
}

export interface UploadPermissionResult {
  canUpload: boolean;
  isParticipant: boolean;
  roles: ParticipantRole[];
  reason:
    | "platform_admin_override"
    | "participant_org_match"
    | "org_not_on_match"
    | "caller_has_no_org";
}

export function evaluateUploadPermission(
  input: UploadPermissionInput,
): UploadPermissionResult {
  const { callerOrgId, callerIsPlatformAdmin, match } = input;

  const roles: ParticipantRole[] = [];
  if (callerOrgId) {
    if (match.org_id === callerOrgId) roles.push("initiator");
    if (match.buyer_org_id === callerOrgId) roles.push("buyer");
    if (match.seller_org_id === callerOrgId) roles.push("seller");
  }
  const isParticipant = roles.length > 0;

  if (callerIsPlatformAdmin && !isParticipant) {
    return { canUpload: true, isParticipant, roles, reason: "platform_admin_override" };
  }
  if (!callerOrgId) {
    return { canUpload: false, isParticipant: false, roles, reason: "caller_has_no_org" };
  }
  if (isParticipant) {
    return { canUpload: true, isParticipant, roles, reason: "participant_org_match" };
  }
  return { canUpload: false, isParticipant: false, roles, reason: "org_not_on_match" };
}

/**
 * Build the canonical storage object name. The first two path segments
 * (`org_id` / `matchId`) are the only segments storage RLS inspects via
 * `storage.foldername(name)[1]` and `[2]`.
 */
export function buildMatchDocumentStoragePath(args: {
  orgId: string;
  matchId: string;
  docId: string;
  safeFilename: string;
}): string {
  return `${args.orgId}/${args.matchId}/poi/${args.docId}/${args.safeFilename}`;
}

/** Mirror of postgres `storage.foldername(name)` for tests. */
export function storageFoldername(path: string): string[] {
  const parts = path.split("/");
  // storage.foldername returns the directory components, excluding the file.
  return parts.slice(0, -1);
}

/**
 * Re-evaluate the storage RLS INSERT predicate purely from inputs the policy
 * sees. This is what the database would decide.
 */
export function evaluateStorageRlsInsert(args: {
  bucketId: string;
  storagePath: string;
  callerOrgId: string | null;
  callerIsPlatformAdmin?: boolean;
  match: MatchOrgSlots & { id: string };
}): { allowed: boolean; reason: string } {
  if (args.bucketId !== "match-documents") {
    return { allowed: false, reason: "wrong_bucket" };
  }
  if (args.callerIsPlatformAdmin) {
    return { allowed: true, reason: "platform_admin_override" };
  }
  const folders = storageFoldername(args.storagePath);
  const pathOrgSegment = folders[0];
  const pathMatchSegment = folders[1];
  if (!args.callerOrgId) return { allowed: false, reason: "caller_has_no_org" };
  if (pathOrgSegment !== args.callerOrgId) {
    return { allowed: false, reason: "path_org_prefix_mismatch" };
  }
  if (pathMatchSegment !== args.match.id) {
    return { allowed: false, reason: "path_match_segment_mismatch" };
  }
  const callerOrg = args.callerOrgId;
  const onMatch =
    args.match.org_id === callerOrg ||
    args.match.buyer_org_id === callerOrg ||
    args.match.seller_org_id === callerOrg;
  return onMatch
    ? { allowed: true, reason: "participant_org_match" }
    : { allowed: false, reason: "org_not_on_match" };
}
