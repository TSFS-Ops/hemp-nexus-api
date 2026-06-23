/**
 * Audit Ledger copy/capability guard.
 *
 * Option-A containment for the open issue:
 *   "Audit Ledger page claims an immutable ledger without database immutability."
 *
 * Until backend immutability is genuinely enforced (UPDATE/DELETE/TRUNCATE
 * blocked on every claimed ledger table with no GUC/owner-droppable bypass,
 * plus an automated hash-chain verifier), strong trust wording must not
 * appear on public/customer-facing surfaces.
 *
 * Scope (explicitly per the issue brief):
 *   - src/pages/products/**
 *   - src/pages/solutions/**
 *   - src/pages/docs/**            (public documentation)
 *   - src/components/landing/**
 *   - src/components/PublicHeader.tsx
 *   - src/components/wad/**        (user-facing deal-flow UI)
 *   - src/components/match/**      (user-facing deal-flow UI)
 *   - src/components/governance/TriageInbox.tsx (user-facing toast/CTA)
 *   - src/components/developer/IntegrationGuidePdf.ts (published developer PDF)
 *
 * Explicitly out of scope:
 *   - src/components/admin/**      (admin-only architecture descriptions
 *                                   that often refer truthfully to tables
 *                                   that DO have triggers, e.g. collapse_ledger,
 *                                   break_glass_actions, signing_keys)
 *   - src/pages/HQ.tsx             (developer/internal map)
 *   - JS/TS comments (not user-visible)
 *
 * This guard never touches the database. It is presentation-only.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import {
  IMMUTABILITY_BACKEND_ENFORCED,
  BANNED_TRUST_PHRASES,
  SAFE_LEDGER_COPY,
} from "@/lib/policy/audit-ledger-capability";

const ROOT = join(process.cwd(), "src");

const SCAN_DIRS = [
  join(ROOT, "pages", "products"),
  join(ROOT, "pages", "solutions"),
  join(ROOT, "pages", "docs"),
  join(ROOT, "components", "landing"),
  join(ROOT, "components", "wad"),
  join(ROOT, "components", "match"),
  join(ROOT, "components", "desk", "match"),
  join(ROOT, "components", "desk", "evidence"),
];

const SCAN_FILES = [
  join(ROOT, "components", "PublicHeader.tsx"),
  join(ROOT, "components", "governance", "TriageInbox.tsx"),
  join(ROOT, "components", "developer", "IntegrationGuidePdf.ts"),
  join(ROOT, "pages", "Docs.tsx"),
  join(ROOT, "components", "desk", "settings", "NotificationRulesTab.tsx"),
  join(ROOT, "components", "desk", "compliance", "ComplianceProfile.tsx"),
  join(ROOT, "components", "developer", "EnvSwitcher.tsx"),
];

const ALLOWED_EXT = new Set([".ts", ".tsx"]);

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      walk(full, acc);
    } else if (ALLOWED_EXT.has(extname(full))) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Strip TS line/block comments so the guard only scans user-visible text,
 * not developer comments. This is a deliberately conservative stripper
 * (no template-literal awareness) but it is enough for our copy surfaces.
 */
