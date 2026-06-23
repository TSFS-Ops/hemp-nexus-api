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

  it("banned-phrase constant covers the issue's named phrases", () => {
    const required = [
      "Immutable",
      "Tamper-Proof",
      "tamper-proofally",
      "append-only",
      "audit-proof",
      "9-gate verified",
      "9/9 gates passed",
      "mathematically provable",
      "eradicate fraud",
    ];
    for (const r of required) {
      expect(BANNED_TRUST_PHRASES).toContain(r);
    }
  });
});
