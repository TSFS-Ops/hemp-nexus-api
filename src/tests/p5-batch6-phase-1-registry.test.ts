/**
 * P-5 Batch 6 — Phase 1 registry contract tests.
 *
 * Pure unit tests against the SSOT module. No DB, no UI, no network.
 * Phases 2–6 add their own test suites; this file MUST stay focused on
 * the registry shape so any future drift surfaces here first.
 */
import { describe, it, expect } from "vitest";
import {
  P5_BATCH6_SCHEMA_VERSION,
  P5_BATCH6_EXCEPTION_TYPES,
  P5_BATCH6_EXCEPTION_DEFINITIONS,
  P5_BATCH6_REVIEW_QUEUES,
  P5_BATCH6_QUEUE_DEFINITIONS,
  P5_BATCH6_PRIORITIES,
  P5_BATCH6_PRIORITY_DEFINITIONS,
  P5_BATCH6_STATUSES,
  P5_BATCH6_TERMINAL_STATUSES,
  P5_BATCH6_DISPUTE_STATES,
  P5_BATCH6_DISPUTE_STATES_PAUSE_MEMORY,
  P5_BATCH6_NOTE_TYPES,
  P5_BATCH6_NOTE_TYPES_REQUIRE_REASON,
  P5_BATCH6_AUDIT_EVENTS,
  P5_BATCH6_AUDIT_EVENTS_REQUIRE_BEFORE_AFTER,
  P5_BATCH6_REPORTS,
  P5_BATCH6_REPORT_DEFINITIONS,
  P5_BATCH6_EXTERNAL_SAFE_MESSAGES,
  P5_BATCH6_BANNED_EXTERNAL_WORDING,
  P5_BATCH6_API_SAFE_FIELDS,
  P5_BATCH6_API_SAFE_STATUSES,
  P5_BATCH6_FORBIDDEN_EXTERNAL_FIELDS,
} from "@/lib/p5-batch6-exception-registry";

describe("P-5 Batch 6 — schema version", () => {
  it("uses the p5b6.v1 version constant", () => {
    expect(P5_BATCH6_SCHEMA_VERSION).toBe("p5b6.v1");
  });
});

describe("P-5 Batch 6 — exception types (12 client-approved)", () => {
  const required = [
    "EVIDENCE_MISSING",
    "EVIDENCE_INVALID_OR_EXPIRED",
    "CONFLICTING_PARTY_INFORMATION",
    "COMPLIANCE_HOLD",
    "FUNDER_REVIEW_EXCEPTION",
    "PROVIDER_DEPENDENCY_FAILURE",
    "PAYMENT_RECONCILIATION_EXCEPTION",
    "MANUAL_OVERRIDE_REQUESTED",
    "DISPUTE_RAISED",
    "FINALITY_BLOCKED",
    "MEMORY_CONFLICT_OR_CORRECTION",
    "SECURITY_OR_ACCESS_EXCEPTION",
  ] as const;

  it("has exactly 12 types in the registry", () => {
    expect(P5_BATCH6_EXCEPTION_TYPES.length).toBe(12);
    expect(new Set(P5_BATCH6_EXCEPTION_TYPES).size).toBe(12);
  });

  for (const t of required) {
    it(`registers ${t} with a definition`, () => {
      expect(P5_BATCH6_EXCEPTION_TYPES).toContain(t);
      expect(P5_BATCH6_EXCEPTION_DEFINITIONS[t]).toBeDefined();
      expect(P5_BATCH6_EXCEPTION_DEFINITIONS[t].code).toBe(t);
      expect(P5_BATCH6_EXCEPTION_DEFINITIONS[t].authorised_resolver_roles.length).toBeGreaterThan(0);
    });
  }

  it("DISPUTE_RAISED can pause Memory", () => {
    expect(P5_BATCH6_EXCEPTION_DEFINITIONS.DISPUTE_RAISED.can_pause_memory).toBe(true);
  });

  it("COMPLIANCE_HOLD and SECURITY_OR_ACCESS_EXCEPTION are critical", () => {
    expect(P5_BATCH6_EXCEPTION_DEFINITIONS.COMPLIANCE_HOLD.default_severity).toBe("critical");
    expect(P5_BATCH6_EXCEPTION_DEFINITIONS.SECURITY_OR_ACCESS_EXCEPTION.default_severity).toBe("critical");
  });
});

