/**
 * Batch V-Wire — Actor IDV gate helper.
 *
 * Thin wrapper around `assertControlledActionIdvGate` that resolves the
 * actor's `p5scr_subjects.id` from either their `user_id` or their
 * `org_id`, then delegates to the shared gate. Non-fatal when no p5scr
 * subject row is found for the actor — matches the WaD-seal boundary
 * policy (subject enrolment is a separate wiring batch; the gate blocks
 * on any *existing* blocking IDV state).
 *
 * Consumers must pass a stable `ControlledAction` value so tests and
 * audit surfaces can enumerate wired call-sites.
 */

// deno-lint-ignore no-explicit-any
type AdminClient = any;

import {
  assertControlledActionIdvGate,
  IdvGateError,
  type ControlledAction,
} from "./idv-gate.ts";

interface ActorRef {
  user_id?: string | null;
  org_id?: string | null;
}

async function resolveSubjectId(
  admin: AdminClient,
  actor: ActorRef,
): Promise<string | null> {
  // Try user_id first — most common actor identity.
  if (actor.user_id) {
    try {
      const { data } = await admin
        .from("p5scr_subjects")
        .select("id")
        .eq("user_id", actor.user_id)
        .limit(1)
        .maybeSingle();
      if (data?.id) return data.id as string;
    } catch { /* schema may not carry user_id column yet */ }
  }
  // Fall back to org_id linkage (matches WaD gate lookup).
  if (actor.org_id) {
    try {
      const { data } = await admin
        .from("p5scr_subjects")
        .select("id")
        .eq("org_id", actor.org_id)
        .limit(1)
        .maybeSingle();
      if (data?.id) return data.id as string;
    } catch { /* absent */ }
  }
  return null;
}

/**
 * Enforce the IDV gate for a controlled action performed by `actor`.
 * Throws `IdvGateError` when the actor has a blocking IDV state.
 *
 * @returns `"released"` (allowed), `"no_subject"` (no subject row —
 *   soft-allow per boundary), or throws.
 */
export async function assertActorIdvGate(
  admin: AdminClient,
  actor: ActorRef,
  action: ControlledAction,
): Promise<"released" | "no_subject"> {
  const subjectId = await resolveSubjectId(admin, actor);
  if (!subjectId) return "no_subject";
  await assertControlledActionIdvGate(admin, subjectId, action);
  return "released";
}

export { IdvGateError, type ControlledAction };
