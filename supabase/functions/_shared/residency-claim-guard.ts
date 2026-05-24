/**
 * DATA-009 Phase 2 — residency-claim guard (Deno).
 *
 * Source of truth: signed Client Workflow Decision Form, DATA-009.
 *
 * The guard MUST run before any production artefact / export / WaD /
 * collapse / progression chokepoint and block if the org has an open
 * residency review hold. It NEVER implies any technical hosting,
 * storage, region migration, backup, export restriction or deletion
 * control. The hold is a POLICY review state only.
 *
 * Stable error codes:
 *   RESIDENCY_REVIEW_REQUIRED
 *   RESIDENCY_REVIEW_PENDING
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  DATA_RESIDENCY_REQUIREMENT_DETECTED,
  DATA_UNAPPROVED_RESIDENCY_CLAIM_BLOCKED,
} from "./data-009-audit.ts";

export type ResidencyBlockCode =
  | "RESIDENCY_REVIEW_REQUIRED"
  | "RESIDENCY_REVIEW_PENDING";

export interface ResidencyBlock {
  blocked: true;
  status: 409;
  code: ResidencyBlockCode;
  review_id: string | null;
  message: string;
}

const POLICY_MESSAGE =
  "Organisation has an open residency review hold. Production artefacts, exports and progression are paused until Izenzo records a decision. This is a policy review state only — no technical hosting, region migration, backup restriction, export restriction or deletion behaviour is implied.";

/**
 * Returns a ResidencyBlock if the org has an open onboarding hold tied
 * to a residency review. Otherwise returns null. Fails CLOSED on lookup
 * errors (returns a block) — the policy posture is conservative.
 */
export async function checkResidencyHold(
  admin: SupabaseClient,
  orgId: string | null | undefined,
): Promise<ResidencyBlock | null> {
  if (!orgId) return null;
  try {
    const { data, error } = await admin
      .from("organizations")
      .select("onboarding_hold_reason, onboarding_hold_review_id")
      .eq("id", orgId)
      .maybeSingle();
    if (error) {
      console.error("[residency-claim-guard] lookup failed:", error);
      return {
        blocked: true,
        status: 409,
        code: "RESIDENCY_REVIEW_PENDING",
        review_id: null,
        message: POLICY_MESSAGE,
      };
    }
    if (!data) return null;
    if (data.onboarding_hold_reason === "residency_review") {
      return {
        blocked: true,
        status: 409,
        code: "RESIDENCY_REVIEW_REQUIRED",
        review_id: data.onboarding_hold_review_id ?? null,
        message: POLICY_MESSAGE,
      };
    }
    return null;
  } catch (e) {
    console.error("[residency-claim-guard] exception:", e);
    return {
      blocked: true,
      status: 409,
      code: "RESIDENCY_REVIEW_PENDING",
      review_id: null,
      message: POLICY_MESSAGE,
    };
  }
}

/**
 * Convenience: detect a residency hold for any of the listed orgs
 * (e.g. buyer + seller). Returns the first block found.
 */
export async function checkResidencyHoldAny(
  admin: SupabaseClient,
  orgIds: Array<string | null | undefined>,
): Promise<ResidencyBlock | null> {
  for (const id of orgIds) {
    const block = await checkResidencyHold(admin, id);
    if (block) return block;
  }
  return null;
}

/**
 * Detect-and-record entry point. Records both
 * `data.residency_requirement_detected` and
 * `data.unapproved_residency_claim_blocked` when a downstream component
 * tries to apply an unsupported residency claim. Does NOT mutate any
 * region/storage/backup state.
 */
export async function recordUnapprovedResidencyClaim(
  admin: SupabaseClient,
  args: {
    org_id: string;
    actor_user_id?: string | null;
    requirement_source: string;
    requested_region?: string | null;
    requested_country?: string | null;
    legal_basis?: string | null;
  },
): Promise<void> {
  try {
    // Open / reuse review via SECDEF RPC.
    const { data: rpcData } = await admin.rpc("request_residency_review", {
      p_org_id: args.org_id,
      p_requirement_source: args.requirement_source,
      p_requested_region: args.requested_region ?? null,
      p_requested_country: args.requested_country ?? null,
      p_legal_basis: args.legal_basis ?? null,
      p_metadata: { actor_user_id: args.actor_user_id ?? null },
    });
    const reviewId = (rpcData as { review_id?: string } | null)?.review_id ?? null;

    await admin.from("audit_logs").insert({
      org_id: args.org_id,
      actor_user_id: args.actor_user_id ?? null,
      action: DATA_UNAPPROVED_RESIDENCY_CLAIM_BLOCKED,
      entity_type: "data_residency_review",
      entity_id: reviewId,
      metadata: {
        requirement_source: args.requirement_source,
        requested_region: args.requested_region ?? null,
        requested_country: args.requested_country ?? null,
        policy_note:
          "Non-default residency requires separate Izenzo approval. No region/storage/backup/export/deletion change has occurred.",
      },
    });
    // request_residency_review already emits requirement_detected.
    void DATA_RESIDENCY_REQUIREMENT_DETECTED;
  } catch (e) {
    console.error("[residency-claim-guard] recordUnapprovedResidencyClaim failed:", e);
  }
}

/** Build a stable JSON 409 response body from a ResidencyBlock. */
export function residencyBlockResponse(
  block: ResidencyBlock,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      error: "residency_review_required",
      code: block.code,
      review_id: block.review_id,
      message: block.message,
    }),
    {
      status: block.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
