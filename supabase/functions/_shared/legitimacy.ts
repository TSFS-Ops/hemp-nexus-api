/**
 * Legitimacy Gate — David & Daniel's "easy entry, hard legitimacy" architecture.
 *
 * An organisation is LEGITIMATE for outreach + POI mint when it has an
 * `approved` row in `trade_approvals` whose validity window has not lapsed.
 *
 * GATE POSITION (Step 2 — per-tenant configurability):
 *   • `entry`     → verification required from registration. By the time we
 *                   reach POI mint / outreach, an entry-tenant is already
 *                   verified, so behaviour at THESE callsites matches `poi_mint`.
 *   • `poi_mint`  → verification required before issuing a POI or sending
 *                   outreach under Izenzo's name. (Default for every org.)
 *   • `wad_only`  → defer verification entirely to WaD 9-gate execution.
 *                   Mint and outreach are allowed without trade approval.
 *
 * The active position is read from `public.get_org_gate_position(org_id)`
 * (returns `poi_mint` if no profile row exists, preserving Step 1 behaviour).
 *
 * The gate is INTENTIONALLY NOT applied to: registration, search, draft trade
 * creation, internal notes, or admin preview tooling — those are "Access" /
 * "Discovery" surfaces that David explicitly wants to keep frictionless.
 */

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export type GatePosition = "entry" | "poi_mint" | "wad_only";
export type GateCallsite = "poi_mint" | "outreach";

export type LegitimacyDecision =
  | {
      allowed: true;
      status: "approved" | "deferred";
      gatePosition: GatePosition;
      approvalId: string | null;
      validUntil: string | null;
    }
  | {
      allowed: false;
      reason:
        | "no_record"
        | "not_approved"
        | "revoked"
        | "expired"
        | "frozen"
        | "lookup_failed";
      gatePosition: GatePosition;
      status: string | null;
      validUntil: string | null;
      message: string;
    };

/**
 * Resolve the legitimacy state of an org for a specific callsite.
 *
 * @param admin     SERVICE-ROLE supabase client (RLS must not hide rows)
 * @param orgId     The org being checked
 * @param callsite  Where the gate is firing (poi_mint or outreach)
 */
export async function checkOrgLegitimacy(
  admin: AdminClient,
  orgId: string | null | undefined,
  callsite: GateCallsite = "poi_mint",
): Promise<LegitimacyDecision> {
  if (!orgId) {
    return {
      allowed: false,
      reason: "no_record",
      gatePosition: "poi_mint",
      status: null,
      validUntil: null,
      message:
        "Your organisation profile is not linked. Complete onboarding before issuing a Proof of Intent or contacting a counterparty.",
    };
  }

  // Resolve the active gate posture (default: 'poi_mint').
  let gatePosition: GatePosition = "poi_mint";
  try {
    const { data: positionData, error: positionErr } = await admin.rpc(
      "get_org_gate_position",
      { _org_id: orgId },
    );
    if (!positionErr && positionData) {
      gatePosition = positionData as GatePosition;
    }
  } catch {
    // Fallback to default — never fail-open on a config lookup error.
    gatePosition = "poi_mint";
  }

  // ── wad_only: skip verification at this callsite; WaD will gate execution ──
  if (gatePosition === "wad_only") {
    return {
      allowed: true,
      status: "deferred",
      gatePosition,
      approvalId: null,
      validUntil: null,
    };
  }

  // ── Organisation operational status (frozen == blocked/suspended) ──
  // `organizations.frozen` is the existing primitive used by the collapse
  // and break-glass paths to suspend an org. We fold it into the legitimacy
  // gate so a frozen org also fails POI mint, outreach, and forward POI
  // progression — without inventing a new vocabulary.
  try {
    const { data: orgRow } = await admin
      .from("organizations")
      .select("frozen, frozen_reason")
      .eq("id", orgId)
      .maybeSingle();
    if (orgRow?.frozen) {
      return {
        allowed: false,
        reason: "frozen",
        gatePosition,
        status: "frozen",
        validUntil: null,
        message:
          `Your organisation is currently restricted${orgRow.frozen_reason ? ` (${orgRow.frozen_reason})` : ""}. Counterparty-facing actions are blocked until a platform administrator lifts the restriction.`,
      };
    }
  } catch {
    // Lookup failure here is non-fatal — fall through to trade_approvals.
  }

  // ── entry & poi_mint: enforce trade_approvals = 'approved' ──
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
      gatePosition,
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
      gatePosition,
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
      gatePosition,
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
      gatePosition,
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
        gatePosition,
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
    gatePosition,
    approvalId: data.id as string,
    validUntil,
  };
}

