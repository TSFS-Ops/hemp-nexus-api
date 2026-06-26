/**
 * P-5 Batch 7 — Phase 3 guard test.
 *
 * Proves the API v1 projection layer:
 *   1. strips every field outside the Phase 1 allow-list,
 *   2. hard-fails on any forbidden / internal-only field,
 *   3. builds an envelope that exposes only allow-listed keys + envelope keys.
 */
import { describe, expect, it } from "vitest";
import {
  buildApiV1Envelope,
  projectRowsToApiV1,
  projectToApiV1,
} from "@/lib/p5-batch7/api-v1";
import {
  P5_BATCH7_API_V1_VISIBLE_FIELDS,
  P5_BATCH7_FORBIDDEN_EXTERNAL_FIELDS,
} from "@/lib/p5-batch7/registry";

const ALLOW = new Set<string>(P5_BATCH7_API_V1_VISIBLE_FIELDS as readonly string[]);
const ENVELOPE_KEYS = new Set([
  "data", "page", "page_size", "total_count",
  "next_cursor", "as_of", "is_stale", "api_version", "error",
]);

describe("P5 Batch 7 Phase 3 — API v1 projection", () => {
  it("strips fields outside the allow-list", () => {
    const raw = {
      case_id: "c1",
      case_reference: "REF-1",
      case_status: "in_progress",
      // unknown (non-forbidden) fields must NOT survive:
      arbitrary_extra: "should be stripped",
      another_unknown: { foo: "bar" },
      random_extra: 42,
    };
    const safe = projectToApiV1(raw);
    for (const k of Object.keys(safe)) {
      expect(ALLOW.has(k)).toBe(true);
    }
    expect(safe).not.toHaveProperty("arbitrary_extra");
    expect(safe).not.toHaveProperty("random_extra");

  });

  it("throws when any forbidden field is present", () => {
    for (const f of P5_BATCH7_FORBIDDEN_EXTERNAL_FIELDS) {
      expect(() =>
        projectToApiV1({ case_id: "c", [f]: "leak" } as Record<string, unknown>),
      ).toThrowError(/forbidden field/i);
    }
  });

  it("array projection mirrors single-row behaviour", () => {
    const rows = [
      { case_id: "a", case_status: "in_progress", raw_provider_payload: undefined },
      { case_id: "b", case_status: "resolved" },
    ];
    // raw_provider_payload is forbidden even when undefined
    expect(() => projectRowsToApiV1(rows)).toThrow(/forbidden field/i);
  });

  it("envelope exposes only allow-listed keys plus envelope keys", () => {
    const env = buildApiV1Envelope([
      projectToApiV1({ case_id: "x", as_of: "2026-06-26T00:00:00Z", is_stale: false }),
    ]);
    for (const k of Object.keys(env)) {
      expect(ENVELOPE_KEYS.has(k)).toBe(true);
    }
    for (const row of env.data) {
      for (const k of Object.keys(row)) {
        expect(ALLOW.has(k)).toBe(true);
      }
    }
    expect(env.api_version).toBe("v1");
    expect(env.is_stale).toBe(false);
    expect(env.as_of).toBe("2026-06-26T00:00:00Z");
  });

  it("envelope flags is_stale when any row is stale", () => {
    const env = buildApiV1Envelope([
      projectToApiV1({ case_id: "x", as_of: "2026-06-01T00:00:00Z", is_stale: true }),
      projectToApiV1({ case_id: "y", as_of: "2026-06-26T00:00:00Z", is_stale: false }),
    ]);
    expect(env.is_stale).toBe(true);
    expect(env.as_of).toBe("2026-06-26T00:00:00Z");
  });
});