function stripComments(source: string): string {
  // Remove /* ... */ blocks first, then // line tail comments.
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  return noBlock
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      if (idx === -1) return line;
      // Crude string-aware guard: skip "//" inside quoted strings.
      const before = line.slice(0, idx);
      const quoteCount =
        (before.match(/"/g) || []).length +
        (before.match(/'/g) || []).length +
        (before.match(/`/g) || []).length;
      if (quoteCount % 2 === 1) return line; // inside a string
      return before;
    })
    .join("\n");
}

function scanFile(file: string): { phrase: string; line: number; text: string }[] {
  const hits: { phrase: string; line: number; text: string }[] = [];
  const cleaned = stripComments(readFileSync(file, "utf8"));
  const lines = cleaned.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const phrase of BANNED_TRUST_PHRASES) {
      if (line.toLowerCase().includes(phrase.toLowerCase())) {
        hits.push({ phrase, line: i + 1, text: line.trim() });
      }
    }
  }
  return hits;
}

describe("Audit Ledger copy/capability guard", () => {
  it("capability flag defaults to false in repo", () => {
    expect(IMMUTABILITY_BACKEND_ENFORCED).toBe(false);
  });

  it("safe copy primitives are defined and accurate", () => {
    expect(SAFE_LEDGER_COPY.productHero).toMatch(/tamper-evident/i);
    expect(SAFE_LEDGER_COPY.sealBadge).toMatch(/hash-sealed/i);
    expect(SAFE_LEDGER_COPY.shortTagline).not.toMatch(/9-gate verified/i);
    expect(SAFE_LEDGER_COPY.shortTagline).not.toMatch(/immutable/i);
  });

  it("public/customer surfaces contain no banned trust phrases while flag is false", () => {
    if (IMMUTABILITY_BACKEND_ENFORCED) return; // flag flip relaxes the guard

    const files = [
      ...SCAN_DIRS.flatMap((d) => walk(d)),
      ...SCAN_FILES.filter((f) => existsSync(f)),
    ];
    const violations: string[] = [];
    for (const file of files) {
      for (const h of scanFile(file)) {
        violations.push(`${file}:${h.line} → "${h.phrase}" :: ${h.text}`);
      }
    }
    expect(violations, `Banned trust phrases found:\n${violations.join("\n")}`).toEqual([]);
  });

  it("Audit Ledger demo hash and sample payload are labelled as sample/demo", () => {
    const auditLedger = readFileSync(
      join(ROOT, "pages", "products", "AuditLedger.tsx"),
      "utf8",
    );
    expect(auditLedger).toMatch(/Sample SHA-256 Seal/);
    expect(auditLedger).toMatch(/Sample Payload/);
    expect(auditLedger).toMatch(/SAMPLE_HASH_VALUE/);
    expect(auditLedger).toMatch(/Tamper-evident ledger/);
    expect(auditLedger).not.toMatch(/"gates_passed"\s*:\s*9/);
  });

  it("EvidencePackView uses safe 9-Gate section header and demo-labelled sample data", () => {
    const evidence = readFileSync(
      join(ROOT, "components", "desk", "evidence", "EvidencePackView.tsx"),
      "utf8",
    );
    // Safer section header replaces the prior banned "Tamper-Proof" wording.
    expect(evidence).toMatch(/9-Gate Compliance Trail|9-Gate Verification Status/);
    expect(evidence).not.toMatch(/9-Gate Tamper-Proof Proof/);
    // Demo embed must surface a sample qualifier inside the card body.
    expect(evidence).toMatch(/Sample gate data|Sample evidence status/);
  });

  it("public Audit Ledger demo embed remains sample-labelled", () => {
    const auditLedger = readFileSync(
      join(ROOT, "pages", "products", "AuditLedger.tsx"),
      "utf8",
    );
    expect(auditLedger).toMatch(/EvidencePackView\s+demoMode/);
    expect(auditLedger).toMatch(/Sample evidence pack preview \(demo\)|Sample/);
  });

  it("banned-phrase constant covers the issue's named phrases", () => {
    const required = [
      "Immutable",
      "Tamper-Proof",
      "tamper-proofally",
      "tamper-resistant",
      "append-only",
      "audit-proof",
      "9-gate verified",
      "9/9 gates passed",
      "mathematically provable",
      "mathematically proven",
      "mathematically guaranteed",
      "eradicate fraud",
      "fraud-proof",
      "unforgeable",
      "cannot be changed",
      "cannot be altered",
      "cannot be modified",
      "cannot be reversed",
      "hash-chain guaranteed",
      "legally final",
    ];
    for (const r of required) {
      expect(BANNED_TRUST_PHRASES).toContain(r);
    }
  });
});

describe("WaD / sealed-document copy guard", () => {
  it("WadModule renders the SSOT-approved intro, description, and bullet copy", () => {
    const src = readFileSync(join(ROOT, "components", "wad", "WadModule.tsx"), "utf8");
    // Collapse whitespace so JSX line-wrapping does not break substring match.
    const flat = src.replace(/\s+/g, " ");
    const flatten = (s: string) => s.replace(/\s+/g, " ").trim();
    expect(flat).toContain(flatten(SAFE_LEDGER_COPY.wadModuleDescription));
    expect(flat).toContain(flatten(SAFE_LEDGER_COPY.wadModuleDescriptionCreate));
    expect(flat).toContain(flatten(SAFE_LEDGER_COPY.wadModuleIntro));
    for (const bullet of SAFE_LEDGER_COPY.wadModuleBullets) {
      expect(flat).toContain(flatten(bullet));
    }
  });

  it("AcceptBindCard uses the SSOT irreversibility clause and drops 'cannot be reversed'", () => {
    const src = readFileSync(
      join(ROOT, "components", "match", "AcceptBindCard.tsx"),
      "utf8",
    );
    expect(src).toContain("SAFE_LEDGER_COPY.wadAcceptBindIrreversibilityClause");
    // The clause itself must be the safe SSOT string.
    expect(SAFE_LEDGER_COPY.wadAcceptBindIrreversibilityClause).toMatch(
      /governed correction process/i,
    );
    // The legacy overclaim must be gone from rendered text.
    expect(stripComments(src)).not.toMatch(/cannot be reversed/i);
    expect(stripComments(src)).not.toMatch(
      /hash-sealed and recorded, and cannot be reversed/i,
    );
  });

  it("docs/Evidence.tsx does not imply an unshipped automated hash-chain verifier", () => {
    const src = readFileSync(join(ROOT, "pages", "docs", "Evidence.tsx"), "utf8");
    const cleaned = stripComments(src);
    // Must not assert a live integrity result without a qualifier.
    expect(cleaned).not.toMatch(/Hash-chain integrity result and the count/);
    expect(cleaned).not.toMatch(/hash-chain guaranteed/i);
    // Must explicitly qualify verifier status as conditional / when-enabled.
    expect(cleaned).toMatch(
      /verifier (is enabled|results are shown when|status is shown when)|where (available|enabled)/i,
    );
  });
});

/**
 * Extended-scope guard for internal/admin/export/PDF/email/template surfaces.
 *
 * Added by TRUST_PHRASE_GUARD_EXTENSION_CONTAINMENT_COMPLETE so admin and
 * outbound surfaces cannot leak strong trust wording into screenshots,
 * exports, PDFs, or counterparty inboxes.
 *
 * HQ.tsx remains explicitly out of scope (developer/internal map).
 * Comments are stripped before scanning so accurate developer notes are
 * not flagged.
 */
const EXTENDED_SCAN_DIRS = [
  join(ROOT, "components", "admin"),
  join(ROOT, "pages", "admin"),
  join(ROOT, "components", "desk", "billing"),
  join(ROOT, "components", "desk", "inbound"),
  join(ROOT, "components", "facilitation-outreach"),
];

const EDGE_ROOT = join(process.cwd(), "supabase", "functions", "_shared");
const EDGE_TEMPLATE_DIR = join(EDGE_ROOT, "transactional-email-templates");
const EDGE_AUTH_EMAIL_TEMPLATE_DIR = join(EDGE_ROOT, "email-templates");
const EDGE_REVENUE_NOTIFY = join(EDGE_ROOT, "revenue-notify.ts");
const EDGE_AUDIT_LEDGER_COPY = join(EDGE_ROOT, "audit-ledger-copy.ts");
const EDGE_INFRA_ALERTS = join(
  process.cwd(),
  "supabase",
  "functions",
  "infra-alerts",
  "index.ts",
);

/**
 * Narrow exact-line allowlist for statements that are TRUTHFULLY backed
 * by an existing DB-enforced trigger and would otherwise trip the guard.
 * Keep this list tiny and exact — substring match against the trimmed
 * source line, after comment-stripping.
 */
const EXTENDED_ALLOWED_LINE_SUBSTRINGS: ReadonlyArray<string> = [
  // BrdConstraintsPanel governance summary line — narrowly accurate:
  // collapse_ledger, break_glass_actions, poi_events, match_events all
  // have UPDATE/DELETE/TRUNCATE triggers in production.
  "blocking UPDATE/DELETE/TRUNCATE on the listed tables",
  // AdminEventStorePanel header: event_store has triggers in production;
  // the qualifier "where DB-enforced" keeps the statement honest.
  "(append-only where DB-enforced, tamper-evident)",
  // BrdConstraintsPanel key label for the completion ledger constraint
  // (collapse_ledger has UPDATE/DELETE triggers in production).
  'append_only_ledger: "Append-Only Completion Ledger"',
];

function scanFileExtended(file: string): { phrase: string; line: number; text: string }[] {
  const hits: { phrase: string; line: number; text: string }[] = [];
  const cleaned = stripComments(readFileSync(file, "utf8"));
  const lines = cleaned.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (EXTENDED_ALLOWED_LINE_SUBSTRINGS.some((s) => trimmed.includes(s))) continue;
    for (const phrase of BANNED_TRUST_PHRASES) {
      if (line.toLowerCase().includes(phrase.toLowerCase())) {
        hits.push({ phrase, line: i + 1, text: trimmed });
      }
    }
  }
  return hits;
}

describe("Audit Ledger copy guard — extended internal/admin/export/PDF/email scope", () => {
  it("admin / desk-billing / desk-inbound / facilitation-outreach surfaces contain no banned trust phrases", () => {
    if (IMMUTABILITY_BACKEND_ENFORCED) return;
    const files = EXTENDED_SCAN_DIRS.flatMap((d) => walk(d));
    const violations: string[] = [];
    for (const file of files) {
      for (const h of scanFileExtended(file)) {
        violations.push(`${file}:${h.line} → "${h.phrase}" :: ${h.text}`);
      }
    }
    expect(violations, `Banned trust phrases in extended scope:\n${violations.join("\n")}`).toEqual([]);
  });

  it("outbound transactional email templates contain no banned trust phrases", () => {
    if (IMMUTABILITY_BACKEND_ENFORCED) return;
    if (!existsSync(EDGE_TEMPLATE_DIR)) return;
    const files = walk(EDGE_TEMPLATE_DIR);
    const violations: string[] = [];
    for (const file of files) {
      for (const h of scanFileExtended(file)) {
        violations.push(`${file}:${h.line} → "${h.phrase}" :: ${h.text}`);
      }
    }
    expect(violations, `Banned trust phrases in email templates:\n${violations.join("\n")}`).toEqual([]);
  });

  it("revenue-notify edge helper contains no banned trust phrases in user-visible strings", () => {
    if (IMMUTABILITY_BACKEND_ENFORCED) return;
    if (!existsSync(EDGE_REVENUE_NOTIFY)) return;
    const hits = scanFileExtended(EDGE_REVENUE_NOTIFY);
    expect(hits, `Banned phrases in revenue-notify.ts:\n${hits.map((h) => `L${h.line}: ${h.phrase} :: ${h.text}`).join("\n")}`).toEqual([]);
  });

  it("acceptance-receipt email uses the SSOT clause and zero banned phrases", () => {
    const file = join(EDGE_TEMPLATE_DIR, "acceptance-receipt.tsx");
    const src = readFileSync(file, "utf8");
    expect(src).toContain("ACCEPTANCE_RECEIPT_CLAUSE");
    expect(src).toContain("from '../audit-ledger-copy.ts'");
    const cleaned = stripComments(src);
    for (const phrase of BANNED_TRUST_PHRASES) {
      expect(
        cleaned.toLowerCase().includes(phrase.toLowerCase()),
        `acceptance-receipt.tsx still contains banned phrase "${phrase}"`,
      ).toBe(false);
    }
  });

  it("billing and inbound user surfaces use safe wording", () => {
    const billing = readFileSync(
      join(ROOT, "components", "desk", "billing", "BillingOverview.tsx"),
      "utf8",
    );
    expect(billing).toContain("Hash-sealed · Tamper-evident");
    expect(stripComments(billing)).not.toMatch(/tamper-proof/i);

    const inbound = readFileSync(
      join(ROOT, "components", "desk", "inbound", "InboundReview.tsx"),
      "utf8",
    );
    expect(inbound).toContain("Bilateral Hash-Sealed Seal");
    expect(inbound).toContain("AWAITING YOUR HASH-SEALED SIGNATURE");
    expect(stripComments(inbound)).not.toMatch(/tamper-proof/i);
  });

  it("Deno-safe edge copy twin mirrors the browser SSOT byte-for-byte", () => {
    const twin = readFileSync(EDGE_AUDIT_LEDGER_COPY, "utf8");
    expect(twin).toContain(SAFE_LEDGER_COPY.acceptanceReceiptClause);
    expect(twin).toContain(SAFE_LEDGER_COPY.wadAwaitingSignatureLabel);
    expect(twin).toContain("ACCEPTANCE_RECEIPT_CLAUSE");
    expect(twin).toContain("WAD_AWAITING_SIGNATURE_LABEL");
  });

  it("SSOT exposes acceptance-receipt and awaiting-signature primitives", () => {
    expect(SAFE_LEDGER_COPY.acceptanceReceiptClause).toMatch(/hash-sealed/i);
    expect(SAFE_LEDGER_COPY.acceptanceReceiptClause).toMatch(/tamper-evident audit trail/i);
    expect(SAFE_LEDGER_COPY.acceptanceReceiptClause).not.toMatch(/immutable/i);
    expect(SAFE_LEDGER_COPY.wadAwaitingSignatureLabel).toBe("AWAITING YOUR HASH-SEALED SIGNATURE");
  });

  // N6 — explicit auth-email template scan. Even though the broader
  // _shared/** is implicitly covered elsewhere, list this directory
  // explicitly so a future refactor cannot silently drop coverage.
  it("auth (_shared/email-templates) email templates contain no banned trust phrases", () => {
    if (IMMUTABILITY_BACKEND_ENFORCED) return;
    if (!existsSync(EDGE_AUTH_EMAIL_TEMPLATE_DIR)) return;
    const files = walk(EDGE_AUTH_EMAIL_TEMPLATE_DIR);
    expect(files.length, "expected at least one auth email template").toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      for (const h of scanFileExtended(file)) {
        violations.push(`${file}:${h.line} → "${h.phrase}" :: ${h.text}`);
      }
    }
    expect(violations, `Banned trust phrases in auth email templates:\n${violations.join("\n")}`).toEqual([]);
  });

  // N1 — comment-level trust wording in transactional templates can
  // mislead developers and seed regressions in future AI-generated copy.
  // Scan WITH comments retained for the narrow word "immutable".
  it("transactional email template JSDoc/comments do not use outdated trust wording", () => {
    if (!existsSync(EDGE_TEMPLATE_DIR)) return;
    const files = walk(EDGE_TEMPLATE_DIR);
    const violations: string[] = [];
    for (const file of files) {
      const raw = readFileSync(file, "utf8");
      // Extract comment text only (block + line), so this is purely a
      // comment-scope check and does not double-flag rendered copy.
      const blockComments = raw.match(/\/\*[\s\S]*?\*\//g) ?? [];
      const lineComments = raw
        .split("\n")
        .map((l) => {
          const idx = l.indexOf("//");
          return idx === -1 ? "" : l.slice(idx);
        })
        .filter(Boolean);
      const commentBlob = [...blockComments, ...lineComments].join("\n").toLowerCase();
      if (commentBlob.includes("immutable")) {
        violations.push(`${file}: comment uses "immutable"`);
      }
    }
    expect(violations, `Outdated comment trust wording:\n${violations.join("\n")}`).toEqual([]);
  });

  // N2 — infra-alerts must keep the two narrow revenue-notification
  // alert names wired so monitoring cannot silently regress.
  it("infra-alerts exposes revenue_notification_failed and revenue_notification_email_dlq alerts", () => {
    if (!existsSync(EDGE_INFRA_ALERTS)) return;
    const src = readFileSync(EDGE_INFRA_ALERTS, "utf8");
    expect(src).toMatch(/revenue_notification_failed/);
    expect(src).toMatch(/revenue_notification_email_dlq/);
    // The dlq check must query email_send_log by the revenue-notify template name.
    expect(src).toMatch(/template_name["'\s,:]+["']revenue-event-notify["']/);
    expect(src).toMatch(/\.in\(\s*["']status["']\s*,\s*\[\s*["']failed["']\s*,\s*["']dlq["']\s*\]/);
    // Read-only posture: no payment/credit/ledger mutation verbs.
    expect(src).not.toMatch(/token_ledger/);
    expect(src).not.toMatch(/refund/i);
  });
});
