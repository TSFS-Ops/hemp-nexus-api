/**
 * Batch 3 — DealPipeline must not surface the "Counterparty TBD" fallback,
 * which looked like real seeded data. Missing-counterparty rows now read
 * "Counterparty pending".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "..", "components/desk/DealPipeline.tsx"),
  "utf8",
);

describe("Batch 3 — DealPipeline counterparty fallback copy", () => {
  it("removes the legacy 'Counterparty TBD' fallback string", () => {
    expect(SRC).not.toContain("Counterparty TBD");
  });

  it("uses a clearer missing-state label for buyer-side rows", () => {
    // Pin both call sites so this regresses if either drifts back to TBD.
    const matches = SRC.match(/Counterparty pending/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("still resolves to the real counterparty name when present", () => {
    expect(SRC).toMatch(/isBuyer\s*\?\s*m\.seller_name\s*:\s*m\.buyer_name/);
  });
});
