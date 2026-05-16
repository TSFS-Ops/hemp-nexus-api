/**
 * Batch F UI surfacing — AdminEntitiesPanel + AdminPendingEngagementsPanel.
 *
 * File-content tests confirming the required IDV / sanctions provider-error
 * and engagement bounce/complaint audit signals are queried and rendered.
 * These complement (and do not replace) the 24 tests in
 * batch-f-external-resilience.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Batch F UI — AdminEntitiesPanel provider-error surfacing", () => {
  const src = read("src/components/admin/AdminEntitiesPanel.tsx");

  it("1. queries audit_logs for idv.failed against visible entity ids", () => {
    expect(src).toMatch(/from\(["']audit_logs["']\)[\s\S]*\.eq\(["']action["'],\s*["']idv\.failed["']\)/);
    expect(src).toMatch(/\.eq\(["']entity_type["'],\s*["']entity["']\)[\s\S]*\.in\(["']entity_id["']/);
  });

  it("2. queries screening_results for status='provider_error'", () => {
    expect(src).toMatch(/from\(["']screening_results["']\)[\s\S]*\.eq\(["']status["'],\s*["']provider_error["']\)/);
  });

  it("3. renders ProviderErrorBadges alongside StatusBadge (not as verified)", () => {
    expect(src).toMatch(/<ProviderErrorBadges errors=\{providerErrors\[entity\.id\]\}/);
    // Both mobile + desktop rows surface the badge group.
    const occurrences = src.match(/<ProviderErrorBadges/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("4. badge label distinguishes IDV vs Screening provider error", () => {
    expect(src).toMatch(/IDV provider error/);
    expect(src).toMatch(/Screening provider error/);
  });

  it("5. provider error rendered with review/pending visual treatment (amber, not emerald/verified)", () => {
    // Scope check to the ProviderErrorBadges component body only.
    const start = src.indexOf("function ProviderErrorBadges");
    const end = src.indexOf("export function AdminEntitiesPanel");
    const badgeBlock = src.slice(start, end);
    expect(badgeBlock).toMatch(/bg-amber-50/);
    expect(badgeBlock).not.toMatch(/emerald/i);
    expect(badgeBlock).not.toMatch(/status:\s*["']verified["']/i);
  });

  it("6. badge surfaces provider / status code / reason / timestamp in title", () => {
    expect(src).toMatch(/provider=\$\{e\.provider\}/);
    expect(src).toMatch(/status=\$\{e\.status_code\}/);
    expect(src).toMatch(/reason=\$\{e\.reason\}/);
    expect(src).toMatch(/at \$\{ts\}/);
  });
});

describe("Batch F UI — AdminPendingEngagementsPanel bounce/complaint surfacing", () => {
  const src = read("src/components/admin/AdminPendingEngagementsPanel.tsx");

  it("7. queries audit_logs for engagement.outreach_bounced / _complained", () => {
    expect(src).toMatch(/from\(["']audit_logs["']\)/);
    expect(src).toMatch(/\.eq\(["']entity_type["'],\s*["']poi_engagement["']\)/);
    expect(src).toMatch(/engagement\.outreach_bounced/);
    expect(src).toMatch(/engagement\.outreach_complained/);
  });

  it("8. restricts the audit query to currently visible engagement ids (no inference)", () => {
    // The visibleIdList passed to .in('entity_id', …) is derived from
    // engagements, ensuring strict UUID-linked surfacing only.
    expect(src).toMatch(/const visibleIdList = Array\.from\(visibleIds\)/);
    expect(src).toMatch(/\.in\(["']entity_id["'],\s*visibleIdList\)/);
    // Defence-in-depth: results are also gated by visibleIds.has(eid).
    expect(src).toMatch(/if \(!eid \|\| !visibleIds\.has\(eid\)\) continue;/);
  });

  it("9. renders Bounced badge with suppression wording when audit row is linked", () => {
    expect(src).toMatch(/data-bounce-audit=\{a\.kind\}/);
    expect(src).toMatch(/data-engagement-id=\{e\.id\}/);
    expect(src).toMatch(/Bounced|Complaint/);
    expect(src).toMatch(/suppressed/);
  });

  it("10. badge only renders when bounceAudit\\[e.id\\] is present (no false positives)", () => {
    expect(src).toMatch(/const a = bounceAudit\[e\.id\];\s*\n\s*if \(!a\) return null;/);
  });

  it("11. existing email_send_log delivery enrichment is preserved", () => {
    expect(src).toMatch(/deriveDeliveryMap\(/);
    expect(src).toMatch(/from\(["']email_send_log["']\)/);
  });
});
