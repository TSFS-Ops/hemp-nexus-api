/**
 * P-5 Batch 3 — Stage 2 access grant logic (pure TS).
 */
import type { P5B3AccessGrantStatus } from "./constants";

export interface P5B3AccessGrant {
  status: P5B3AccessGrantStatus | "pending";
  funder_organisation_id: string;
  funder_user_id: string;
  transaction_id: string;
  evidence_pack_version: number | null;
  expires_at: string | null; // ISO
  revoked_at?: string | null;
}

export type P5B3GrantDenialReason =
  | "no_grant"
  | "expired"
  | "revoked"
  | "pending"
  | "wrong_user"
  | "wrong_organisation"
  | "wrong_transaction"
  | "wrong_pack_version";

export interface P5B3GrantCheckInput {
  grant: P5B3AccessGrant | null;
  user_id: string;
  organisation_id: string;
  transaction_id: string;
  evidence_pack_version?: number | null;
  now?: Date;
}

export interface P5B3GrantCheckResult {
  allowed: boolean;
  reason?: P5B3GrantDenialReason;
}

export function checkAccessGrant(input: P5B3GrantCheckInput): P5B3GrantCheckResult {
  const now = input.now ?? new Date();
  const g = input.grant;
  if (!g) return { allowed: false, reason: "no_grant" };
  if (g.status === "pending") return { allowed: false, reason: "pending" };
  if (g.status === "revoked") return { allowed: false, reason: "revoked" };
  if (g.status === "expired") return { allowed: false, reason: "expired" };
  if (g.expires_at && new Date(g.expires_at).getTime() <= now.getTime()) {
    return { allowed: false, reason: "expired" };
  }
  if (g.funder_organisation_id !== input.organisation_id) {
    return { allowed: false, reason: "wrong_organisation" };
  }
  if (g.funder_user_id !== input.user_id) {
    return { allowed: false, reason: "wrong_user" };
  }
  if (g.transaction_id !== input.transaction_id) {
    return { allowed: false, reason: "wrong_transaction" };
  }
  if (
    input.evidence_pack_version != null &&
    g.evidence_pack_version != null &&
    g.evidence_pack_version !== input.evidence_pack_version
  ) {
    return { allowed: false, reason: "wrong_pack_version" };
  }
  return { allowed: true };
}

/** Cross-funder isolation: never reveal another funder's grant. */
export function isCrossFunderLeak(
  viewer_org: string,
  target_grant: Pick<P5B3AccessGrant, "funder_organisation_id">,
): boolean {
  return viewer_org !== target_grant.funder_organisation_id;
}
