// Batch 8 — Registry record model, search index and working search tests.
import { describe, it, expect } from "vitest";
import {
  REGISTRY_RECORD_READINESS_STATES,
  PUBLIC_SEARCHABLE_FIELDS,
  ADMIN_ONLY_SEARCHABLE_FIELDS,
  FORBIDDEN_PUBLIC_FIELDS,
  REGISTRY_RECORD_AUDIT_EVENT_NAMES,
  IMPORTED_UNVERIFIED_NOTICE,
  normaliseSearchValue,
  normaliseLegalForm,
} from "@/lib/registry-record-model";

describe("batch 8 — registry record model SSOT", () => {
  it("defaults newly loaded records to imported_unverified", () => {
    expect(REGISTRY_RECORD_READINESS_STATES[0]).toBe("imported_unverified");
  });

  it("never categorises forbidden bank/contact fields as public-searchable", () => {
    for (const f of FORBIDDEN_PUBLIC_FIELDS) {
      expect(PUBLIC_SEARCHABLE_FIELDS).not.toContain(f as any);
    }
  });

  it("keeps personal email / phone / address admin-only", () => {
    for (const f of ["person_email", "person_phone", "person_address", "person_full_name"]) {
      expect(ADMIN_ONLY_SEARCHABLE_FIELDS).toContain(f as any);
      expect(PUBLIC_SEARCHABLE_FIELDS).not.toContain(f as any);
    }
  });

  it("registers every required audit event name", () => {
    for (const e of [
      "registry_company_record_created",
      "registry_company_record_indexed",
      "registry_company_search_index_rebuilt",
      "registry_company_public_search_performed",
      "registry_company_admin_search_performed",
      "registry_company_public_profile_viewed",
      "registry_company_sensitive_match_suppressed",
      "registry_company_claim_availability_checked",
      "registry_company_no_result_new_request_prompted",
    ]) {
      expect(REGISTRY_RECORD_AUDIT_EVENT_NAMES).toContain(e as any);
    }
  });

  it("normalises search values case- and punctuation-insensitively", () => {
    expect(normaliseSearchValue("Acme-Trading, Ltd.")).toBe("acmetradingltd");
    expect(normaliseSearchValue("RC-1572044")).toBe("rc1572044");
  });

  it("normalises legal-form variants Ltd / Pty / CC / PLC", () => {
    expect(normaliseLegalForm("Ltd")).toBe("limited");
    expect(normaliseLegalForm("Limited")).toBe("limited");
    expect(normaliseLegalForm("Pty Ltd")).toBe("ptyltd");
    expect(normaliseLegalForm("(Pty) Limited")).toBe("ptyltd");
    expect(normaliseLegalForm("Close Corporation")).toBe("cc");
    expect(normaliseLegalForm("CC")).toBe("cc");
    expect(normaliseLegalForm("PLC")).toBe("plc");
  });

  it("ships the imported_unverified disclaimer copy", () => {
    expect(IMPORTED_UNVERIFIED_NOTICE).toMatch(/Not\s+independently\s+verified\s+by\s+Izenzo/);
  });
});
