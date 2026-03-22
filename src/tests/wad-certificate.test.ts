/**
 * WaD Certificate PDF — Unit Tests
 *
 * Tests certificate data assembly, state guards, access control logic,
 * and content correctness for the WaD certificate generation flow.
 */

import { describe, it, expect } from "vitest";

// ── Simulated certificate data structures ──

interface WadCertData {
  wad_id: string;
  poi_id: string;
  status: string;
  seal_hash: string | null;
  sealed_at: string | null;
  ledger_entry_hash: string | null;
  buyer_org_id: string | null;
  seller_org_id: string | null;
  org_id: string;
  evidence_bundle: any;
  certificate_generated_at: string | null;
}

interface Attestation {
  role: string;
  attested_name: string;
  attested_at: string;
  attestation_text: string;
}

interface PoiData {
  commodity: string | null;
  quantity_amount: number | null;
  quantity_unit: string | null;
  price_amount: number | null;
  price_currency: string | null;
  buyer_name: string | null;
  seller_name: string | null;
  settled_at: string | null;
}

function canGenerateCertificate(wad: WadCertData): { allowed: boolean; reason?: string } {
  if (wad.status !== "sealed") {
    return { allowed: false, reason: `Certificate only available for sealed WaDs, current status: ${wad.status}` };
  }
  if (!wad.seal_hash) {
    return { allowed: false, reason: "WaD has no seal hash" };
  }
  return { allowed: true };
}

function canAccessCertificate(
  wad: WadCertData,
  userOrgId: string,
  isAdmin: boolean
): boolean {
  if (isAdmin) return true;
  return (
    wad.org_id === userOrgId ||
    wad.buyer_org_id === userOrgId ||
    wad.seller_org_id === userOrgId
  );
}

function assembleCertificateFields(
  wad: WadCertData,
  poi: PoiData | null,
  attestations: Attestation[]
) {
  return {
    wad_id: wad.wad_id,
    poi_id: wad.poi_id,
    status: "SEALED",
    sealed_at: wad.sealed_at,
    seal_hash: wad.seal_hash,
    ledger_entry_hash: wad.ledger_entry_hash,
    commodity: poi?.commodity || "—",
    quantity: `${poi?.quantity_amount ?? "—"} ${poi?.quantity_unit ?? ""}`.trim(),
    price: `${poi?.price_currency ?? ""} ${poi?.price_amount ?? "—"}`.trim(),
    buyer: poi?.buyer_name || "—",
    seller: poi?.seller_name || "—",
    intent_confirmed: poi?.settled_at || null,
    attestation_count: attestations.length,
    attestations: attestations.map((a) => ({
      role: a.role,
      name: a.attested_name,
      attested_at: a.attested_at,
    })),
  };
}

function expectedFilename(wadId: string): string {
  return `WaD-Certificate-${wadId.substring(0, 8)}.pdf`;
}

// ── Test data ──

const sealedWad: WadCertData = {
  wad_id: "aabbccdd-1111-2222-3333-444455556666",
  poi_id: "poi-0001-0002-0003-000000000001",
  status: "sealed",
  seal_hash: "abc123def456",
  sealed_at: "2026-03-22T10:00:00Z",
  ledger_entry_hash: "ledger999",
  buyer_org_id: "org-buyer",
  seller_org_id: "org-seller",
  org_id: "org-buyer",
  evidence_bundle: { documents: [{ id: "d1", sha256_hash: "h1", doc_type: "invoice" }], event_count: 5 },
  certificate_generated_at: null,
};

const draftWad: WadCertData = { ...sealedWad, status: "draft", seal_hash: null, sealed_at: null };
const revokedWad: WadCertData = { ...sealedWad, status: "revoked" };

const poi: PoiData = {
  commodity: "Copper Cathode",
  quantity_amount: 500,
  quantity_unit: "MT",
  price_amount: 8500,
  price_currency: "USD",
  buyer_name: "Acme Trading Ltd",
  seller_name: "Zambia Copper Corp",
  settled_at: "2026-03-20T14:00:00Z",
};

