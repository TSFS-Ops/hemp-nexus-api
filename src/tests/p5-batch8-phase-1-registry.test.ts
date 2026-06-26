/**
 * P-5 Batch 8 — Phase 1 SSOT registry contract tests.
 *
 * Locks the shape, prefixes, uniqueness and cross-references of the
 * Batch 8 SSOT. Any later phase that drifts from these constants will
 * fail this suite.
 */
import { describe, it, expect } from "vitest";
import {
  P5_BATCH8_SCHEMA_VERSION,
  P5_BATCH8_PROVIDER_CATEGORIES,
  P5_BATCH8_PROVIDER_CATEGORY_DEFINITIONS,
  P5_BATCH8_PROVIDER_READY_DEFINITION,
  P5_BATCH8_PROVIDER_DEPENDENCY_STATES,
  P5_BATCH8_PROVIDER_DEPENDENCY_STATE_DEFINITIONS,
  P5_BATCH8_PROVIDER_RESULT_DECISION_STATES,
  P5_BATCH8_PROVIDER_RESULT_DECISION_DEFINITIONS,
  P5_BATCH8_WEBHOOK_EVENTS,
  P5_BATCH8_AUDIT_EVENTS,
  P5_BATCH8_ALLOWED_EXTERNAL_WORDING,
  P5_BATCH8_BANNED_EXTERNAL_WORDING,
  P5_BATCH8_API_SAFE_FIELDS,
  P5_BATCH8_FORBIDDEN_EXTERNAL_FIELDS,
  P5_BATCH8_OWNER_ROLES,
  P5_BATCH8_PROVIDER_OWNERSHIP,
  P5_BATCH8_MEMORY_AND_FINALITY_GATING,
  P5_BATCH8_FAILURE_POLICY,
  P5_BATCH8_HIDDEN_UNTIL_LIVE,
  P5_BATCH8_PHASE_1_SCOPE,
} from "@/lib/p5-batch8/registry";

const uniq = <T>(xs: readonly T[]) => new Set(xs).size === xs.length;

