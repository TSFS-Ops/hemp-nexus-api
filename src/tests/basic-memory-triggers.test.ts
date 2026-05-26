/**
 * Basic Memory Record v1 — Batch 3 trigger-hook source-shape tests.
 *
 * These run at unit/lint level over the source of the three hooked
 * edge functions. They prove (without spinning up edge runtime):
 *
 *  - each of the three hooks invokes `writeBasicMemoryRecord` from
 *    `_shared/basic-memory.ts` with the approved v1 vocabulary,
 *  - each hook anchors on the correct `source_table` / `source_function`,
 *  - each hook is wrapped to be fail-open (try/catch or via the
 *    helper which is itself fail-open and never throws),
 *  - no out-of-scope trigger types are emitted,
 *  - no raw provider payloads / document bodies / secret-like fields
 *    are baked into the status_snapshot construction.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const COLLAPSE = readFileSync(
  join(ROOT, "supabase/functions/collapse/index.ts"),
  "utf8",
);
const WAD = readFileSync(
  join(ROOT, "supabase/functions/wad/index.ts"),
  "utf8",
);
const ENGAGEMENTS = readFileSync(
  join(ROOT, "supabase/functions/poi-engagements/index.ts"),
  "utf8",
);
const HELPER = readFileSync(
  join(ROOT, "supabase/functions/_shared/basic-memory.ts"),
  "utf8",
);

const APPROVED_TRIGGERS = new Set([
  "finality.collapsed",
  "wad.sealed",
  "dispute.resolved",
]);

const FORBIDDEN_SNAPSHOT_KEYS = [
  "raw_payload",
  "provider_payload",
  "document_body",
  "document_content",
  "file_bytes",
  "private_key",
  "access_token",
  "refresh_token",
  "api_key",
  "password",
];

describe("basic-memory triggers — collapse hook", () => {
  it("calls the writer with finality.collapsed / completed / collapse_recorded", () => {
    expect(COLLAPSE).toMatch(/writeBasicMemoryRecord/);
    expect(COLLAPSE).toMatch(/trigger_event_type:\s*"finality\.collapsed"/);
    expect(COLLAPSE).toMatch(/outcome:\s*"completed"/);
    expect(COLLAPSE).toMatch(/outcome_reason:\s*"collapse_recorded"/);
    expect(COLLAPSE).toMatch(/source_table:\s*"collapse_ledger"/);
    expect(COLLAPSE).toMatch(/source_function:\s*"collapse"/);
  });
  it("is placed AFTER the atomic collapse RPC has returned governance event IDs", () => {
    const rpcIdx = COLLAPSE.indexOf("atomic_collapse_record");
    const hookIdx = COLLAPSE.indexOf("writeBasicMemoryRecord");
    expect(rpcIdx).toBeGreaterThan(0);
    expect(hookIdx).toBeGreaterThan(rpcIdx);
  });
});

describe("basic-memory triggers — wad seal hook", () => {
  it("calls the writer with wad.sealed / wad_sealed / attestations_complete", () => {
    expect(WAD).toMatch(/writeBasicMemoryRecord/);
    expect(WAD).toMatch(/trigger_event_type:\s*"wad\.sealed"/);
    expect(WAD).toMatch(/outcome:\s*"wad_sealed"/);
    expect(WAD).toMatch(/outcome_reason:\s*"attestations_complete"/);
    expect(WAD).toMatch(/source_table:\s*"wads"/);
    expect(WAD).toMatch(/source_function:\s*"wad"/);
  });
  it("is wrapped in try/catch (defence-in-depth fail-open)", () => {
    const idx = WAD.indexOf("trigger_event_type: \"wad.sealed\"");
    expect(idx).toBeGreaterThan(0);
    // try { ... } catch precedes the hook within ~3KB window
    const window = WAD.slice(Math.max(0, idx - 1500), idx);
    expect(window).toMatch(/try\s*\{/);
  });
  it("is placed AFTER the wads UPDATE to status='sealed'", () => {
    const sealIdx = WAD.indexOf('status: "sealed"');
    const hookIdx = WAD.indexOf("trigger_event_type: \"wad.sealed\"");
    expect(sealIdx).toBeGreaterThan(0);
    expect(hookIdx).toBeGreaterThan(sealIdx);
  });
});

describe("basic-memory triggers — dispute resolve hook", () => {
  it("calls the writer with dispute.resolved / dispute_resolved / dispute_resolved", () => {
    expect(ENGAGEMENTS).toMatch(/writeBasicMemoryRecord/);
    expect(ENGAGEMENTS).toMatch(/trigger_event_type:\s*"dispute\.resolved"/);
    expect(ENGAGEMENTS).toMatch(/outcome:\s*"dispute_resolved"/);
    expect(ENGAGEMENTS).toMatch(/outcome_reason:\s*"dispute_resolved"/);
    expect(ENGAGEMENTS).toMatch(/source_table:\s*"disputes"/);
  });
  it("only emits when a disputes row was actually resolved", () => {
    // The hook is gated by `if (resolvedDisputeId)`.
    const idx = ENGAGEMENTS.indexOf("trigger_event_type: \"dispute.resolved\"");
    expect(idx).toBeGreaterThan(0);
    const window = ENGAGEMENTS.slice(Math.max(0, idx - 800), idx);
    expect(window).toMatch(/if\s*\(\s*resolvedDisputeId\s*\)/);
  });
});

describe("basic-memory triggers — scope control", () => {
  it("no out-of-scope trigger_event_type strings are emitted by the three hooked fns", () => {
    const sources = [COLLAPSE, WAD, ENGAGEMENTS].join("\n");
    const matches =
      sources.match(/trigger_event_type:\s*"([^"]+)"/g) ?? [];
    for (const m of matches) {
      const t = m.match(/"([^"]+)"/)![1];
      expect(APPROVED_TRIGGERS.has(t)).toBe(true);
    }
  });

  it("no forbidden raw-payload / document-body / secret keys appear inside any status_snapshot literal", () => {
    const sources = { collapse: COLLAPSE, wad: WAD, eng: ENGAGEMENTS };
    for (const [name, src] of Object.entries(sources)) {
      // Find each status_snapshot: { ... } block (greedy across one nesting level)
      const regex = /status_snapshot:\s*\{([\s\S]*?)\n\s{8,}\}/g;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(src)) !== null) {
        const block = m[1].toLowerCase();
        for (const forbid of FORBIDDEN_SNAPSHOT_KEYS) {
          expect(
            block.includes(forbid),
            `${name}: status_snapshot contains forbidden key '${forbid}'`,
          ).toBe(false);
        }
      }
    }
  });
});

describe("basic-memory helper — fail-open contract", () => {
  it("helper never throws (wraps body in try/catch and returns a result)", () => {
    expect(HELPER).toMatch(/try\s*\{/);
    expect(HELPER).toMatch(/catch\s*\(/);
    // Return signature is BasicMemoryWriteResult, not Promise<never>.
    expect(HELPER).toMatch(/Promise<BasicMemoryWriteResult>/);
  });
  it("uses INTERNAL_CRON_KEY or service_role bearer (never anon)", () => {
    expect(HELPER).toMatch(/INTERNAL_CRON_KEY/);
    expect(HELPER).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(HELPER).not.toMatch(/VITE_SUPABASE_PUBLISHABLE_KEY/);
    expect(HELPER).not.toMatch(/SUPABASE_ANON_KEY/);
  });
});
