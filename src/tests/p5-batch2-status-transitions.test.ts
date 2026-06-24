import { describe, expect, it } from "vitest";
import { evaluateP5B2Transition } from "@/lib/p5-batch2/status-transitions";

describe("p5-batch2 status-transitions", () => {
  it("allows missing -> uploaded by organisation_user", () => {
    const r = evaluateP5B2Transition({ from: "missing", action: "upload", actor: "organisation_user" });
    expect(r.allowed).toBe(true);
    expect(r.to).toBe("uploaded");
  });

  it("denies missing -> accepted (illegal status transition)", () => {
    const r = evaluateP5B2Transition({ from: "missing", action: "accept", actor: "platform_admin" });
    expect(r.allowed).toBe(false);
    expect(r.denial?.code).toBe("illegal_status_transition");
  });

  it("denies funder from performing any mutation (actor_not_authorised)", () => {
    const r = evaluateP5B2Transition({ from: "uploaded", action: "accept", actor: "funder" });
    expect(r.allowed).toBe(false);
    expect(r.denial?.code).toBe("actor_not_authorised");
  });

  it("denies api_customer from accepting evidence", () => {
    const r = evaluateP5B2Transition({ from: "uploaded", action: "accept", actor: "api_customer" });
    expect(r.allowed).toBe(false);
    expect(r.denial?.code).toBe("actor_not_authorised");
  });

  it("denies replaced (terminal) -> anything", () => {
    const r = evaluateP5B2Transition({ from: "replaced", action: "upload", actor: "platform_admin" });
    expect(r.allowed).toBe(false);
    expect(r.denial?.code).toBe("terminal_status");
  });

  it("denies revoked (terminal) -> anything", () => {
    const r = evaluateP5B2Transition({ from: "revoked", action: "resume", actor: "platform_admin" });
    expect(r.allowed).toBe(false);
    expect(r.denial?.code).toBe("terminal_status");
  });

  it("only platform_admin can revoke", () => {
    const a = evaluateP5B2Transition({ from: "accepted", action: "revoke", actor: "compliance_owner" });
    expect(a.allowed).toBe(false);
    const b = evaluateP5B2Transition({ from: "accepted", action: "revoke", actor: "platform_admin" });
    expect(b.allowed).toBe(true);
    expect(b.to).toBe("revoked");
  });

  it("only admin/compliance can waive", () => {
    const a = evaluateP5B2Transition({ from: "missing", action: "waive", actor: "operator_case_manager" });
    expect(a.allowed).toBe(false);
    const b = evaluateP5B2Transition({ from: "missing", action: "waive", actor: "platform_admin" });
    expect(b.allowed).toBe(true);
    expect(b.to).toBe("waived");
  });

  it("allows uploaded -> under_review -> accepted by compliance_owner", () => {
    const a = evaluateP5B2Transition({ from: "uploaded", action: "start_review", actor: "compliance_owner" });
    expect(a.allowed).toBe(true);
    expect(a.to).toBe("under_review");
    const b = evaluateP5B2Transition({ from: "under_review", action: "accept", actor: "compliance_owner" });
    expect(b.allowed).toBe(true);
    expect(b.to).toBe("accepted");
  });

  it("allows provider_dependent -> accepted with admin", () => {
    const r = evaluateP5B2Transition({ from: "provider_dependent", action: "accept", actor: "platform_admin" });
    expect(r.allowed).toBe(true);
    expect(r.to).toBe("accepted");
  });

  it("allows expire transitions via system only (or admin)", () => {
    const a = evaluateP5B2Transition({ from: "accepted", action: "expire", actor: "organisation_user" });
    expect(a.allowed).toBe(false);
    const b = evaluateP5B2Transition({ from: "accepted", action: "expire", actor: "system" });
    expect(b.allowed).toBe(true);
    expect(b.to).toBe("expired");
  });

  it("allows replace from rejected/expired", () => {
    expect(evaluateP5B2Transition({ from: "rejected", action: "replace", actor: "platform_admin" }).allowed).toBe(true);
    expect(evaluateP5B2Transition({ from: "expired", action: "upload", actor: "organisation_user" }).allowed).toBe(true);
  });
});
