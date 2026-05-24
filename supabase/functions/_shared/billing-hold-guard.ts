/**
 * DEC-007 / PAY-009 — Billing-hold guard.
 *
 * Used by token-purchase checkout init, package upgrades and the burn path
 * to refuse credit-moving actions whenever an org is on billing_hold.
 *
 * The authoritative guard is inside `atomic_token_burn` (DB-level) — this
 * helper is the application-layer mirror so we can return a clean 409 with
 * a stable error code before invoking the RPC.
 *
 * Block list:   new purchase / package upgrade / POI mint / credit burn / WaD if it burns
 * Do NOT block: read-only access, search, evidence-pack view, support contact
 */

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

export interface BillingHoldStatus {
  active: boolean;
  reason: string | null;
  appliedAt: string | null;
}

export async function getBillingHoldStatus(
  admin: SupabaseLike,
  orgId: string,
): Promise<BillingHoldStatus> {
  const { data, error } = await admin
    .from("organizations")
    .select("billing_hold, billing_hold_reason, billing_hold_applied_at")
    .eq("id", orgId)
    .maybeSingle();
  if (error || !data) {
    return { active: false, reason: null, appliedAt: null };
  }
  return {
    active: data.billing_hold === true,
    reason: data.billing_hold_reason ?? null,
    appliedAt: data.billing_hold_applied_at ?? null,
  };
}

export class BillingHoldActiveError extends Error {
  public readonly code = "BILLING_HOLD_ACTIVE";
  public readonly status = 409;
  constructor(public readonly reason: string | null = null) {
    super("BILLING_HOLD_ACTIVE");
    this.name = "BillingHoldActiveError";
  }
}

/** Throws BillingHoldActiveError if the org is on billing hold. */
export async function assertNoBillingHold(
  admin: SupabaseLike,
  orgId: string,
): Promise<void> {
  const status = await getBillingHoldStatus(admin, orgId);
  if (status.active) {
    throw new BillingHoldActiveError(status.reason);
  }
}