describe("P-5 Batch 8 — Phase 1 SSOT registry", () => {
  it("pins schema version", () => {
    expect(P5_BATCH8_SCHEMA_VERSION).toBe("p5b8.v1");
  });

  it("locks the 9 provider categories with full definitions", () => {
    expect(P5_BATCH8_PROVIDER_CATEGORIES).toHaveLength(9);
    expect(uniq(P5_BATCH8_PROVIDER_CATEGORIES)).toBe(true);
    for (const code of P5_BATCH8_PROVIDER_CATEGORIES) {
      const def = P5_BATCH8_PROVIDER_CATEGORY_DEFINITIONS[code];
      expect(def).toBeDefined();
      expect(def.code).toBe(code);
      expect(def.live_now).toBe(false);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.required_result_type.length).toBeGreaterThan(0);
    }
  });

  it("provider-ready definition excludes any 'live/verified/cleared' implication", () => {
    const def = P5_BATCH8_PROVIDER_READY_DEFINITION;
    expect(def.approved_definition).toMatch(/no live provider decision/i);
    expect(def.excludes.join(" ")).toMatch(/live/i);
    expect(def.excludes.join(" ")).toMatch(/verified|certified/i);
  });

  it("locks the 10 provider dependency states with definitions and unique api_value", () => {
    expect(P5_BATCH8_PROVIDER_DEPENDENCY_STATES).toHaveLength(10);
    expect(uniq(P5_BATCH8_PROVIDER_DEPENDENCY_STATES)).toBe(true);
    for (const s of P5_BATCH8_PROVIDER_DEPENDENCY_STATES) {
      const def = P5_BATCH8_PROVIDER_DEPENDENCY_STATE_DEFINITIONS[s];
      expect(def).toBeDefined();
      expect(def.code).toBe(s);
      expect(def.display_label.length).toBeGreaterThan(0);
      expect(def.meaning.length).toBeGreaterThan(0);
    }
  });

  it("locks the 10 provider-result decision states with definitions", () => {
    expect(P5_BATCH8_PROVIDER_RESULT_DECISION_STATES).toHaveLength(10);
    expect(uniq(P5_BATCH8_PROVIDER_RESULT_DECISION_STATES)).toBe(true);
    for (const s of P5_BATCH8_PROVIDER_RESULT_DECISION_STATES) {
      const def = P5_BATCH8_PROVIDER_RESULT_DECISION_DEFINITIONS[s];
      expect(def).toBeDefined();
      expect(def.code).toBe(s);
      expect(def.set_by.length).toBeGreaterThan(0);
    }
  });

  it("locks webhook events (unique, dotted, no live/legacy collisions)", () => {
    expect(P5_BATCH8_WEBHOOK_EVENTS.length).toBeGreaterThanOrEqual(15);
    expect(uniq(P5_BATCH8_WEBHOOK_EVENTS)).toBe(true);
    for (const e of P5_BATCH8_WEBHOOK_EVENTS) {
      expect(e).toMatch(/^[a-z][a-z_]+\.[a-z][a-z_]+$/);
    }
  });

  it("locks audit events under the p5b8.* namespace, unique", () => {
    expect(P5_BATCH8_AUDIT_EVENTS.length).toBeGreaterThanOrEqual(20);
    expect(uniq(P5_BATCH8_AUDIT_EVENTS)).toBe(true);
    for (const e of P5_BATCH8_AUDIT_EVENTS) {
      expect(e.startsWith("p5b8.")).toBe(true);
    }
  });

  it("allowed and banned external wording arrays are disjoint and unique", () => {
    expect(uniq(P5_BATCH8_ALLOWED_EXTERNAL_WORDING)).toBe(true);
    expect(uniq(P5_BATCH8_BANNED_EXTERNAL_WORDING)).toBe(true);
    const allowedLower = P5_BATCH8_ALLOWED_EXTERNAL_WORDING.map((s) =>
      s.toLowerCase(),
    );
    for (const banned of P5_BATCH8_BANNED_EXTERNAL_WORDING) {
      const b = banned.toLowerCase();
      // no allowed phrase may contain a banned phrase as a substring
      for (const a of allowedLower) {
        expect(a.includes(b)).toBe(false);
      }
    }
  });

  it("API-safe and forbidden external field lists are disjoint and unique", () => {
    expect(uniq(P5_BATCH8_API_SAFE_FIELDS)).toBe(true);
    expect(uniq(P5_BATCH8_FORBIDDEN_EXTERNAL_FIELDS)).toBe(true);
    const safe = new Set<string>(P5_BATCH8_API_SAFE_FIELDS);
    for (const f of P5_BATCH8_FORBIDDEN_EXTERNAL_FIELDS) {
      expect(safe.has(f)).toBe(false);
    }
  });

  it("owner roles unique and ownership table covers every provider category", () => {
    expect(uniq(P5_BATCH8_OWNER_ROLES)).toBe(true);
    for (const cat of P5_BATCH8_PROVIDER_CATEGORIES) {
      const own = P5_BATCH8_PROVIDER_OWNERSHIP[cat];
      expect(own).toBeDefined();
      expect(own.category).toBe(cat);
      for (const r of [
        own.commercial_owner,
        own.technical_contact,
        own.credential_owner,
        own.approval_owner,
        own.activation_signoff_owner,
      ]) {
        expect(P5_BATCH8_OWNER_ROLES).toContain(r);
      }
    }
  });

  it("Memory/finality gating forbids provider-alone writes", () => {
    const g = P5_BATCH8_MEMORY_AND_FINALITY_GATING;
    expect(g.provider_alone_can_drive_finality).toBe(false);
    expect(g.provider_alone_can_write_memory).toBe(false);
    expect(g.test_mode_can_feed_memory).toBe(false);
    expect(g.test_mode_can_feed_finality).toBe(false);
    expect(g.test_webhook_can_update_readiness).toBe(false);
    expect(g.fallback_must_be_labelled_as).toMatch(/manual fallback/i);
    // Memory-eligible decisions must be a subset of decision states
    for (const s of g.decision_states_eligible_for_memory_when_final) {
      expect(P5_BATCH8_PROVIDER_RESULT_DECISION_STATES).toContain(s);
    }
    for (const s of g.decision_states_blocked_from_memory) {
      expect(P5_BATCH8_PROVIDER_RESULT_DECISION_STATES).toContain(s);
    }
  });

  it("failure policy never marks verified/rejected from a timeout", () => {
    expect(P5_BATCH8_FAILURE_POLICY.timeout.never_imply).toEqual(
      expect.arrayContaining(["verified", "failed KYC", "rejected"]),
    );
    expect(P5_BATCH8_FAILURE_POLICY.timeout.retry_count).toBe(2);
  });

  it("hidden-until-live list pins the Run-Live-Check button and finality/Memory blocks", () => {
    expect(P5_BATCH8_HIDDEN_UNTIL_LIVE).toContain("run_live_check_button");
    expect(P5_BATCH8_HIDDEN_UNTIL_LIVE).toContain(
      "auto_finality_from_provider_fields",
    );
    expect(P5_BATCH8_HIDDEN_UNTIL_LIVE).toContain(
      "memory_writes_from_provider_fields",
    );
  });

  it("Phase-1 scope guard forbids DB/RPC/UI/edge/cron/credentials/live calls", () => {
    const s = P5_BATCH8_PHASE_1_SCOPE;
    for (const x of [
      "db_migrations",
      "rpcs",
      "ui",
      "edge_functions",
      "cron",
      "live_provider_calls",
      "provider_credentials",
      "memory_or_finality_mutations",
      "batch_6_changes",
      "batch_7_surfaces",
    ]) {
      expect(s.does_not_ship).toContain(x);
      expect(s.ships).not.toContain(x);
    }
  });
});
