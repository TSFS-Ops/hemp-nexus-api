/**
 * Consequence Module - Unit Tests
 *
 * Tests the deterministic state derivation, action availability,
 * blocked reason logic, role resolution, and supersession helpers.
 */

import { describe, it, expect } from "vitest";
import {
  deriveConsequenceState,
  resolveAttestationRole,
  hasSupersessionHistory,
  type WadRecord,
  type WadAttestation,
} from "@/lib/modules/consequence/logic";

// ── Test data factories ──

const makeAttestation = (overrides: Partial<WadAttestation> = {}): WadAttestation => ({
  id: "att-1",
  wad_id: "wad-1",
  user_id: "user-1",
  org_id: "org-buyer",
  role: "buyer_signatory",
  attested_name: "John Doe",
  attested_at: "2026-01-01T00:00:00Z",
  attestation_text: "I confirm...",
  ...overrides,
});

const makeWad = (overrides: Partial<WadRecord> = {}): WadRecord => ({
  id: "wad-1",
  poi_id: "match-1",
  status: "draft",
  evidence_bundle: null,
  seal_hash: null,
  sealed_at: null,
  created_at: "2026-01-01T00:00:00Z",
  buyer_org_id: "org-buyer",
  seller_org_id: "org-seller",
  attestations: [],
  ...overrides,
});

// ── Tests ──

describe("Consequence Module - deriveConsequenceState", () => {
  describe("No WaD exists", () => {
    it("returns not_started when match is settled", () => {
      const state = deriveConsequenceState(null, "settled", "org-buyer");
      expect(state.uiStatus).toBe("not_started");
      expect(state.canCreate).toBe(true);
      expect(state.createBlockedReasons).toHaveLength(0);
      expect(state.canAttest).toBe(false);
      expect(state.canSeal).toBe(false);
      expect(state.canDownloadCertificate).toBe(false);
    });

    it("returns blocked when match is not settled", () => {
      const state = deriveConsequenceState(null, "discovery", "org-buyer");
      expect(state.uiStatus).toBe("blocked");
      expect(state.canCreate).toBe(false);
      expect(state.createBlockedReasons.length).toBeGreaterThan(0);
      expect(state.createBlockedReasons[0].gate).toBe("poi_status");
    });

    it("returns blocked for pending match", () => {
      const state = deriveConsequenceState(null, "pending", "org-buyer");
      expect(state.uiStatus).toBe("blocked");
      expect(state.canCreate).toBe(false);
    });
  });

  describe("Draft WaD, no attestations", () => {
    it("returns draft status", () => {
      const state = deriveConsequenceState(makeWad(), "settled", "org-buyer");
      expect(state.uiStatus).toBe("draft");
      expect(state.canCreate).toBe(false);
      expect(state.canAttest).toBe(true);
      expect(state.canSeal).toBe(false);
      expect(state.canDownloadCertificate).toBe(false);
      expect(state.attestations.buyerAttested).toBe(false);
      expect(state.attestations.sellerAttested).toBe(false);
    });

    it("non-party user cannot attest", () => {
      const state = deriveConsequenceState(makeWad(), "settled", "org-other");
      expect(state.canAttest).toBe(false);
    });
  });

  describe("Partial attestation", () => {
    it("shows awaiting_attestations when buyer has attested", () => {
      const wad = makeWad({
        attestations: [makeAttestation({ role: "buyer_signatory", org_id: "org-buyer" })],
      });
      const state = deriveConsequenceState(wad, "settled", "org-seller");
      expect(state.uiStatus).toBe("awaiting_attestations");
      expect(state.attestations.buyerAttested).toBe(true);
      expect(state.attestations.sellerAttested).toBe(false);
      expect(state.canAttest).toBe(true);
      expect(state.hasAttested).toBe(false);
      expect(state.canSeal).toBe(false);
    });

    it("buyer who already attested cannot attest again", () => {
      const wad = makeWad({
        attestations: [makeAttestation({ role: "buyer_signatory", org_id: "org-buyer" })],
      });
      const state = deriveConsequenceState(wad, "settled", "org-buyer");
      expect(state.hasAttested).toBe(true);
      expect(state.canAttest).toBe(false);
    });
  });

  describe("Both attested - ready to seal", () => {
    it("shows ready_to_seal", () => {
      const wad = makeWad({
        attestations: [
          makeAttestation({ id: "a1", role: "buyer_signatory", org_id: "org-buyer" }),
          makeAttestation({ id: "a2", role: "seller_signatory", org_id: "org-seller" }),
        ],
      });
      const state = deriveConsequenceState(wad, "settled", "org-buyer");
      expect(state.uiStatus).toBe("ready_to_seal");
      expect(state.allAttested).toBe(true);
      expect(state.canSeal).toBe(true);
      expect(state.canDownloadCertificate).toBe(false);
    });
  });

  describe("Sealed WaD", () => {
    it("shows sealed status with certificate available", () => {
      const wad = makeWad({
        status: "sealed",
        seal_hash: "abc123",
        sealed_at: "2026-01-02T00:00:00Z",
        attestations: [
          makeAttestation({ id: "a1", role: "buyer_signatory", org_id: "org-buyer" }),
          makeAttestation({ id: "a2", role: "seller_signatory", org_id: "org-seller" }),
        ],
      });
      const state = deriveConsequenceState(wad, "settled", "org-buyer");
      expect(state.uiStatus).toBe("sealed");
      expect(state.canDownloadCertificate).toBe(true);
      expect(state.canRevoke).toBe(true);
      expect(state.canSeal).toBe(false);
      expect(state.canAttest).toBe(false);
      expect(state.isTerminal).toBe(false);
    });
  });

  describe("Terminal states", () => {
    it("revoked WaD is terminal", () => {
      const wad = makeWad({ status: "revoked" });
      const state = deriveConsequenceState(wad, "settled", "org-buyer");
      expect(state.uiStatus).toBe("revoked");
      expect(state.isTerminal).toBe(true);
      expect(state.canDownloadCertificate).toBe(false);
      expect(state.canSeal).toBe(false);
      expect(state.canAttest).toBe(false);
      expect(state.canRevoke).toBe(false);
    });

    it("superseded WaD is terminal", () => {
      const wad = makeWad({ status: "superseded" });
      const state = deriveConsequenceState(wad, "settled", "org-buyer");
      expect(state.uiStatus).toBe("superseded");
      expect(state.isTerminal).toBe(true);
    });
  });

  describe("Status labels", () => {
    it("returns correct labels for each status", () => {
      expect(deriveConsequenceState(null, "settled", null).statusLabel).toBe("Ready to create");
      expect(deriveConsequenceState(null, "discovery", null).statusLabel).toBe("Blocked - prerequisites not met");
      expect(deriveConsequenceState(makeWad(), "settled", null).statusLabel).toContain("Draft");
      expect(deriveConsequenceState(makeWad({ status: "sealed" }), "settled", null).statusLabel).toBe("Sealed");
      expect(deriveConsequenceState(makeWad({ status: "revoked" }), "settled", null).statusLabel).toBe("Revoked");
    });
  });

  describe("Null safety", () => {
    it("handles null userOrgId", () => {
      const state = deriveConsequenceState(makeWad(), "settled", null);
      expect(state.canAttest).toBe(false);
      expect(state.hasAttested).toBe(false);
    });

    it("handles wad with undefined attestations", () => {
      const wad = makeWad();
      delete (wad as any).attestations;
      const state = deriveConsequenceState(wad, "settled", "org-buyer");
      expect(state.attestations.total).toBe(0);
      expect(state.attestations.buyerAttested).toBe(false);
    });
  });
});

