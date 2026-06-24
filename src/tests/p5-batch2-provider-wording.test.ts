import { describe, expect, it } from "vitest";
import {
  checkP5B2ProviderWording,
  getP5B2SafeProviderLabel,
  P5B2_SAFE_WORDING,
} from "@/lib/p5-batch2/provider-wording-guard";
import { P5B2_FORBIDDEN_PROVIDER_WORDING } from "@/lib/p5-batch2/constants";

describe("p5-batch2 provider-wording-guard", () => {
  it("blocks every forbidden phrase when provider_live=false", () => {
    for (const phrase of P5B2_FORBIDDEN_PROVIDER_WORDING) {
      const r = checkP5B2ProviderWording({
        text: `Status: ${phrase} by service`,
        provider_live: false,
        viewer: "counterparty",
      });
      expect(r.safe).toBe(false);
      expect(r.matched).toContain(phrase);
    }
  });

  it("allows arbitrary text when provider_live=true (real result exists)", () => {
    const r = checkP5B2ProviderWording({
      text: "Provider verified: bank verified",
      provider_live: true,
      viewer: "funder",
    });
    expect(r.safe).toBe(true);
  });

  it("passes safe wording (Provider-ready, not live-provider verified)", () => {
    const r = checkP5B2ProviderWording({
      text: "Provider-ready, not live-provider verified",
      provider_live: false,
      viewer: "funder",
    });
    expect(r.safe).toBe(true);
  });

  it("returns viewer-specific safe label for each provider status", () => {
    expect(getP5B2SafeProviderLabel("admin", "provider_ready_not_live_provider_verified"))
      .toMatch(/Provider-ready/);
    expect(getP5B2SafeProviderLabel("api_user", "provider_failed")).toBe("provider_failed");
    expect(getP5B2SafeProviderLabel("counterparty", "provider_result_pending")).toMatch(/pending/i);
  });

  it("every safe wording catalogue avoids the forbidden phrases", () => {
    for (const viewer of Object.keys(P5B2_SAFE_WORDING) as Array<keyof typeof P5B2_SAFE_WORDING>) {
      for (const entry of P5B2_SAFE_WORDING[viewer]) {
        const r = checkP5B2ProviderWording({
          text: entry.label,
          provider_live: false,
          viewer,
        });
        expect(r.safe, `viewer=${viewer} label="${entry.label}"`).toBe(true);
      }
    }
  });
});