describe("P-5 Batch 6 — review queues (10 incl. Unified Operations Inbox)", () => {
  const required = [
    "evidence_gap",
    "compliance_exception",
    "funder_escalation",
    "provider_dependency",
    "payment_reconciliation",
    "manual_override_waiver",
    "finality_review",
    "dispute_review",
    "memory_governance",
    "unified_operations_inbox",
  ] as const;

  it("has exactly 10 queues", () => {
    expect(P5_BATCH6_REVIEW_QUEUES.length).toBe(10);
    expect(new Set(P5_BATCH6_REVIEW_QUEUES).size).toBe(10);
  });

  for (const q of required) {
    it(`registers ${q}`, () => {
      expect(P5_BATCH6_REVIEW_QUEUES).toContain(q);
      expect(P5_BATCH6_QUEUE_DEFINITIONS[q]).toBeDefined();
    });
  }

  it("marks only unified_operations_inbox as the control tower", () => {
    const towers = P5_BATCH6_REVIEW_QUEUES.filter(
      (q) => P5_BATCH6_QUEUE_DEFINITIONS[q].is_control_tower,
    );
    expect(towers).toEqual(["unified_operations_inbox"]);
  });

  it("every exception type's default queue exists in the queue registry", () => {
    for (const t of P5_BATCH6_EXCEPTION_TYPES) {
      const q = P5_BATCH6_EXCEPTION_DEFINITIONS[t].default_queue;
      expect(P5_BATCH6_REVIEW_QUEUES).toContain(q);
    }
  });
});

describe("P-5 Batch 6 — priorities (P0–P4)", () => {
  it("contains exactly P0..P4 in order", () => {
    expect([...P5_BATCH6_PRIORITIES]).toEqual(["P0", "P1", "P2", "P3", "P4"]);
  });

  it("sort_order is strictly increasing P0→P4 (lower = higher priority)", () => {
    const orders = P5_BATCH6_PRIORITIES.map(
      (p) => P5_BATCH6_PRIORITY_DEFINITIONS[p].sort_order,
    );
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1]);
    }
  });

  it("P0 and P1 downgrades require approval; P2–P4 do not", () => {
    expect(P5_BATCH6_PRIORITY_DEFINITIONS.P0.downgrade_requires_approval).toBe(true);
    expect(P5_BATCH6_PRIORITY_DEFINITIONS.P1.downgrade_requires_approval).toBe(true);
    expect(P5_BATCH6_PRIORITY_DEFINITIONS.P2.downgrade_requires_approval).toBe(false);
  });

  it("P0 escalates fastest (≤ P1 ≤ P2 ≤ P3)", () => {
    const order: Array<"P0"|"P1"|"P2"|"P3"> = ["P0","P1","P2","P3"];
    for (let i = 1; i < order.length; i++) {
      expect(P5_BATCH6_PRIORITY_DEFINITIONS[order[i]].escalate_after_working_hours)
        .toBeGreaterThanOrEqual(P5_BATCH6_PRIORITY_DEFINITIONS[order[i - 1]].escalate_after_working_hours);
    }
  });
});

describe("P-5 Batch 6 — statuses", () => {
  it("contains ≥21 unique controlled statuses", () => {
    expect(P5_BATCH6_STATUSES.length).toBeGreaterThanOrEqual(21);
    expect(new Set(P5_BATCH6_STATUSES).size).toBe(P5_BATCH6_STATUSES.length);
  });

  it("terminal statuses are a strict subset", () => {
    for (const t of P5_BATCH6_TERMINAL_STATUSES) {
      expect(P5_BATCH6_STATUSES).toContain(t);
    }
    expect(P5_BATCH6_TERMINAL_STATUSES).toContain("resolved");
    expect(P5_BATCH6_TERMINAL_STATUSES).toContain("tombstoned_legal");
  });

  it("every exception type's default status is a registered status", () => {
    for (const t of P5_BATCH6_EXCEPTION_TYPES) {
      const s = P5_BATCH6_EXCEPTION_DEFINITIONS[t].default_status;
      expect(P5_BATCH6_STATUSES).toContain(s);
    }
  });
});

