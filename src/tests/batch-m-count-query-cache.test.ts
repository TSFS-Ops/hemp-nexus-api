/**
 * Batch M+ — precise count query is cached per filter set.
 *
 * Source-level pins that:
 *   1. The count useQuery declares a non-zero staleTime and gcTime.
 *   2. It uses keepPreviousData (no flicker on filter change).
 *   3. It does not refetch on window focus or on remount.
 *   4. The queryKey still encodes the full (action, surface, window)
 *      filter tuple so each distinct filter set has its own cache entry.
 *   5. The Refresh button explicitly invalidates the count cache too,
 *      so operator-driven refreshes still bypass the cache.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");
const PANEL_SRC = readFileSync(
  join(REPO_ROOT, "src/components/admin/AdminOutreachBlocksPanel.tsx"),
  "utf8",
);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}
const PANEL_CODE = stripComments(PANEL_SRC);

describe("Batch M+ :: precise count query caching", () => {
  it("imports keepPreviousData from react-query", () => {
    expect(PANEL_CODE).toMatch(
      /from\s+["']@tanstack\/react-query["'][^;]*keepPreviousData|keepPreviousData[^;]*from\s+["']@tanstack\/react-query["']/,
    );
  });

  it("declares COUNT_QUERY_STALE_MS and COUNT_QUERY_GC_MS constants", () => {
    expect(PANEL_CODE).toMatch(/const\s+COUNT_QUERY_STALE_MS\s*=\s*\d/);
    expect(PANEL_CODE).toMatch(/const\s+COUNT_QUERY_GC_MS\s*=\s*\d/);
  });

  it("count query uses staleTime, gcTime, keepPreviousData, and disables refocus/remount refetch", () => {
    const region = PANEL_CODE.split("admin-outreach-blocks-count")[1] ?? "";
    expect(region).toMatch(/staleTime:\s*COUNT_QUERY_STALE_MS/);
    expect(region).toMatch(/gcTime:\s*COUNT_QUERY_GC_MS/);
    expect(region).toMatch(/placeholderData:\s*keepPreviousData/);
    expect(region).toMatch(/refetchOnWindowFocus:\s*false/);
    expect(region).toMatch(/refetchOnMount:\s*false/);
  });

  it("count queryKey still encodes the (action, surface, window) filter tuple", () => {
    const region = PANEL_CODE.split("admin-outreach-blocks-count")[1] ?? "";
    expect(region).toMatch(/actionFilter/);
    expect(region).toMatch(/surfaceFilter/);
    expect(region).toMatch(/windowFilter/);
  });

  it("Refresh button explicitly invalidates the count cache too", () => {
    expect(PANEL_CODE).toMatch(/countQuery\.refetch\(\)/);
    expect(PANEL_CODE).toMatch(
      /disabled=\{query\.isFetching\s*\|\|\s*countQuery\.isFetching\}/,
    );
  });
});
