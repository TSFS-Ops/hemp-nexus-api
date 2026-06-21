/**
 * Unit tests for the Registry ↔ Counterparty unification SSOT.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeCompanyName,
  isCandidateMatch,
  buildLinkSuggestions,
  buildProposeLinkUrl,
  buildProposeRegistryRecordUrl,
  REGISTRY_COUNTERPARTY_LINK_STATES,
} from "@/lib/registry-counterparty-link-ssot";

describe("normalizeCompanyName", () => {
  it("lower-cases, strips punctuation and trailing legal suffix", () => {
    expect(normalizeCompanyName("Acme Trading (Pty) Ltd")).toBe("acme trading");
    expect(normalizeCompanyName("Acme Trading Ltd")).toBe("acme trading");
    expect(normalizeCompanyName("Acme, Trading Limited")).toBe("acme trading");
    expect(normalizeCompanyName("ACME GmbH")).toBe("acme");
  });
  it("handles null/empty safely", () => {
    expect(normalizeCompanyName(null)).toBe("");
    expect(normalizeCompanyName("")).toBe("");
  });
});

describe("isCandidateMatch — conservative, never auto-link", () => {
  it("matches same name across legal suffix variants", () => {
    expect(
      isCandidateMatch(
        { id: "c1", name: "Acme Trading (Pty) Ltd", countryCode: "ZA" },
        { id: "r1", name: "Acme Trading Limited", countryCode: "ZA" },
      ),
    ).toBe(true);
  });
  it("rejects when both declare different country codes", () => {
    expect(
      isCandidateMatch(
        { id: "c1", name: "Acme Trading Ltd", countryCode: "ZA" },
        { id: "r1", name: "Acme Trading Ltd", countryCode: "NG" },
      ),
    ).toBe(false);
  });
  it("rejects when names differ", () => {
    expect(
      isCandidateMatch(
        { id: "c1", name: "Acme Trading Ltd" },
        { id: "r1", name: "Globex Holdings Ltd" },
      ),
    ).toBe(false);
  });
});

describe("buildLinkSuggestions", () => {
  it("returns candidate_match, counterparty_only and registry_only", () => {
    const out = buildLinkSuggestions(
      [
        { id: "c1", name: "Acme Trading (Pty) Ltd", countryCode: "ZA" },
        { id: "c2", name: "Solo Counterparty Ltd" },
      ],
      [
        { id: "r1", name: "Acme Trading Limited", countryCode: "ZA" },
        { id: "r2", name: "Registry Orphan Ltd" },
      ],
    );
    expect(out.find((s) => s.state === "candidate_match")?.counterparty?.id).toBe("c1");
    expect(out.find((s) => s.state === "candidate_match")?.registry?.id).toBe("r1");
    expect(out.find((s) => s.state === "counterparty_only")?.counterparty?.id).toBe("c2");
    expect(out.find((s) => s.state === "registry_only")?.registry?.id).toBe("r2");
  });
});

describe("URL builders route through human-confirm flows", () => {
  it("propose-link routes through the claim flow", () => {
    const url = buildProposeLinkUrl("abc-123", "Acme Trading Ltd");
    expect(url).toContain("/registry/company/abc-123/claim");
    expect(url).toContain("proposed=1");
    expect(url).toContain("from_counterparty=Acme+Trading+Ltd");
  });
  it("propose-registry-record routes through new-company-request", () => {
    const url = buildProposeRegistryRecordUrl("Solo Counterparty Ltd", "za");
    expect(url).toContain("/registry/new-company-request");
    expect(url).toContain("name=Solo+Counterparty+Ltd");
    expect(url).toContain("country=ZA");
    expect(url).toContain("from_counterparty=1");
  });
});

describe("Link-state taxonomy", () => {
  it("exposes the four canonical states", () => {
    expect(REGISTRY_COUNTERPARTY_LINK_STATES).toEqual([
      "linked",
      "candidate_match",
      "registry_only",
      "counterparty_only",
    ]);
  });
});
