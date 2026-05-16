/**
 * Batch T — UI Truthfulness, Dashboards and Reporting Accuracy
 * ────────────────────────────────────────────────────────────────
 * Static guard tests that ride on the source code itself rather than
 * a running browser. They lock in the contracts established in Batch T:
 *
 *   UI-010  dashboard counters exclude demo/test rows
 *   UI-012  freshness chips + manual refresh present on admin panels
 *   UI-013  status badge can surface TEST-MODE / PROVIDER-ERROR qualifiers
 *   UI-014  HealthBoard uses an explicit OPEN_RISK_STATUSES allow-list and
 *           surfaces query errors instead of silently returning 0
 *   AUD-017 sensitive CSV exports route through auditedDownloadCSV (no raw
 *           downloadCSV) and never bypass the audit/AAL2 gate
 *
 * These tests intentionally read source files from disk so refactors that
 * silently regress the contract fail in CI.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("Batch T — UI truthfulness static guards", () => {
  // ── AUD-017 ────────────────────────────────────────────────────────────
  describe("AUD-017 — sensitive CSV exports are audited", () => {
    const SENSITIVE_EXPORTERS = [
      "src/components/MatchesList.tsx",
      "src/components/admin/AdminRevenuePanel.tsx",
      "src/components/admin/UsersManagement.tsx",
      "src/components/admin/AdminPendingEngagementsPanel.tsx",
      "src/components/match/EvidencePackPanel.tsx",
    ];

    it.each(SENSITIVE_EXPORTERS)(
      "%s imports auditedDownloadCSV and does not import the raw downloadCSV helper",
      (file) => {
        const src = read(file);
        expect(src).toMatch(/auditedDownloadCSV(Raw)?/);
        // The raw import must not appear — `downloadCSV` on its own would
        // bypass the audit + AAL2 gate.
        const importLine = src
          .split("\n")
          .find((l) => l.includes("from \"@/lib/download-utils\""));
        expect(importLine, `${file} must import from download-utils`).toBeDefined();
        expect(importLine!).not.toMatch(/\bdownloadCSV\b/);
      },
    );

    it("auditedDownloadCSV writes the audit row BEFORE the file is downloaded", () => {
      const src = read("src/lib/download-utils.ts");
      const fnStart = src.indexOf("export async function auditedDownloadCSV");
      expect(fnStart).toBeGreaterThan(-1);
      const body = src.slice(fnStart, fnStart + 2000);
      const auditIdx = body.indexOf("recordExportAudit");
      const downloadIdx = body.indexOf("downloadFile(");
      expect(auditIdx).toBeGreaterThan(-1);
      expect(downloadIdx).toBeGreaterThan(-1);
      expect(auditIdx).toBeLessThan(downloadIdx);
    });

    it("auditedDownloadCSV blocks the download when aal_required is true", () => {
      const src = read("src/lib/download-utils.ts");
      expect(src).toMatch(/options\.sensitive\s*&&\s*audit\.aal_required/);
    });

    it("buildExportPreamble emits generated_at / report / filters", () => {
      const src = read("src/lib/download-utils.ts");
      expect(src).toMatch(/# generated_at:/);
      expect(src).toMatch(/# report:/);
      expect(src).toMatch(/# filters:/);
    });
  });

  // ── UI-010 ─────────────────────────────────────────────────────────────
  describe("UI-010 — demo/test rows are excluded from counters", () => {
    it("DealPipeline excludes is_demo=true from both pipeline queries", () => {
      const src = read("src/components/desk/DealPipeline.tsx");
      const occurrences = src.match(/\.eq\("is_demo",\s*false\)/g) ?? [];
      // Active lane + sealed lane.
      expect(occurrences.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── UI-012 ─────────────────────────────────────────────────────────────
  describe("UI-012 — admin panels expose freshness + manual refresh", () => {
    const REFRESHABLE_PANELS = [
      "src/components/admin/AdminRevenuePanel.tsx",
      "src/components/admin/AdminRiskAlarmsPanel.tsx",
      "src/components/admin/AdminVerificationQueuePanel.tsx",
    ];
    it.each(REFRESHABLE_PANELS)(
      "%s shows dataUpdatedAt and provides a manual refetch button",
      (file) => {
        const src = read(file);
        expect(src).toMatch(/dataUpdatedAt/);
        expect(src).toMatch(/refetch\(\)/);
      },
    );
  });

  // ── UI-013 ─────────────────────────────────────────────────────────────
  describe("UI-013 — status badge surfaces test-mode / provider-error qualifiers", () => {
    it("MatchStatusBadge accepts and renders both qualifiers", () => {
      const src = read("src/components/ui/match-status-badge.tsx");
      expect(src).toMatch(/testMode\?\:\s*boolean/);
      expect(src).toMatch(/providerError\?\:\s*boolean/);
      expect(src).toMatch(/status-badge-test-mode/);
      expect(src).toMatch(/status-badge-provider-error/);
    });

    it("MatchesList derives qualifiers from row metadata", () => {
      const src = read("src/components/MatchesList.tsx");
      expect(src).toMatch(/test_mode_bypass/);
      expect(src).toMatch(/provider_status/);
      expect(src).toMatch(/testMode=\{testMode\}/);
    });
  });

  // ── UI-014 ─────────────────────────────────────────────────────────────
  describe("UI-014 — HealthBoard hardening", () => {
    const HB = read("src/components/governance/HealthBoard.tsx");

    it("uses an explicit OPEN_RISK_STATUSES allow-list", () => {
      expect(HB).toMatch(/OPEN_RISK_STATUSES/);
      // The old "!== 'resolved'" pattern is replaced everywhere it gated
      // the open-incident count.
      const openCountLine = HB.match(/const openIncidents\s*=\s*[^\n]+/);
      expect(openCountLine).not.toBeNull();
      expect(openCountLine![0]).not.toMatch(/!==\s*"resolved"/);
    });

    it("surfaces no-recipient query errors instead of falling back to 0", () => {
      // The query handler must throw rather than swallow the error.
      expect(HB).toMatch(/if \(error\) throw error;[\s\S]{0,200}return count \?\? 0;/);
      // And the tile must render an error state when isError fires.
      expect(HB).toMatch(/noRecipientError/);
      expect(HB).toMatch(/healthboard-no-recipient-error/);
    });
  });
});
