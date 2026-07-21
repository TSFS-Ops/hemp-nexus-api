/**
 * PR #26 - structural conformance for the pilot-readiness validation
 * workflow and validation package. These are static checks: they do NOT
 * prove the workflow ran in CI, and they do NOT prove PR #26 itself.
 * They only prove the files in this workspace satisfy the fail-closed
 * shape agreed for the workflow.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW_PATH = ".github/workflows/pr26-pilot-readiness-validation.yml";
const DOC_PATH = "docs/pr-26-validation-package.md";
const PILOT_MIGRATION = "supabase/migrations/20260712174259_967e2a8d-4a39-4e2d-9b1a-c892a1a4425a.sql";

const PILOT_FUNDER_BANK_ID = "11111111-1111-1111-1111-111111111111";
const ISOLATION_TEST_FUND_ID = "22222222-2222-2222-2222-222222222222";

function read(p: string): string {
  return readFileSync(p, "utf8");
}

describe("PR #26 - one authoritative pilot-readiness workflow", () => {
  it("exactly one pilot-readiness workflow file exists", () => {
    const files = readdirSync(".github/workflows")
      .filter((f) => /pilot|pr26/i.test(f));
    expect(files).toEqual(["pr26-pilot-readiness-validation.yml"]);
  });
});

describe("PR #26 - workflow is fail-closed", () => {
  const wf = read(WORKFLOW_PATH);

  it("no mandatory step uses continue-on-error: true", () => {
    expect(wf).not.toMatch(/continue-on-error:\s*true/);
  });

  it("artifact uploads use if: always()", () => {
    const uploads = wf.match(/uses:\s*actions\/upload-artifact@v4[\s\S]*?path:/g) ?? [];
    expect(uploads.length).toBeGreaterThanOrEqual(2);
    // Every upload block must be preceded by an `if: always()` line.
    const blocks = wf.split(/uses:\s*actions\/upload-artifact@v4/);
    for (let i = 1; i < blocks.length; i++) {
      const before = blocks[i - 1].slice(-400);
      expect(before, `upload-artifact block ${i} must be if: always()`).toMatch(
        /if:\s*always\(\)/,
      );
    }
  });

  it("has an explicit final gate that exits non-zero on FAIL", () => {
    expect(wf).toMatch(/Final gate/);
    expect(wf).toMatch(/RESULT:\s*PASS/);
    expect(wf).toMatch(/RESULT:\s*FAIL/);
    expect(wf).toMatch(/exit\s+\$fail/);
  });

  it("uses the fixed pilot funder-org IDs from the actual migration", () => {
    expect(wf).toContain(PILOT_FUNDER_BANK_ID);
    expect(wf).toContain(ISOLATION_TEST_FUND_ID);
  });

  it("isolation check does not require a Pilot Funder Bank release to exist", () => {
    // The isolation SQL must only forbid rows pointing at the isolation
    // fixture (referenced via the ISOLATION_TEST_FUND_ID env var); it
    // must not first look up "the first release" or assert that a Pilot
    // Funder Bank release exists.
    const isoStart = wf.indexOf("Isolation invariant");
    const isoBlock = wf.slice(isoStart, isoStart + 700);
    expect(isoBlock).toMatch(/ISOLATION_TEST_FUND_ID/);
    expect(isoBlock).not.toMatch(/order by created_at asc\s+limit\s+1/i);
    expect(isoBlock).not.toMatch(/Pilot Funder Bank/);
  });

    it("intentionally calls the pilot readiness RPC fw_admin_check_pilot_fixtures_v1", () => {
      // fw_admin_check_pilot_fixtures_v1 IS defined by
      // supabase/migrations/20260713090000_pilot_fixture_and_readiness_rpc.sql
      // and the workflow is expected to call it.
      expect(wf).toMatch(/fw_admin_check_pilot_fixtures_v1/);
    });

    it("asserts every readiness check_key row is exactly Ready", () => {
      expect(wf).toMatch(/!=\s*"Ready"/);
      expect(wf).toMatch(/FIXTURES_READY_ALL_NINE/);
    });

    it("requires the isolation_no_release readiness key", () => {
      expect(wf).toMatch(/isolation_no_release/);
    });

it("does not require a sealed funder PDF (funder_pack_versions) pre-release", () => {
    // Pre-release readiness is about the source evidence pack, not the
    // post-release sealed funder PDF.
    expect(wf).not.toMatch(/funder_pack_versions/);
  });

    it("does not query the incorrect organizations table directly", () => {
      expect(wf).not.toMatch(/FROM public\.organizations\b/);
    });
    });

describe("PR #26 - fixed IDs match the actual pilot migration", () => {
  it("both fixed IDs are set on p5_batch3_funder_organisations in the migration", () => {
    const mig = read(PILOT_MIGRATION);
    expect(mig).toContain(PILOT_FUNDER_BANK_ID);
    expect(mig).toContain(ISOLATION_TEST_FUND_ID);
    expect(mig).toContain("p5_batch3_funder_organisations");
  });
});

describe("PR #26 - validation package doc is honest and clean", () => {
  const doc = read(DOC_PATH);

  it("uses the correct fixed IDs when it mentions the pilot fixtures", () => {
    expect(doc).toContain(PILOT_FUNDER_BANK_ID);
    expect(doc).toContain(ISOLATION_TEST_FUND_ID);
  });

    it("documents the pilot readiness RPC accurately", () => {
      expect(doc).toMatch(/fw_admin_check_pilot_fixtures_v1/);
      expect(doc).not.toMatch(/must never exist/i);
    });

it("does not assume a demo release, consent row, or sealed pack already exists", () => {
    expect(doc).not.toMatch(/one demo match with populated buyer\/seller/);
    expect(doc).not.toMatch(/A sealed pack version exists/);
    expect(doc).not.toMatch(/Consent rows exist for the release/);
  });

  it("contains no smart-punctuation mojibake", () => {
    // Common Windows-1252-in-UTF-8 sequences and the specific
    // characters called out in the hardening brief.
    expect(doc).not.toMatch(/â€”|â‰¥|â˜|Â§/);
  });

  it("targets the actual funder-organisation table when needed", () => {
    expect(doc).not.toMatch(/from public\.organizations[\s\S]{0,80}Isolation Test Fund/i);
  });

  it("states clearly that the current Lovable workspace cannot run the package", () => {
    expect(doc).toMatch(/cannot run|cannot be confirmed as PR #26/i);
  });
});

describe("PR #26 - workflow references the structural conformance test itself", () => {
  it("focused-tests step includes this conformance test file", () => {
    const wf = read(WORKFLOW_PATH);
    expect(wf).toContain("pr26-pilot-readiness-workflow-conformance.test.ts");
  });

  it("the focused test files referenced by the workflow all exist in the workspace", () => {
    const wf = read(WORKFLOW_PATH);
    const referenced = wf.match(/src\/tests\/[a-zA-Z0-9._-]+\.test\.ts/g) ?? [];
    expect(referenced.length).toBeGreaterThan(0);
    for (const rel of referenced) {
      expect(existsSync(join(process.cwd(), rel)), `${rel} missing`).toBe(true);
    }
  });
});
