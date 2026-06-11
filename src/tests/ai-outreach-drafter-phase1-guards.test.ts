/**
 * AI Outreach Drafter — Phase 1 static guards
 *
 * Proves at build/test time that the Phase 1 drafter cannot send anything
 * automatically and that the admin UI never renders a Send button.
 *
 * Covers the closeout checklist:
 *   • draft generation, regenerate, edit, approve, reject never call any
 *     dispatch surface (notification-dispatch, send-transactional-email,
 *     Resend, SMTP, Mailgun, Slack, functions.invoke(...email...));
 *   • the admin panel does not render a Send button;
 *   • approved drafts display the manual-send notice;
 *   • all Phase 1 audit action names are present in the edge functions;
 *   • no Phase 2 / send-related audit names have leaked in.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(p: string): string {
  return readFileSync(resolve(process.cwd(), p), "utf8");
}

const FORBIDDEN_DISPATCH = [
  "notification-dispatch",
  "send-transactional-email",
  "resend",
  "smtp",
  "mailgun",
  "mail.send",
];

const PHASE1_AUDIT_NAMES = [
  "engagement.outreach_draft.requested",
  "engagement.outreach_draft.generated",
  "engagement.outreach_draft.regenerated",
  "engagement.outreach_draft.edited",
  "engagement.outreach_draft.approved",
  "engagement.outreach_draft.rejected",
  "engagement.outreach_draft.access_denied",
];

const PHASE2_FORBIDDEN_AUDITS = [
  "engagement.outreach_draft.sent",
  "engagement.outreach_draft.send_requested",
  "engagement.outreach_draft.send_failed",
];

const FILES = {
  generator: "supabase/functions/generate-engagement-outreach-draft/index.ts",
  decision: "supabase/functions/engagement-outreach-draft-decision/index.ts",
  hook: "src/hooks/useEngagementOutreachDraft.ts",
  panel: "src/components/admin/EngagementOutreachDraftPanel.tsx",
};

describe("AI Outreach Drafter — Phase 1 dispatch isolation", () => {
  for (const [name, path] of Object.entries(FILES)) {
    it(`${name} contains no dispatch references`, () => {
      const src = read(path).toLowerCase();
      for (const term of FORBIDDEN_DISPATCH) {
        expect(src.includes(term), `Found '${term}' in ${path}`).toBe(false);
      }
    });

    it(`${name} never invokes an email-shaped edge function`, () => {
      const src = read(path);
      expect(/functions\.invoke\(\s*["'`][^"'`]*email[^"'`]*["'`]/i.test(src)).toBe(false);
    });
  }
});

describe("AI Outreach Drafter — Phase 1 audit vocabulary", () => {
  const combined = read(FILES.generator) + "\n" + read(FILES.decision);

  for (const audit of PHASE1_AUDIT_NAMES) {
    it(`emits canonical audit ${audit}`, () => {
      expect(combined).toContain(audit);
    });
  }

  for (const audit of PHASE2_FORBIDDEN_AUDITS) {
    it(`does NOT emit Phase-2 audit ${audit}`, () => {
      expect(combined.includes(audit)).toBe(false);
    });
  }
});

describe("AI Outreach Drafter — admin UI manual-send contract", () => {
  const panel = read(FILES.panel);

  it("panel does not render a Send button", () => {
    expect(/>\s*Send\s*<\//i.test(panel)).toBe(false);
    expect(/data-testid=["']send/.test(panel)).toBe(false);
  });

  it("panel shows the manual-send notice for approved drafts", () => {
    expect(panel).toContain("Approved — manual send required. No automated dispatch is wired.");
    expect(panel).toContain("manual-send-notice");
  });

  it("panel renders an Admin only badge", () => {
    expect(panel).toContain("Admin only");
  });

  it("hook only calls the two Phase 1 edge functions", () => {
    const hook = read(FILES.hook);
    expect(hook).toContain("generate-engagement-outreach-draft");
    expect(hook).toContain("engagement-outreach-draft-decision");
    // No other functions.invoke targets in the hook
    const re = /functions\.invoke\(\s*["'`]([^"'`]+)["'`]/g;
    const targets: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(hook)) !== null) targets.push(m[1]);
    expect(targets.sort()).toEqual(
      ["engagement-outreach-draft-decision", "generate-engagement-outreach-draft"].sort(),
    );
  });
});

describe("AI Outreach Drafter — server hard gates", () => {
  const generator = read(FILES.generator);
  const decision = read(FILES.decision);

  it("generator enforces is_admin and frozen-org checks", () => {
    expect(generator).toContain('rpc("is_admin"');
    expect(generator).toContain("frozen");
    expect(generator).toContain("org_restricted");
  });

  it("decision endpoint enforces is_admin and 409 on illegal transitions", () => {
    expect(decision).toContain('rpc("is_admin"');
    expect(decision).toContain("ILLEGAL_TRANSITION");
    expect(decision).toContain("409");
  });

  it("decision endpoint exposes no 'send' action", () => {
    expect(/['"]send['"]\s*[:,)\]]/.test(decision)).toBe(false);
  });

  it("generator inserts drafts as pending_review and never as sent", () => {
    expect(generator).toContain('"pending_review"');
    expect(/status:\s*["']sent["']/.test(generator)).toBe(false);
  });
});
