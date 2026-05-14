/**
 * Batch D Test 7 regression — MatchDetails must pass the *displayed*
 * engagement_status (current ∪ latest_historical) into
 * AcceptEngagementCard so the `expired` branch can render the
 * "Accept (late)" affordance.
 *
 * Previously it used `engagementData?.engagement_status` (current only),
 * which is null for expired rows because the read-model resolver
 * classifies expired/declined as historical. That meant the counterparty
 * opened the match page and saw nothing — which is exactly what
 * Daniel reported.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("MatchDetails — engagement status wiring (Batch D Test 7)", () => {
  const src = readFileSync("src/pages/MatchDetails.tsx", "utf8");

  it("derives engagementStatus from displayEngagement, not engagementData", () => {
    expect(src).toMatch(
      /engagementStatus[^=]*=\s*\(displayEngagement\?\.engagement_status[^)]*\)\s*\|\|\s*null/,
    );
    // Guard: make sure nobody silently reverts to the engagementData path.
    expect(src).not.toMatch(
      /const\s+engagementStatus[^=]*=\s*\(engagementData\?\.engagement_status/,
    );
  });

  it("still passes engagementStatus into AcceptEngagementCard", () => {
    expect(src).toMatch(
      /<AcceptEngagementCard[^>]*engagementStatus=\{engagementStatus\}/s,
    );
  });
});
