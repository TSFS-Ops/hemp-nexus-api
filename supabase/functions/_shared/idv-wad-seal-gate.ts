/**
 * Batch V -- WaD seal IDV gate.
 *
 * Called from `supabase/functions/wad/index.ts` on the `POST /:id/seal`
 * path. For each party org, we look up its registered `p5scr_subjects`
 * row and inspect the most recent `p5scr_idv_records` state. If any
 * party's IDV state is blocking (per `isIdvBlocking`), we deny the seal
 * with a stable error code.
 *
 * Fail-open policy for the *absence* of a p5scr subject row: the p5scr
 * subject registration is a separate wiring batch (Batch V-Wire). Where
 * the subject does not yet exist, this gate is a no-op -- but any
 * existing IDV record that is in a blocking state is respected. This
 * matches the "additive" rule: Batch V never regresses today's flows.
 *
 * Batch V-UI-Fix-4: the subject lookup below now queries
 * `organisation_id` (the real p5scr_subjects column) instead of the
 * previous `org_id`, which does not exist on that table. The old
 * column name meant every lookup errored and was silently swallowed,
 * so this gate never actually found a subject and could never block a
 * seal. Lookup failures (as opposed to "no row found") now fail CLOSED
 * rather than being treated the same as "subject not yet registered".
 *
 * NEVER returns a "verified" signal. Its only outputs are allow / deny.
 */

import { isIdvBlocking } from "./idv-gate.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export type WadSealIdvGateResult =
  | { allowed: true }
| {
  allowed: false;
  code: "IDV_REQUIRED_WAD_SEAL";
  party: "buyer" | "seller";
  status: string | null;
  message: string;
};

export async function assertWadSealIdvGate(
  admin: AdminClient,
  parties: { buyer_org_id: string | null; seller_org_id: string | null },
  ): Promise<WadSealIdvGateResult> {
  for (const [side, orgId] of [
    ["buyer", parties.buyer_org_id],
    ["seller", parties.seller_org_id],
    ] as const) {
    if (!orgId) continue;
    // Look up any p5scr_subjects row linked to this org via the real
  // schema column `organisation_id` (Batch V-UI-Fix-4: previously
  // queried the non-existent `org_id`, which errored on every call
  // and was swallowed below as if no subject existed -- a fail-open
  // bug in a controlled-action gate).
  let subjectId: string | null = null;
    let subjectLookupFailed = false;
    try {
      const { data, error } = await admin
      .from("p5scr_subjects")
      .select("id")
      .eq("organisation_id", orgId)
      .limit(1)
      .maybeSingle();
      if (error) {
        subjectLookupFailed = true;
      } else {
        subjectId = data?.id ?? null;
      }
    } catch {
      subjectLookupFailed = true;
    }

  // Batch V-UI-Fix-4: a genuine lookup failure (network/DB/schema
  // error) is NOT the same as "no subject registered yet". Treating
  // them identically was the fail-open bug. A real lookup failure
  // now fails CLOSED -- the seal is denied until the lookup can
  // succeed -- instead of silently skipping the gate.
  if (subjectLookupFailed) {
    return {
      allowed: false,
      code: "IDV_REQUIRED_WAD_SEAL",
      party: side,
      status: null,
      message:
        "Identity verification could not be confirmed due to a lookup error. Please retry or contact support.",
    };
  }
    if (!subjectId) continue;

  let latestState: string | null = null;
    try {
      const { data } = await admin
      .from("p5scr_idv_records")
      .select("state")
      .eq("subject_id", subjectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
      latestState = data?.state ?? null;
    } catch {
      latestState = null;
    }

  // If a subject exists AND has any IDV record, gate on its state.
  // No record + subject exists → treat as blocking (fail-closed for a
  // registered subject).
  if (latestState === null) {
    return {
      allowed: false,
      code: "IDV_REQUIRED_WAD_SEAL",
      party: side,
      status: null,
      message:
        "Identity verification required before sealing this Signed Deal.",
    };
  }
    if (isIdvBlocking(latestState)) {
      return {
        allowed: false,
        code: "IDV_REQUIRED_WAD_SEAL",
        party: side,
        status: latestState,
        message:
          "Identity verification is not yet complete for one of the signatories.",
      };
    }
  }
  return { allowed: true };
}
