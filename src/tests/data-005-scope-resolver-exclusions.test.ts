/**
 * DATA-005 Phase 1 — resolveExportScope MUST strip every forbidden
 * category, regardless of whether it was requested explicitly.
 */
import { describe, it, expect } from "vitest";
import {
  resolveExportScope,
  FORBIDDEN_USER_EXPORT_CATEGORIES,
  ALLOWED_USER_EXPORT_CATEGORIES,
} from "@/lib/user-export-categories";

describe("DATA-005 — scope resolver exclusions", () => {
  it("strips every individually-named forbidden category", () => {
    for (const f of FORBIDDEN_USER_EXPORT_CATEGORIES) {
      const out = resolveExportScope("user-1", [], [f]);
      expect(out.resolved).toEqual([]);
      expect(out.stripped).toContain(f);
      expect(out.empty).toBe(true);
    }
  });

  it("strips passwords / API keys / tokens / payment cards / admin notes / legal notes / raw audit logs / cross-user PII / unrelated org data even if requested next to a legitimate category", () => {
    const out = resolveExportScope("user-1", ["org-1"], [
      "profile",
      "passwords",
      "password_hashes",
      "api_keys",
      "webhook_secrets",
      "auth_tokens",
      "session_tokens",
      "reset_tokens",
      "payment_card_data",
      "admin_notes",
      "privileged_legal_notes",
      "raw_audit_logs",
      "other_users_personal_data",
      "unrelated_org_data",
    ]);
    expect(out.resolved).toEqual(["profile"]);
    expect(out.empty).toBe(false);
    for (const f of FORBIDDEN_USER_EXPORT_CATEGORIES) {
      expect(out.stripped).toContain(f);
    }
  });

  it("returns empty when only unknown or forbidden categories are requested", () => {
    const out = resolveExportScope("user-1", [], ["unknown_cat", "passwords"]);
    expect(out.resolved).toEqual([]);
    expect(out.empty).toBe(true);
  });

  it("returns the full allowed set when every allowed category is requested", () => {
    const out = resolveExportScope(
      "user-1",
      ["org-1"],
      [...ALLOWED_USER_EXPORT_CATEGORIES],
    );
    expect(out.resolved.sort()).toEqual([...ALLOWED_USER_EXPORT_CATEGORIES].sort());
    expect(out.stripped).toEqual([]);
    expect(out.empty).toBe(false);
  });

  it("deduplicates repeated requested categories", () => {
    const out = resolveExportScope("user-1", [], [
      "profile",
      "profile",
      "my_matches",
      "my_matches",
    ]);
    expect(out.resolved).toEqual(["profile", "my_matches"]);
  });

  it("returns empty when userId is missing (defensive — caller is unauthenticated)", () => {
    const out = resolveExportScope("", [], ["profile"]);
    expect(out.empty).toBe(true);
    expect(out.resolved).toEqual([]);
  });
});
