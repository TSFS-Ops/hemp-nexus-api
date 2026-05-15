/**
 * Batch O Phase 2 closeout — list-filter behaviour test (MT-008).
 *
 * Pure predicate test: confirms that the list-filter idiom
 *   rows.filter(m => !isInconsistentMatch(m))
 * (used by AttentionPipeline / DealPipeline / MatchesList) actually
 * removes inconsistent rows and preserves clean active rows.
 *
 * No DB, no React, no side effects.
 */

import { describe, it, expect } from "vitest";
import { isInconsistentMatch } from "@/lib/match-lifecycle";

type Row = Parameters<typeof isInconsistentMatch>[0] & { id: string };

const ROWS: Row[] = [
  // — inconsistent —
  { id: "i-settled-draft", status: "settled", poi_state: "DRAFT", state: "discovery" },
  {
    id: "i-completed-open-poi",
    status: "completed",
    state: "completed",
    poi_state: "ACCEPTED",
  },
  {
    id: "i-settled-at-no-terminal",
    status: "discovery",
    state: "discovery",
    settled_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "i-both-committed-discovery",
    status: "discovery",
    state: "discovery",
    buyer_committed_at: "2026-01-01T00:00:00Z",
    seller_committed_at: "2026-01-02T00:00:00Z",
  },
  {
    id: "i-marker-legacy",
    status: "discovery",
    state: "discovery",
    metadata: { legacy_repair_required: true },
  },
  {
    id: "i-marker-state-recon",
    status: "discovery",
    state: "discovery",
    metadata: { state_reconciliation_required: "true" },
  },
  // — clean active —
  { id: "c-active-1", status: "discovery", state: "counterparty_sighted", poi_state: "" },
  {
    id: "c-active-2",
    status: "discovery",
    state: "buyer_committed",
    poi_state: "",
    buyer_committed_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "c-issued",
    status: "discovery",
    state: "completed",
    poi_state: "ISSUED",
  },
  // — clean terminal (these stay; pipelines filter terminals via query state buckets, not predicate) —
  { id: "c-terminal", status: "settled", state: "completed", poi_state: "SETTLED" },
];

describe("Batch O Phase 2 — list filter (MT-008)", () => {
  const visible = ROWS.filter((m) => !isInconsistentMatch(m));
  const visibleIds = new Set(visible.map((r) => r.id));

  it("excludes every inconsistent row", () => {
    for (const id of [
      "i-settled-draft",
      "i-completed-open-poi",
      "i-settled-at-no-terminal",
      "i-both-committed-discovery",
      "i-marker-legacy",
      "i-marker-state-recon",
    ]) {
      expect(visibleIds.has(id)).toBe(false);
    }
  });

  it("keeps every clean active row", () => {
    expect(visibleIds.has("c-active-1")).toBe(true);
    expect(visibleIds.has("c-active-2")).toBe(true);
    expect(visibleIds.has("c-issued")).toBe(true);
  });

  it("does not silently drop clean terminal rows (pipeline-level state filters handle those)", () => {
    expect(visibleIds.has("c-terminal")).toBe(true);
  });

  it("count of visible rows reflects the filter, not the raw fetch", () => {
    expect(visible.length).toBe(4);
    expect(ROWS.length - visible.length).toBe(6);
  });
});
