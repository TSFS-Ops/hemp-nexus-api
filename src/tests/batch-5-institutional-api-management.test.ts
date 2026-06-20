/**
 * Batch 5 — Institutional Verified Profile API (M008), Payment-Detail
 * Status API (M009), and API Client / Admin Management (M016).
 * Static / structural proofs only — no live HTTP. Same pattern as Batch 4.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  REGISTRY_API_SCOPES,
  REGISTRY_API_RESULT_STATES,
  REGISTRY_API_AUDIT_EVENT_NAMES,
  REGISTRY_API_PAYMENT_STATUS_FLAGS,
  REGISTRY_API_FORBIDDEN_RAW_BANK_FIELDS,
  mapBankStateToApiFlag,
  isProfileInstitutionallyUsable,
} from "@/lib/registry-institutional-api";

const tsSsot = readFileSync("src/lib/registry-institutional-api.ts", "utf8");
const denoSsot = readFileSync("supabase/functions/_shared/registry-institutional-api.ts", "utf8");
const profileEdge = readFileSync("supabase/functions/registry-institutional-profile-status/index.ts", "utf8");
const paymentEdge = readFileSync("supabase/functions/registry-institutional-payment-status/index.ts", "utf8");
const adminEdge = readFileSync("supabase/functions/registry-api-client-manage/index.ts", "utf8");
const usageEdge = readFileSync("supabase/functions/registry-api-usage-log/index.ts", "utf8");
const adminUi = readFileSync("src/pages/admin/registry/Api.tsx", "utf8");

describe("Batch 5 — SSOT parity", () => {
  for (const name of [
    "REGISTRY_API_SCOPES",
    "REGISTRY_API_RESULT_STATES",
    "REGISTRY_API_AUDIT_EVENT_NAMES",
    "REGISTRY_API_PAYMENT_STATUS_FLAGS",
    "REGISTRY_API_FORBIDDEN_RAW_BANK_FIELDS",
  ]) {
    it(`${name} stays TS ↔ Deno byte-aligned`, () => {
      const re = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
      expect(tsSsot.match(re)?.[1].replace(/\s+/g, "")).toBe(denoSsot.match(re)?.[1].replace(/\s+/g, ""));
    });
  }
});

describe("Batch 5 — scope set & no raw bank-detail scope", () => {
  it("seven canonical scopes are present", () => {
    expect(REGISTRY_API_SCOPES).toEqual([
      "registry.search",
      "registry.profile.read",
      "registry.profile.status.read",
      "registry.profile.verified.read",
      "registry.payment_status.read",
      "registry.claim.status.read",
      "registry.coverage.read",
    ]);
  });
  it("no raw bank-detail scope is declared in Batch 5", () => {
    for (const s of REGISTRY_API_SCOPES) {
      expect(s).not.toMatch(/bank|account|iban|swift|sort_code|routing/i);
    }
  });
});

describe("Batch 5 — institutional-result-state hygiene", () => {
  it("13 canonical result states", () => {
    expect(REGISTRY_API_RESULT_STATES).toHaveLength(13);
  });
  it("usable is the only positive state", () => {
    expect(REGISTRY_API_RESULT_STATES).toContain("usable");
    expect(REGISTRY_API_RESULT_STATES).toContain("business_decision_required");
    expect(REGISTRY_API_RESULT_STATES).toContain("insufficient_authority");
    expect(REGISTRY_API_RESULT_STATES).toContain("insufficient_provenance");
    expect(REGISTRY_API_RESULT_STATES).toContain("seed_only");
  });
});

describe("Batch 5 — payment-status state machine", () => {
  it("only `verified` underlying state maps to verified flag", () => {
    expect(mapBankStateToApiFlag("verified")).toBe("verified");
  });
  it("captured_unverified maps to not_verified", () => {
    expect(mapBankStateToApiFlag("captured_unverified")).toBe("not_verified");
  });
  for (const s of ["verification_pending", "failed", "not_provided", "cancelled"]) {
    it(`${s} maps to not_verified`, () => expect(mapBankStateToApiFlag(s)).toBe("not_verified"));
  }
  it("expired maps to expired", () => expect(mapBankStateToApiFlag("expired")).toBe("expired"));
  it("disputed maps to disputed", () => expect(mapBankStateToApiFlag("disputed")).toBe("disputed"));
  it("revoked maps to unavailable", () => expect(mapBankStateToApiFlag("revoked")).toBe("unavailable"));
  it("provider_unavailable maps to unavailable", () => expect(mapBankStateToApiFlag("provider_unavailable")).toBe("unavailable"));
  it("five payment flags only", () => {
    expect(REGISTRY_API_PAYMENT_STATUS_FLAGS).toEqual(["verified", "not_verified", "expired", "disputed", "unavailable"]);
  });
});

describe("Batch 5 — verified-profile gate", () => {
  const base = {
    profile_verified: true, authority_approved: true,
    has_sufficient_provenance: true, coverage_state: "production_ready",
    business_decision_approved: true,
  };
  it("all gates green → usable", () => {
    expect(isProfileInstitutionallyUsable(base)).toBe(true);
  });
  it("claim approval alone is not enough (authority missing)", () => {
    expect(isProfileInstitutionallyUsable({ ...base, authority_approved: false })).toBe(false);
  });
  it("authority alone is not enough (profile not verified)", () => {
    expect(isProfileInstitutionallyUsable({ ...base, profile_verified: false })).toBe(false);
  });
  it("missing business decision short-circuits", () => {
    expect(isProfileInstitutionallyUsable({ ...base, business_decision_approved: false })).toBe(false);
  });
  it("insufficient provenance short-circuits", () => {
    expect(isProfileInstitutionallyUsable({ ...base, has_sufficient_provenance: false })).toBe(false);
  });
  it("seed_only coverage short-circuits", () => {
    expect(isProfileInstitutionallyUsable({ ...base, coverage_state: "seed_only" })).toBe(false);
  });
  it("no_coverage short-circuits", () => {
    expect(isProfileInstitutionallyUsable({ ...base, coverage_state: "no_coverage" })).toBe(false);
  });
});

describe("Batch 5 — edge-function structural guarantees", () => {
  it("profile-status edge consults business_decisions and isProfileInstitutionallyUsable", () => {
    expect(profileEdge).toContain(`from("business_decisions")`);
    expect(profileEdge).toContain("isProfileInstitutionallyUsable");
  });
  it("payment-status edge consults business_decisions and mapBankStateToApiFlag", () => {
    expect(paymentEdge).toContain(`from("business_decisions")`);
    expect(paymentEdge).toContain("mapBankStateToApiFlag");
  });
  it("both facades audit registry_api_response_returned", () => {
    expect(profileEdge).toContain(`"registry_api_response_returned"`);
    expect(paymentEdge).toContain(`"registry_api_response_returned"`);
  });
  it("admin client manage requires platform_admin OR compliance_owner", () => {
    expect(adminEdge).toContain(`"platform_admin"`);
    expect(adminEdge).toContain(`"compliance_owner"`);
    expect(adminEdge).toContain(`"forbidden"`);
  });
  it("admin client manage supports the 6 admin actions", () => {
    for (const a of ["create_client","update_client","suspend_client","reactivate_client","create_key","revoke_key"]) {
      expect(adminEdge).toContain(`"${a}"`);
    }
  });
  it("usage-log requires INTERNAL_CRON_KEY", () => {
    expect(usageEdge).toContain("INTERNAL_CRON_KEY");
    expect(usageEdge).toContain(`"registry_api_rate_limit_hit"`);
  });
  it("admin client-manage emits all admin audit names", () => {
    for (const n of [
      "registry_api_client_created","registry_api_client_updated",
      "registry_api_client_suspended","registry_api_key_created","registry_api_key_revoked",
    ]) {
      expect(adminEdge).toContain(`"${n}"`);
    }
  });
});

describe("Batch 5 — raw bank-detail leak guard", () => {
  it("profile-status edge contains no forbidden raw bank fields", () => {
    for (const tok of REGISTRY_API_FORBIDDEN_RAW_BANK_FIELDS) {
      expect(profileEdge).not.toMatch(new RegExp(`\\b${tok}\\b`));
    }
  });
  it("payment-status edge contains no forbidden raw bank fields", () => {
    for (const tok of REGISTRY_API_FORBIDDEN_RAW_BANK_FIELDS) {
      expect(paymentEdge).not.toMatch(new RegExp(`\\b${tok}\\b`));
    }
  });
  it("admin UI contains no forbidden raw bank fields", () => {
    for (const tok of REGISTRY_API_FORBIDDEN_RAW_BANK_FIELDS) {
      expect(adminUi).not.toMatch(new RegExp(`\\b${tok}\\b`));
    }
  });
});

describe("Batch 5 — no provider / no AI in batch 5 functions", () => {
  const files = [profileEdge, paymentEdge, adminEdge, usageEdge].map((s) => s.toLowerCase());
  const forbidden = ["cipc", "onfido", "globaldatabase", "b2bhint", "dow jones", "refinitiv", "payfast", "paystack", "openai", "resend", "outreach"];
  for (const tok of forbidden) {
    it(`no Batch 5 function references ${tok}`, () => {
      for (const f of files) expect(f).not.toContain(tok);
    });
  }
});

describe("Batch 5 — audit event coverage", () => {
  it("every canonical audit name is emitted by some Batch 5 edge function", () => {
    const all = [profileEdge, paymentEdge, adminEdge, usageEdge].join("\n");
    for (const n of REGISTRY_API_AUDIT_EVENT_NAMES) {
      expect(all).toContain(`"${n}"`);
    }
  });
});