/**
 * Resolve the active org_governance_profile row (id + position) for forensic
 * audit memory (Step 3). Returns nulls if no profile exists. Cheap — uses the
 * partial unique index on org_id WHERE effective_to IS NULL.
 */
export async function getActiveGovernanceProfile(
  admin: AdminClient,
  orgId: string | null | undefined,
): Promise<{ profileId: string | null; position: GatePosition }> {
  if (!orgId) return { profileId: null, position: "poi_mint" };
  try {
    const { data } = await admin
      .from("org_governance_profiles")
      .select("id, verification_gate_position")
      .eq("org_id", orgId)
      .is("effective_to", null)
      .maybeSingle();
    if (!data) return { profileId: null, position: "poi_mint" };
    return {
      profileId: data.id as string,
      position: data.verification_gate_position as GatePosition,
    };
  } catch {
    return { profileId: null, position: "poi_mint" };
  }
}

/**
 * Stable error code returned to callers when the gate blocks. Keeping a single
 * canonical code makes it trivial for the client to render the recovery CTA
 * (deep-link to Settings → Company Identity) without parsing the message.
 */
export const ORG_NOT_VERIFIED_CODE = "ORG_NOT_VERIFIED";

/**
 * Client-facing reason code required by the POI Verification Guardrails /
 * Draft-Only Mode contract. Emitted into every gate-blocked audit row as
 * `reason_code` and returned to the client alongside `ORG_NOT_VERIFIED_CODE`.
 *
 * Hard rule: there is NO admin override of this gate. `platform_admin` and
 * any other role still receives `POI_ORG_VERIFICATION_REQUIRED` when the
 * org legitimacy check denies — `checkOrgLegitimacy` above does not branch
 * on caller role. Override, if ever needed, will be added as a separately
 * controlled feature behind its own audit trail.
 */
export const POI_ORG_VERIFICATION_REQUIRED_CODE = "POI_ORG_VERIFICATION_REQUIRED";

/**
 * Canonical user-facing block message for the POI verification gate. Mirrors
 * the wording on the client `VerificationRequiredBanner` so server and UI
 * never drift.
 */
export const POI_ORG_VERIFICATION_REQUIRED_MESSAGE =
  "Verification required before issuing POI. You can continue preparing this POI as an internal draft, but your organisation must be verified before it can be issued, shared, sent to a counterparty, exported as a formal POI, or progressed into formal engagement.";

/**
 * Canonical metadata payload for every gate-blocked audit row. Use under
 * `metadata` on `audit_logs` / `admin_audit_logs` so the admin audit panel
 * can render blocked attempts through a single query.
 */
export function poiGateBlockedAuditMetadata(
  decision: Extract<LegitimacyDecision, { allowed: false }>,
  extras: {
    attempted_action: string;
    next_required_action?: string;
    correlation_id?: string;
    endpoint?: string;
    [k: string]: unknown;
  },
) {
  return {
    reason_code: POI_ORG_VERIFICATION_REQUIRED_CODE,
    legitimacy_reason: decision.reason,
    org_verification_status: decision.status,
    valid_until: decision.validUntil,
    gate_position: decision.gatePosition,
    next_required_action:
      extras.next_required_action ??
      "Complete organisation verification in Settings → Company Identity.",
    ...extras,
  };
}
