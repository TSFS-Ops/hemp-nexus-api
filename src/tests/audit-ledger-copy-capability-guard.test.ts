/**
 * Audit Ledger copy/capability guard.
 *
 * Option-A containment for the open issue:
 *   "Audit Ledger page claims an immutable ledger without database immutability."
 *
 * Until backend immutability is genuinely enforced (UPDATE/DELETE/TRUNCATE
 * blocked on every claimed ledger table with no GUC/owner-droppable bypass,
 * plus an automated hash-chain verifier), strong trust wording must not
 * appear on public/product-facing surfaces under src/pages and src/components.
 *
 * This guard never touches the database. It is presentation-only.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import {
  IMMUTABILITY_BACKEND_ENFORCED,
  BANNED_TRUST_PHRASES,
  SAFE_LEDGER_COPY,
} from "@/lib/policy/audit-ledger-capability";

const ROOT = join(process.cwd(), "src");
const SCAN_DIRS = [join(ROOT, "pages"), join(ROOT, "components")];
const ALLOWED_EXT = new Set([".ts", ".tsx"]);
// Files in scan dirs that may legitimately reference banned phrases as
// data (e.g. this guard's own importer of the banned list).
const ALLOWLIST: string[] = [];

function walk(dir: string, acc: string[] = []): string[] {
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

function scanFile(file: string): { phrase: string; line: number; text: string }[] {
  const hits: { phrase: string; line: number; text: string }[] = [];
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const phrase of BANNED_TRUST_PHRASES) {
      // Case-insensitive substring; whole word boundary not required, the
      // banned list is already specific.
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

  it("public surfaces under src/pages and src/components contain no banned trust phrases while flag is false", () => {
    if (IMMUTABILITY_BACKEND_ENFORCED) {
      // If the flag is ever flipped, this guard relaxes — but flipping
      // requires a separate hardening programme.
      return;
    }
    const files = SCAN_DIRS.flatMap((d) => walk(d)).filter(
      (f) => !ALLOWLIST.some((a) => f.endsWith(a)),
    );
    const violations: string[] = [];
    for (const file of files) {
      const hits = scanFile(file);
      for (const h of hits) {
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
    // Demo evidence pack must carry a sample marker.
    expect(auditLedger).toMatch(/Sample/);
    // Hero must use tamper-evident, not immutable, wording.
    expect(auditLedger).toMatch(/Tamper-evident ledger/);
    // Old hard-coded "gates_passed": 9 must be gone.
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
