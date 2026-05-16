/**
 * Batch F — External dependency resilience, AI guard, DLQ visibility and
 * bounce linkage. File-content tests confirming the required wiring is
 * present in shipped source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("Batch F — external dependency resilience", () => {
  // ── IDV / sanctions
  it("1. idv-verify uses fetchWithTimeout", () => {
    const s = read("supabase/functions/idv-verify/index.ts");
    expect(s).toMatch(/fetchWithTimeout\(/);
    expect(s).toMatch(/10_000|10000/);
  });
  it("2. idv provider failure writes idv.failed audit", () => {
    const s = read("supabase/functions/idv-verify/index.ts");
    expect(s).toMatch(/action:\s*["']idv\.failed["']/);
  });
  it("3. idv provider failure does not promote entity to verified", () => {
    const s = read("supabase/functions/idv-verify/index.ts");
    // entity status update to verified happens only on result.status === "verified"
    expect(s).toMatch(/if \(result\.status === "verified"\)\s*{[\s\S]*entities[\s\S]*verified/);
    expect(s).toMatch(/IdvProviderError/);
  });
  it("4. Dilisense uses fetchWithTimeout", () => {
    const s = read("supabase/functions/dilisense-screen/index.ts");
    expect(s).toMatch(/fetchWithTimeout\(/);
  });
  it("5. Dilisense malformed response writes provider_error", () => {
    const s = read("supabase/functions/dilisense-screen/index.ts");
    expect(s).toMatch(/ScreeningProviderError|provider_error/);
    expect(s).toMatch(/DilisenseResponseSchema/);
  });
  it("6. Dilisense provider_error persists to screening_results", () => {
    const s = read("supabase/functions/dilisense-screen/index.ts");
    expect(s).toMatch(/screening_results/);
    expect(s).toMatch(/provider_error/);
  });

  // ── AI guard wiring
  it("7. counterparty-intel-auto uses guardedAiCall", () => {
    const s = read("supabase/functions/counterparty-intel-auto/index.ts");
    expect(s).toMatch(/guardedAiCall\(/);
    expect(s).toMatch(/call_type:\s*["']counterparty_intel["']/);
  });
  it("8. intel-crawl uses aiGuardPrecheck", () => {
    const s = read("supabase/functions/intel-crawl/index.ts");
    expect(s).toMatch(/aiGuardPrecheck\(/);
    expect(s).toMatch(/call_type:\s*["']intel_crawl["']/);
  });
  it("9. web-search uses guardedAiCall", () => {
    const s = read("supabase/functions/web-search/index.ts");
    expect(s).toMatch(/guardedAiCall\(/);
    expect(s).toMatch(/call_type:\s*["']web_search["']/);
  });
  it("10. draft-poi uses guardedAiCall", () => {
    const s = read("supabase/functions/draft-poi/index.ts");
    expect(s).toMatch(/guardedAiCall\(/);
    expect(s).toMatch(/call_type:\s*["']draft_poi["']/);
  });
  it("11. AI guard stamps cooldown on 429 with Retry-After", () => {
    const s = read("supabase/functions/_shared/ai-guard.ts");
    expect(s).toMatch(/resp\.status === 429/);
    expect(s).toMatch(/parseRetryAfter/);
    expect(s).toMatch(/stampCooldown/);
  });
  it("12. AI cooldown gate prevents provider call", () => {
    const s = read("supabase/functions/_shared/ai-guard.ts");
    // cooldown check returns before fetchWithTimeout
    const idxRead = s.indexOf("readCooldown(admin, opts.org_id)");
    const idxFetch = s.indexOf("fetchWithTimeout(");
    expect(idxRead).toBeGreaterThan(0);
    expect(idxFetch).toBeGreaterThan(idxRead);
  });
  it("13. daily meter cap returns QUOTA_EXCEEDED envelope", () => {
    const s = read("supabase/functions/_shared/ai-guard.ts");
    expect(s).toMatch(/QUOTA_EXCEEDED/);
    expect(s).toMatch(/ai_meter_check_and_increment/);
    expect(s).toMatch(/quota_exceeded/);
  });
  it("14. AI admin health tile exists and is mounted in HQ", () => {
    expect(existsSync(join(root, "src/components/admin/AiQuotaHealth.tsx"))).toBe(true);
    const hq = read("src/pages/HQ.tsx");
    expect(hq).toMatch(/AiQuotaHealth/);
  });

  // ── DLQ visibility
  it("15. infra-alerts checks email DLQ depth", () => {
    const s = read("supabase/functions/infra-alerts/index.ts");
    expect(s).toMatch(/Email DLQ Depth/);
    expect(s).toMatch(/status['"]\s*,\s*["']dlq["']/);
  });
  it("16. infra-alerts uses a recent (1-hour) DLQ window", () => {
    const s = read("supabase/functions/infra-alerts/index.ts");
    expect(s).toMatch(/60 \* 60 \* 1000[\s\S]*email_send_log/);
  });
  it("17. EmailRetentionHealth/HealthBoard exists alongside DLQ surfacing", () => {
    expect(existsSync(join(root, "src/components/admin/EmailRetentionHealth.tsx"))).toBe(true);
    // DLQ surfacing is via infra-alerts + admin_audit_logs (audit row).
    const s = read("supabase/functions/infra-alerts/index.ts");
    expect(s).toMatch(/admin_audit_logs/);
  });

  // ── Bounce / suppression linkage
  it("18. suppression webhook upserts suppressed_emails", () => {
    const s = read("supabase/functions/handle-email-suppression/index.ts");
    expect(s).toMatch(/from\(['"]suppressed_emails['"]\)[\s\S]*\.upsert/);
  });
  it("19. suppression webhook appends bounced row to email_send_log", () => {
    const s = read("supabase/functions/handle-email-suppression/index.ts");
    expect(s).toMatch(/from\(['"]email_send_log['"]\)[\s\S]*\.insert/);
    expect(s).toMatch(/mapReasonToStatus/);
  });
  it("20. transactional sender blocks future sends to suppressed addresses", () => {
    // The send-transactional-email path checks suppressed_emails before send.
    const candidates = [
      "supabase/functions/send-transactional-email/index.ts",
      "supabase/functions/process-email-queue/index.ts",
    ];
    const matched = candidates.some(
      (p) => existsSync(join(root, p)) && /suppressed_emails/.test(read(p)),
    );
    expect(matched).toBe(true);
  });
  it("21. bounce linked to engagement writes engagement audit event", () => {
    const s = read("supabase/functions/handle-email-suppression/index.ts");
    expect(s).toMatch(/outreach-send-/);
    expect(s).toMatch(/engagement\.outreach_bounced/);
    expect(s).toMatch(/entity_type:\s*['"]poi_engagement['"]/);
  });
  it("22. linkage only fires on exact UUID-shaped match (no guessing)", () => {
    const s = read("supabase/functions/handle-email-suppression/index.ts");
    // explicit UUID regex anchor — not a loose includes()
    expect(s).toMatch(/\/\^outreach-send-\(\[0-9a-f\]\{8\}-/);
  });
  it("23. invalid suppression signature writes no DB row", () => {
    const s = read("supabase/functions/handle-email-suppression/index.ts");
    // signature failure returns 401 before any supabase.from(...) write
    const idxInvalid = s.indexOf("'invalid_signature'");
    const idxUpsert = s.indexOf(".upsert(");
    expect(idxInvalid).toBeGreaterThan(0);
    expect(idxUpsert).toBeGreaterThan(idxInvalid);
  });
  it("24. replayed suppression webhook is rejected via assertNotReplayed", () => {
    const s = read("supabase/functions/handle-email-suppression/index.ts");
    expect(s).toMatch(/assertNotReplayed/);
    expect(s).toMatch(/replayCheck\.ok/);
  });
});
