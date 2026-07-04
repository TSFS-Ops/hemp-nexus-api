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
  // Batch V-UI: existing p5scr_subjects schema exposes
  //   organisation_id + person_external_ref (NOT user_id / org_id).
  // Query by the real columns and stop swallowing schema errors.
  if (actor.user_id) {
    const { data } = await admin
      .from("p5scr_subjects")
      .select("id")
      .eq("person_external_ref", actor.user_id)
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  if (actor.org_id) {
    const { data } = await admin
      .from("p5scr_subjects")
      .select("id")
      .eq("organisation_id", actor.org_id)
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  return null;
}

/**
 * Enforce the IDV gate for a controlled action performed by `actor`.
 * Throws `IdvGateError` when the actor has a blocking IDV state OR when
 * no subject row exists for the actor (Batch V-UI fail-closed
 * hardening — non-sensitive work remains allowed elsewhere, but every
 * controlled action must have an identifiable subject to gate against).
 */
export async function assertActorIdvGate(
  admin: AdminClient,
  actor: ActorRef,
  action: ControlledAction,
): Promise<"released"> {
  const subjectId = await resolveSubjectId(admin, actor);
  if (!subjectId) {
    // Fail-closed. Blocker code is stringified via IdvGateError.code and
    // exposed by upstream 409 handlers; user wording is provider-neutral.
    throw new IdvGateError(
      "IDV_REQUIRED",
      "Identity verification required before this action",
      "no_subject",
      action,
    );
  }
  await assertControlledActionIdvGate(admin, subjectId, action);
  return "released";
}

export { IdvGateError, type ControlledAction };
