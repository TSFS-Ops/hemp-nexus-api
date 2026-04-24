/**
 * Legitimacy Gate — David & Daniel's "easy entry, hard legitimacy" architecture.
 *
 * An organisation is LEGITIMATE for outreach + POI mint when it has an
 * `approved` row in `trade_approvals` whose validity window has not lapsed.
 *
 * Per current product policy (default tenant posture: `poi_mint`), the gate
 * fires at two enforcement points:
 *   • POI mint               (supabase/functions/match/index.ts → atomic_generate_poi_v2)
 *   • Counterparty outreach  (supabase/functions/poi-engagements/index.ts → send-outreach)
 *
 * The gate is INTENTIONALLY NOT applied to: registration, search, draft trade
 * creation, internal notes, or admin preview tooling — those are "Access" /
 * "Discovery" surfaces that David explicitly wants to keep frictionless.
 *
 * Future work (Step 2 of the plan): replace the hard-coded posture with a
 * per-org `org_governance_profiles.verification_gate_position` lookup so a
 * tenant can defer the gate to WaD only.
 */

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export type LegitimacyDecision =
  | { allowed: true; status: "approved"; approvalId: string; validUntil: string | null }
  | {
      allowed: false;
      reason:
        | "no_record"
        | "not_approved"
        | "revoked"
        | "expired"
        | "lookup_failed";
      status: string | null;
      validUntil: string | null;
      message: string;
    };

/**
 * Resolve the legitimacy state of an org. Pure read; never mutates.
 * Pass the SERVICE-ROLE client so RLS can't hide a row from this check.
 */
export async function checkOrgLegitimacy(
  admin: AdminClient,
  orgId: string | null | undefined,
): Promise<LegitimacyDecision> {
  if (!orgId) {
    return {
      allowed: false,
      reason: "no_record",
      status: null,
      validUntil: null,
      message:
        "Your organisation profile is not linked. Complete onboarding before issuing a Proof of Intent or contacting a counterparty.",
    };
  }

  const { data, error } = await admin
    .from("trade_approvals")
    .select("id, status, valid_until")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      allowed: false,
      reason: "lookup_failed",
      status: null,
      validUntil: null,
      message:
        "We could not verify your organisation's trading approval status. Please try again — if this persists, contact support.",
    };
  }

  if (!data) {
    return {
      allowed: false,
      reason: "no_record",
      status: null,
      validUntil: null,
      message:
        "Your organisation must complete verification before issuing a Proof of Intent or contacting a counterparty under Izenzo's name. Open Settings → Company Identity to start your KYB review.",
    };
  }

  const status = String(data.status || "").toLowerCase();
  const validUntil = (data as { valid_until: string | null }).valid_until ?? null;

  if (status === "revoked") {
    return {
      allowed: false,
      reason: "revoked",
      status,
      validUntil,
      message:
        "Your organisation's trading approval has been revoked. Counterparty-facing actions are paused until a compliance reviewer reinstates approval. Open Settings → Company Identity for next steps.",
    };
  }

  if (status !== "approved") {
    return {
      allowed: false,
      reason: "not_approved",
      status,
      validUntil,
      message:
        `Your organisation's trading approval is currently '${status || "incomplete"}'. Counterparty-facing actions are blocked until a compliance reviewer marks the profile 'approved'. Open Settings → Company Identity to track progress.`,
    };
  }

  if (validUntil) {
    const expiresAt = Date.parse(validUntil);
    if (!Number.isNaN(expiresAt) && expiresAt < Date.now()) {
      return {
        allowed: false,
        reason: "expired",
        status,
        validUntil,
        message:
          "Your organisation's trading approval has expired. Counterparty-facing actions are paused until the profile is renewed. Open Settings → Company Identity to renew.",
      };
    }
  }

  return {
    allowed: true,
    status: "approved",
    approvalId: data.id as string,
    validUntil,
  };
}

/**
 * Stable error code returned to callers when the gate blocks. Keeping a single
 * canonical code makes it trivial for the client to render the recovery CTA
 * (deep-link to Settings → Company Identity) without parsing the message.
 */
export const ORG_NOT_VERIFIED_CODE = "ORG_NOT_VERIFIED";