describe("P-5 Batch 6 — dispute states (13 incl. closed_superseded)", () => {
  it("contains all 13 client-approved dispute states", () => {
    expect(P5_BATCH6_DISPUTE_STATES.length).toBe(13);
    for (const s of [
      "dispute_raised",
      "initial_triage",
      "under_review",
      "awaiting_evidence",
      "awaiting_counterparty_response",
      "escalated",
      "proposed_resolution",
      "resolved_upheld",
      "resolved_partially_upheld",
      "resolved_dismissed",
      "withdrawn",
      "closed_corrected",
      "closed_superseded",
    ] as const) {
      expect(P5_BATCH6_DISPUTE_STATES).toContain(s);
    }
  });

  it("active (non-resolved) dispute states pause Memory; resolved states do not", () => {
    for (const s of P5_BATCH6_DISPUTE_STATES_PAUSE_MEMORY) {
      expect(P5_BATCH6_DISPUTE_STATES).toContain(s);
    }
    expect(P5_BATCH6_DISPUTE_STATES_PAUSE_MEMORY).not.toContain("resolved_dismissed");
    expect(P5_BATCH6_DISPUTE_STATES_PAUSE_MEMORY).not.toContain("closed_corrected");
    expect(P5_BATCH6_DISPUTE_STATES_PAUSE_MEMORY).not.toContain("closed_superseded");
    expect(P5_BATCH6_DISPUTE_STATES_PAUSE_MEMORY).not.toContain("withdrawn");
  });
});

describe("P-5 Batch 6 — note types (10, immutable)", () => {
  it("contains all 10 note types", () => {
    expect(P5_BATCH6_NOTE_TYPES.length).toBe(10);
    for (const n of [
      "resolution_reason",
      "override_waiver_reason",
      "rejection_reason",
      "compliance_hold_note",
      "priority_change_reason",
      "assignment_note",
      "evidence_request_note",
      "dispute_review_note",
      "correction_supersession_note",
      "security_access_note",
    ] as const) {
      expect(P5_BATCH6_NOTE_TYPES).toContain(n);
    }
  });

  it("only assignment_note is reason-optional", () => {
    expect(P5_BATCH6_NOTE_TYPES_REQUIRE_REASON).not.toContain("assignment_note");
    for (const n of P5_BATCH6_NOTE_TYPES.filter((x) => x !== "assignment_note")) {
      expect(P5_BATCH6_NOTE_TYPES_REQUIRE_REASON).toContain(n);
    }
  });
});

describe("P-5 Batch 6 — audit events (p5b6.* prefix, append-only contract)", () => {
  it("every event uses the p5b6. prefix", () => {
    expect(P5_BATCH6_AUDIT_EVENTS.length).toBeGreaterThanOrEqual(30);
    for (const e of P5_BATCH6_AUDIT_EVENTS) {
      expect(e.startsWith("p5b6.")).toBe(true);
    }
  });

  it("covers the mandatory action surface", () => {
    for (const e of [
      "p5b6.exception.created",
      "p5b6.exception.status_changed",
      "p5b6.exception.priority_changed",
      "p5b6.exception.resolved",
      "p5b6.exception.reopened",
      "p5b6.override.approved",
      "p5b6.dispute.raised",
      "p5b6.dispute.resolved",
      "p5b6.finality.under_dispute_marked",
      "p5b6.memory.reuse_paused",
      "p5b6.export.report_generated",
      "p5b6.exception.tombstone_legal_redaction",
    ] as const) {
      expect(P5_BATCH6_AUDIT_EVENTS).toContain(e);
    }
  });

  it("events requiring before/after are a subset of the audit-event list", () => {
    for (const e of P5_BATCH6_AUDIT_EVENTS_REQUIRE_BEFORE_AFTER) {
      expect(P5_BATCH6_AUDIT_EVENTS).toContain(e);
    }
  });
});

