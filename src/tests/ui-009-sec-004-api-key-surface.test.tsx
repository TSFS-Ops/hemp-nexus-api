/**
 * UI-009 / SEC-004 — Developer API key contract & leak-response surface.
 *
 * Source-pinned assertions over the docs, developer surfaces, and the
 * api-keys edge function. We verify:
 *   - public docs render the canonical X-API-Key header + sk_live_/sk_test_ prefix
 *   - no stale Bearer / api_key= query-param examples in any docs page
 *   - QuickStart no longer ships the stale X-Org-Id header
 *   - the masked key display in ApiKeysPanel uses the real contract prefix
 *   - the one-time reveal modal exposes plaintext only inside its own component
 *   - revoke + rotate affordances are visible on every key card
 *   - the api-keys edge function writes the full create/rotate/rename/revoke
 *     audit-event set, and AdminAuditLogs surfaces them in its action filter
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const root = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const DOC_FILES = [
  "src/pages/docs/Authentication.tsx",
  "src/pages/docs/Quickstart.tsx",
  "src/pages/docs/ApiReference.tsx",
  "src/pages/docs/Counterparties.tsx",
  "src/pages/docs/Matches.tsx",
  "src/pages/docs/Evidence.tsx",
  "src/pages/docs/Webhooks.tsx",
  "src/pages/docs/Errors.tsx",
  "src/components/developer/QuickStart.tsx",
  "src/components/developer/IntegrationDocs.tsx",
  "src/components/developer/IntegrationGuidePdf.ts",
  "src/components/developer/PlainEnglishWalkthrough.tsx",
];

describe("UI-009 / SEC-004 — public docs ↔ app contract", () => {
  it("every public doc / developer surface that shows auth uses the canonical X-API-Key header", () => {
    // Errors.tsx is an error-code reference page and intentionally does not show auth.
    const authDocs = DOC_FILES.filter((f) => !/Errors\.tsx$/.test(f));
    for (const f of authDocs) {
      const src = read(f);
      expect(src, `${f} must mention X-API-Key`).toMatch(/X-API-Key/);
    }
  });

  it("docs use the canonical sk_live_ / sk_test_ prefix scheme", () => {
    const seen = DOC_FILES.map(read).join("\n");
    expect(seen).toMatch(/sk_live_/);
    expect(seen).toMatch(/sk_test_/);
  });

  it("docs never advertise Bearer-token or api_key= query-param auth", () => {
    for (const f of DOC_FILES) {
      const src = read(f);
      // Disallow `Bearer sk_…` and `?api_key=` / `&api_key=` examples.
      expect(src, `${f} must not show Bearer sk_ example`).not.toMatch(/Bearer\s+sk_/);
      expect(src, `${f} must not show api_key= query param`).not.toMatch(/[?&]api_key=/);
      expect(src, `${f} must not show apikey= query param`).not.toMatch(/[?&]apikey=/);
    }
  });

  it("QuickStart no longer ships the stale X-Org-Id companion header", () => {
    const src = read("src/components/developer/QuickStart.tsx");
    expect(src).not.toMatch(/X-Org-Id/);
  });
});

describe("UI-009 / SEC-004 — key display hygiene", () => {
  const panel = read("src/components/developer/ApiKeysPanel.tsx");

  it("masked key display uses sk_live_ / sk_test_ — not a stale iz_ prefix", () => {
    expect(panel).toMatch(/sk_\$\{env\}_/);
    expect(panel).not.toMatch(/iz_live_/);
  });

  it("plaintext key is only rendered inside the one-time RevealModal", () => {
    // Outside RevealModal, the KeyCard renders only the masked display.
    const card = panel.split("function KeyCard")[1] ?? "";
    expect(card).toContain("{masked}");
    expect(card).not.toMatch(/\{data\.key\}/);
    expect(card).not.toMatch(/\{row\.key\}/);
  });

  it("RevealModal offers copy, explicit acknowledgement, and a close affordance", () => {
    const modal = panel.split("function RevealModal")[1]?.split("function ConfirmDialog")[0] ?? "";
    expect(modal).toMatch(/clipboard\.writeText/);
    expect(modal).toMatch(/I&apos;ve saved it|I've saved it/);
    expect(modal).toMatch(/aria-label="Close"/);
  });

  it("revealed plaintext is cleared from panel state on dismiss", () => {
    // setRevealed(null) is the dismissal path (see onClose handlers).
    expect(panel).toMatch(/setRevealed\(null\)/);
  });
});

describe("UI-009 / SEC-004 — leak response affordances", () => {
  const panel = read("src/components/developer/ApiKeysPanel.tsx");

  it("every key card exposes a visible Revoke action", () => {
    const card = panel.split("function KeyCard")[1] ?? "";
    expect(card).toMatch(/onRevoke/);
    expect(card).toMatch(/>\s*Revoke\s*</);
  });

  it("every key card exposes a visible Rotate action", () => {
    const card = panel.split("function KeyCard")[1] ?? "";
    expect(card).toMatch(/onRotate/);
    expect(card).toMatch(/>\s*Rotate\s*</);
  });

  it("revoke action wires to the api-keys DELETE endpoint", () => {
    expect(panel).toMatch(/revokeMut[\s\S]{0,200}callKeysFn\("DELETE"/);
  });

  it("rotate action wires to the api-keys /rotate endpoint", () => {
    expect(panel).toMatch(/rotateMut[\s\S]{0,200}callKeysFn[\s\S]{0,80}\/rotate/);
  });
});

describe("UI-009 / SEC-004 — audit surface", () => {
  const edge = read("supabase/functions/api-keys/index.ts");

  it("api-keys edge function audits the full key lifecycle", () => {
    expect(edge).toMatch(/'api_key\.created'/);
    expect(edge).toMatch(/'api_key\.rotated'/);
    expect(edge).toMatch(/'api_key\.renamed'/);
    expect(edge).toMatch(/'api_key\.revoked'/);
  });

  it("AdminAuditLogs action filter is dynamic, so api_key.* events surface naturally", () => {
    const audit = read("src/components/admin/AdminAuditLogs.tsx");
    expect(audit).toMatch(/uniqueActions/);
    expect(audit).toMatch(/actionFilter/);
    // Visual treatment for at least the most security-critical events.
    expect(audit).toMatch(/api_key\.created/);
    expect(audit).toMatch(/api_key\.revoked/);
  });
});