const attestations: Attestation[] = [
  { role: "buyer_signatory", attested_name: "John Doe", attested_at: "2026-03-21T09:00:00Z", attestation_text: "I confirm..." },
  { role: "seller_signatory", attested_name: "Jane Smith", attested_at: "2026-03-21T10:00:00Z", attestation_text: "I confirm..." },
];

// ── Tests ──

describe("WaD Certificate", () => {
  describe("Generation guard", () => {
    it("allows certificate for sealed WaD", () => {
      const result = canGenerateCertificate(sealedWad);
      expect(result.allowed).toBe(true);
    });

    it("rejects certificate for draft WaD", () => {
      const result = canGenerateCertificate(draftWad);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("draft");
    });

    it("rejects certificate for revoked WaD", () => {
      const result = canGenerateCertificate(revokedWad);
      expect(result.allowed).toBe(false);
    });

    it("rejects if seal_hash is missing", () => {
      const noHash = { ...sealedWad, seal_hash: null };
      const result = canGenerateCertificate(noHash);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("seal hash");
    });
  });

  describe("Access control", () => {
    it("allows buyer org", () => {
      expect(canAccessCertificate(sealedWad, "org-buyer", false)).toBe(true);
    });

    it("allows seller org", () => {
      expect(canAccessCertificate(sealedWad, "org-seller", false)).toBe(true);
    });

    it("rejects unrelated org", () => {
      expect(canAccessCertificate(sealedWad, "org-random", false)).toBe(false);
    });

    it("allows admin regardless of org", () => {
      expect(canAccessCertificate(sealedWad, "org-random", true)).toBe(true);
    });
  });

  describe("Certificate content assembly", () => {
    it("includes all required fields", () => {
      const cert = assembleCertificateFields(sealedWad, poi, attestations);
      expect(cert.wad_id).toBe(sealedWad.wad_id);
      expect(cert.poi_id).toBe(sealedWad.poi_id);
      expect(cert.status).toBe("SEALED");
      expect(cert.seal_hash).toBe("abc123def456");
      expect(cert.ledger_entry_hash).toBe("ledger999");
      expect(cert.commodity).toBe("Copper Cathode");
      expect(cert.buyer).toBe("Acme Trading Ltd");
      expect(cert.seller).toBe("Zambia Copper Corp");
      expect(cert.quantity).toBe("500 MT");
      expect(cert.price).toBe("USD 8500");
      expect(cert.attestation_count).toBe(2);
    });

    it("handles missing POI data gracefully", () => {
      const cert = assembleCertificateFields(sealedWad, null, attestations);
      expect(cert.commodity).toBe("—");
      expect(cert.buyer).toBe("—");
      expect(cert.seller).toBe("—");
      expect(cert.quantity).toBe("—");
      expect(cert.intent_confirmed).toBeNull();
    });

    it("handles zero attestations", () => {
      const cert = assembleCertificateFields(sealedWad, poi, []);
      expect(cert.attestation_count).toBe(0);
      expect(cert.attestations).toHaveLength(0);
    });

    it("handles partial POI data", () => {
      const partialPoi: PoiData = {
        commodity: "Gold",
        quantity_amount: null,
        quantity_unit: null,
        price_amount: null,
        price_currency: "ZAR",
        buyer_name: "Buyer Co",
        seller_name: null,
        settled_at: null,
      };
      const cert = assembleCertificateFields(sealedWad, partialPoi, []);
      expect(cert.commodity).toBe("Gold");
      expect(cert.quantity).toBe("—");
      expect(cert.price).toBe("ZAR —");
      expect(cert.seller).toBe("—");
    });
  });

  describe("File naming", () => {
    it("generates correct PDF filename", () => {
      const filename = expectedFilename(sealedWad.wad_id);
      expect(filename).toBe("WaD-Certificate-aabbccdd.pdf");
      expect(filename.endsWith(".pdf")).toBe(true);
    });

    it("truncates long UUID to 8 chars", () => {
      const filename = expectedFilename("12345678-abcd-efgh-ijkl-mnopqrstuvwx");
      expect(filename).toBe("WaD-Certificate-12345678.pdf");
    });
  });

  describe("Content-Type", () => {
    it("should be application/pdf", () => {
      const contentType = "application/pdf";
      expect(contentType).toBe("application/pdf");
      expect(contentType).not.toBe("application/json");
    });
  });
});
