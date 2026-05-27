/**
 * R1 — Disputes sub-tab whitelist regression guard.
 *
 * Background: clicking Compliance Holds / Demo Workspaces / Residency Reviews
 * in HQ → Disputes appeared to do nothing because the `useUrlTab` allowedValues
 * whitelist omitted those values, so each click was rejected and the tab
 * snapped back to Active Disputes.
 *
 * This test pins the whitelist to the full set of rendered TabsTrigger values
 * so any future drift fails CI before reaching UAT.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HQ_PATH = resolve(__dirname, "../pages/HQ.tsx");
const SRC = readFileSync(HQ_PATH, "utf8");

function extractDisputesAllowedValues(): string[] {
  // Find the DisputesTab block and pull its useUrlTab("sub", "disputes", [...]) array.
  const fnIdx = SRC.indexOf("function DisputesTab()");
  expect(fnIdx, "DisputesTab function not found").toBeGreaterThan(-1);
  const slice = SRC.slice(fnIdx, fnIdx + 4000);
  const match = slice.match(/useUrlTab\(\s*"sub"\s*,\s*"disputes"\s*,\s*\[([^\]]+)\]\s*\)/);
  expect(match, "DisputesTab useUrlTab call not found").not.toBeNull();
  return match![1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function extractDisputesTriggerValues(): string[] {
  const fnIdx = SRC.indexOf("function DisputesTab()");
  const slice = SRC.slice(fnIdx, fnIdx + 6000);
  const re = /<TabsTrigger\s+value="([^"]+)"/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) out.push(m[1]);
  return out;
}

describe("HQ DisputesTab sub-tab whitelist (R1 hotfix)", () => {
  it("allows every rendered TabsTrigger value (no silent snap-back)", () => {
    const allowed = extractDisputesAllowedValues();
    const triggers = extractDisputesTriggerValues();
    expect(triggers.length).toBeGreaterThan(0);
    for (const value of triggers) {
      expect(allowed, `TabsTrigger value '${value}' missing from useUrlTab allowedValues — click would snap back to default.`).toContain(value);
    }
  });

  it("explicitly whitelists the three previously-missing values that broke COMP-002/012 UAT", () => {
    const allowed = extractDisputesAllowedValues();
    expect(allowed).toContain("compliance-holds");
    expect(allowed).toContain("demo-workspaces");
    expect(allowed).toContain("residency-reviews");
  });

  it("keeps the default value selectable and preserves existing entries", () => {
    const allowed = extractDisputesAllowedValues();
    for (const value of [
      "disputes",
      "challenges",
      "approvals",
      "verification",
      "trade-request-archive",
      "billing-review",
    ]) {
      expect(allowed).toContain(value);
    }
  });
});