describe("Consequence Module - resolveAttestationRole", () => {
  it("returns buyer_signatory for buyer org", () => {
    expect(resolveAttestationRole("org-buyer", "org-buyer", "org-seller")).toBe("buyer_signatory");
  });

  it("returns seller_signatory for seller org", () => {
    expect(resolveAttestationRole("org-seller", "org-buyer", "org-seller")).toBe("seller_signatory");
  });

  it("returns witness for non-party org", () => {
    expect(resolveAttestationRole("org-other", "org-buyer", "org-seller")).toBe("witness");
  });

  it("returns witness for null user org", () => {
    expect(resolveAttestationRole(null, "org-buyer", "org-seller")).toBe("witness");
  });
});

describe("Consequence Module - hasSupersessionHistory", () => {
  it("returns false for empty list", () => {
    expect(hasSupersessionHistory([])).toBe(false);
  });

  it("returns false when only active wad", () => {
    expect(hasSupersessionHistory([makeWad({ status: "sealed" })])).toBe(false);
  });

  it("returns true when revoked wad exists", () => {
    expect(hasSupersessionHistory([
      makeWad({ id: "w1", status: "revoked" }),
      makeWad({ id: "w2", status: "sealed" }),
    ])).toBe(true);
  });

  it("returns true when superseded wad exists", () => {
    expect(hasSupersessionHistory([
      makeWad({ id: "w1", status: "superseded" }),
      makeWad({ id: "w2", status: "draft" }),
    ])).toBe(true);
  });
});
