/**
 * role-negative-manual-outreach-batch3-deeplinks.test.tsx
 *
 * Source-pin coverage for the Batch 3 manual outreach logging UX:
 *  - ManualOutreachLogDialog is only imported by AdminPendingEngagementsPanel
 *  - The dialog talks to the existing poi-engagements PATCH endpoint only
 *  - poi-engagements admin/outreach PATCH paths remain platform-admin gated
 *
 * No product code is modified.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const ALL_SRC = walk(SRC);
const DIALOG_SRC = readFileSync(
  join(process.cwd(), "src/components/admin/ManualOutreachLogDialog.tsx"),
  "utf8",
);
const POI_ENG_SRC = readFileSync(
  join(process.cwd(), "supabase/functions/poi-engagements/index.ts"),
  "utf8",
);

describe("ManualOutreachLogDialog — Batch 3 containment (role-negative)", () => {
  it("ManualOutreachLogDialog is only imported by AdminPendingEngagementsPanel", () => {
    const re = /import[\s\S]*?\bManualOutreachLogDialog\b[\s\S]*?from\s+["'][^"']*ManualOutreachLogDialog[^"']*["']/m;
    const importers = ALL_SRC.filter((f) => {
      if (f.endsWith("ManualOutreachLogDialog.tsx")) return false;
      if (/[\\/]tests[\\/]|\.test\.|\.spec\./.test(f)) return false;
      return re.test(readFileSync(f, "utf8"));
    });
    expect(importers.length).toBe(1);
    expect(importers[0]).toMatch(/AdminPendingEngagementsPanel\.tsx$/);
  });

  it("dialog only invokes the poi-engagements PATCH path", () => {
    // Must reference poi-engagements with PATCH method
    expect(DIALOG_SRC).toMatch(/poi-engagements\/\$\{[^}]+\}/);
    expect(DIALOG_SRC).toMatch(/method:\s*["']PATCH["']/);

    // Must NOT invoke any send/dispatch-style edge functions or AI drafter endpoints
    const forbidden = [
      "generate-engagement-outreach-draft",
      "engagement-outreach-draft-decision",
      "notification-dispatch",
      "send-transactional-email",
      "process-email-queue",
      "engagement-reminder",
      "send-team-invite",
      "resend",
      "sendgrid",
      "twilio",
      "smtp",
    ];
    for (const tok of forbidden) {
      // Allow tokens to appear inside "does not send"-style comment notices.
      // We grep for any LINE that contains the token but is not a comment line.
      const lines = DIALOG_SRC.split("\n");
      const codeHits = lines.filter((ln) => {
        const trimmed = ln.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
          return false;
        }
        return new RegExp(`\\b${tok}\\b`, "i").test(ln);
      });
      expect(codeHits, `dispatch token "${tok}" found in dialog code (not comments)`).toEqual([]);
    }
  });

  it("poi-engagements PATCH/admin handlers remain guarded by requireRole(platform_admin)", () => {
    // At least the documented admin/outreach/facilitation entry points.
    const guardLines = (POI_ENG_SRC.match(/requireRole\(authCtx,\s*["']platform_admin["']\)/g) ?? []);
    expect(guardLines.length).toBeGreaterThanOrEqual(4);
  });

  it("poi-engagements file still imports requireRole from the shared auth module", () => {
    expect(POI_ENG_SRC).toMatch(
      /import[\s\S]*?\brequireRole\b[\s\S]*?from\s+["']\.\.\/_shared\/auth\.ts["']/m,
    );
  });

  it("dialog success copy is non-dispatching", () => {
    // We don't enforce exact strings, but the dialog must not surface 'sent' phrasing.
    expect(DIALOG_SRC).not.toMatch(/\bMessage sent\b/i);
    expect(DIALOG_SRC).not.toMatch(/\bEmail sent\b/i);
    expect(DIALOG_SRC).not.toMatch(/\bSMS sent\b/i);
  });
});