describe("P-5 Batch 6 — reports (13)", () => {
  it("contains all 13 client-approved reports", () => {
    expect(P5_BATCH6_REPORTS.length).toBe(13);
    for (const r of [
      "open_exceptions","overdue_sla","critical_blockers","evidence_gap",
      "compliance_hold_and_waiver","manual_override_waiver","dispute",
      "provider_dependency_incident","payment_reconciliation_exception",
      "finality_blocker","memory_review_and_correction","audit_export",
      "exception_trend",
    ] as const) {
      expect(P5_BATCH6_REPORTS).toContain(r);
    }
  });

  it("every report definition must emit an audit event on export", () => {
    for (const r of P5_BATCH6_REPORTS) {
      expect(P5_BATCH6_REPORT_DEFINITIONS[r].emits_audit_event).toBe(true);
    }
  });

  it("audit_export and compliance reports are restricted", () => {
    expect(P5_BATCH6_REPORT_DEFINITIONS.audit_export.restricted).toBe(true);
    expect(P5_BATCH6_REPORT_DEFINITIONS.compliance_hold_and_waiver.restricted).toBe(true);
    expect(P5_BATCH6_REPORT_DEFINITIONS.dispute.restricted).toBe(true);
  });
});

describe("P-5 Batch 6 — external wording governance", () => {
  it("declares the 5 approved external-safe messages", () => {
    expect(Object.keys(P5_BATCH6_EXTERNAL_SAFE_MESSAGES).length).toBeGreaterThanOrEqual(5);
    for (const k of ["ACTION_REQUIRED_EVIDENCE","UNDER_REVIEW_COMPLIANCE","TEMPORARILY_BLOCKED_PROVIDER","UNDER_DISPUTE","RESOLVED"] as const) {
      expect(P5_BATCH6_EXTERNAL_SAFE_MESSAGES[k]).toBeTruthy();
    }
  });

  it("banned external wording list contains the client-listed forbidden phrases", () => {
    for (const phrase of ["fraud","suspicious","sanctions hit","pep match","blacklist","internal risk","manual bypass","compliance failure"] as const) {
      expect(P5_BATCH6_BANNED_EXTERNAL_WORDING).toContain(phrase);
    }
  });

  it("no banned phrase appears inside the approved external-safe messages", () => {
    const blob = Object.values(P5_BATCH6_EXTERNAL_SAFE_MESSAGES).join(" ").toLowerCase();
    for (const banned of P5_BATCH6_BANNED_EXTERNAL_WORDING) {
      expect(blob).not.toContain(banned.toLowerCase());
    }
  });
});

describe("P-5 Batch 6 — API-safe contract (Phase 4 will enforce)", () => {
  it("API-safe fields include schema_version and exception_status", () => {
    expect(P5_BATCH6_API_SAFE_FIELDS).toContain("schema_version");
    expect(P5_BATCH6_API_SAFE_FIELDS).toContain("exception_status");
    expect(P5_BATCH6_API_SAFE_FIELDS).toContain("safe_message");
  });

  it("API-safe statuses cover dispute/finality/reliance surface", () => {
    for (const s of ["finality_under_dispute","finality_blocked","reliance_paused","reliance_available","dispute_open"] as const) {
      expect(P5_BATCH6_API_SAFE_STATUSES).toContain(s);
    }
  });

  it("forbidden external fields cover raw payloads, secrets and internal notes", () => {
    for (const f of ["raw_provider_payload","bank_account_number","api_key","webhook_secret","internal_notes","private_notes","funder_private_commentary","draft_ai_suggestion"] as const) {
      expect(P5_BATCH6_FORBIDDEN_EXTERNAL_FIELDS).toContain(f);
    }
  });
});
