/**
 * Batch V-UI — the actor gate MUST fail-closed when no subject row
 * exists for the actor. Previously the gate soft-allowed the action,
 * which meant controlled-action gates were silently bypassed for any
 * user who had never been provisioned.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("Batch V-UI — no-subject fail-closed", () => {
  const gate = readFileSync("supabase/functions/_shared/idv-actor-gate.ts", "utf8");

  it("assertActorIdvGate throws IdvGateError when subject is missing", () => {
    // The gate must NOT return 'no_subject' as a soft-allow branch.
    expect(gate.includes('return "no_subject"')).toBe(false);
    expect(gate.match(/throw new IdvGateError\(/)).not.toBeNull();
    expect(gate.includes('"no_subject"')).toBe(true); // used as status arg only
  });

  it("resolveSubjectId uses actual p5scr_subjects columns", () => {
    expect(gate.includes("person_external_ref")).toBe(true);
    expect(gate.includes("organisation_id")).toBe(true);
    // must NOT query the non-existent columns any more
    expect(gate.match(/\.eq\("user_id"/)).toBeNull();
    expect(gate.match(/\.eq\("org_id"/)).toBeNull();
  });

  it("does not silently swallow schema errors any more", () => {
    // The old implementation wrapped both queries in try/catch. Remove
    // both to guarantee real errors surface instead of returning null
    // (which used to trigger the soft-allow path).
    const tryCount = (gate.match(/try\s*\{/g) ?? []).length;
    expect(tryCount).toBe(0);
  });
});
