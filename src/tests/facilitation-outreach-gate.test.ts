import { describe, it, expect } from "vitest";
import { resolveOutreachGate } from "@/lib/facilitation-outreach-gate";

const baseInput = {
  candidate: { contact_email: "ops@acme.com", counterparty_org_name: "Acme Ltd" },
  dnc_rules: [],
  duplicate_status: "no_duplicate" as const,
  suppression_active: false,
  compliance_escalation_open: false,
};

describe("resolveOutreachGate", () => {
  it("allows when no signals present", () => {
    const d = resolveOutreachGate(baseInput);
    expect(d.result).toBe("allow");
    expect(d.reasons).toEqual([]);
  });

  it("blocks on DNC email match", () => {
    const d = resolveOutreachGate({
      ...baseInput,
      dnc_rules: [{ rule_type: "email", value: "ops@acme.com", status: "active", severity: "block" }],
    });
    expect(d.result).toBe("block");
    expect(d.reasons).toContain("dnc_email_block");
  });

  it("blocks on DNC domain match", () => {
    const d = resolveOutreachGate({
      ...baseInput,
      dnc_rules: [{ rule_type: "email_domain", value: "acme.com", status: "active", severity: "block" }],
    });
    expect(d.result).toBe("block");
    expect(d.reasons).toContain("dnc_domain_block");
  });

  it("warns on org-name DNC match", () => {
    const d = resolveOutreachGate({
      ...baseInput,
      dnc_rules: [{ rule_type: "org_name", value: "acme ltd", status: "active", severity: "warn" }],
    });
    expect(d.result).toBe("warn");
    expect(d.reasons).toContain("dnc_org_name_warning");
  });

  it("ignores revoked DNC rules", () => {
    const d = resolveOutreachGate({
      ...baseInput,
      dnc_rules: [{ rule_type: "email", value: "ops@acme.com", status: "revoked", severity: "block" }],
    });
    expect(d.result).toBe("allow");
  });

  it("blocks on exact registry-id duplicate", () => {
    const d = resolveOutreachGate({ ...baseInput, duplicate_status: "duplicate_exact_registry_id" });
    expect(d.result).toBe("block");
    expect(d.reasons).toContain("duplicate_exact_registry_id");
  });

  it("blocks on verified-domain duplicate", () => {
    const d = resolveOutreachGate({ ...baseInput, duplicate_status: "duplicate_verified_domain" });
    expect(d.result).toBe("block");
  });

  it("warns on soft-name duplicate", () => {
    const d = resolveOutreachGate({ ...baseInput, duplicate_status: "duplicate_soft_name_match" });
    expect(d.result).toBe("warn");
    expect(d.reasons).toContain("duplicate_soft_name_match");
  });

  it("blocks on suppression", () => {
    const d = resolveOutreachGate({ ...baseInput, suppression_active: true });
    expect(d.result).toBe("block");
  });

  it("blocks on open compliance escalation", () => {
    const d = resolveOutreachGate({ ...baseInput, compliance_escalation_open: true });
    expect(d.result).toBe("block");
    expect(d.reasons).toContain("compliance_escalation_open");
  });

  it("block dominates warn when both present", () => {
    const d = resolveOutreachGate({
      ...baseInput,
      duplicate_status: "duplicate_soft_name_match",
      compliance_escalation_open: true,
    });
    expect(d.result).toBe("block");
    expect(d.reasons).toEqual(["duplicate_soft_name_match", "compliance_escalation_open"]);
  });
});
