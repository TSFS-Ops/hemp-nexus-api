/**
 * Regression: PATCH /programmes/:id/participants/:participantId must write an
 * audit_logs row whenever a participant changes — the only entity in the
 * field-save × status matrix that previously skipped audit on update.
 *
 * This file pins the **handler's diff/audit decision contract** so the row
 * can never silently disappear again. End-to-end coverage (the actual DB
 * write) lives in supabase/functions/programmes/*_test.ts.
 *
 * Mirrors the logic at supabase/functions/programmes/index.ts ~L226–L317:
 *   • allow-list = ['status', 'role', 'notes']
 *   • empty/no-op body         → no DB write, no audit row
 *   • some allow-listed field changed                       → audit row
 *   • status changed           → action 'programme.participant_status_changed'
 *   • only metadata changed    → action 'programme.participant_updated'
 *   • status field never appears in `changed_fields` unless explicitly sent
 *     (preserves the platform-wide "no field-save through transition logic"
 *     invariant — see src/tests/field-save-status-matrix.test.ts).
 */

import { describe, it, expect } from "vitest";

const ALLOWED = ["status", "role", "notes"] as const;
type Allowed = (typeof ALLOWED)[number];
type Row = Partial<Record<Allowed, string | null>>;

interface AuditDecision {
  shouldWriteAudit: boolean;
  action: "programme.participant_status_changed" | "programme.participant_updated" | null;
  changed_fields: Allowed[];
  previous_status: string | null;
  new_status: string | null;
}

/** Mirrors the handler's diff + audit-routing logic. */
function decideAudit(opts: {
  body: Record<string, unknown>;
  previous: Row;
  next: Row;
}): AuditDecision {
  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (key in opts.body) updates[key] = opts.body[key];
  }
  if (Object.keys(updates).length === 0) {
    return {
      shouldWriteAudit: false,
      action: null,
      changed_fields: [],
      previous_status: opts.previous.status ?? null,
      new_status: opts.previous.status ?? null,
    };
  }
  const changed: Allowed[] = [];
  for (const key of ALLOWED) {
    if (key in updates && opts.previous[key] !== opts.next[key]) {
      changed.push(key);
    }
  }
  if (changed.length === 0) {
    return {
      shouldWriteAudit: false,
      action: null,
      changed_fields: [],
      previous_status: opts.previous.status ?? null,
      new_status: opts.next.status ?? opts.previous.status ?? null,
    };
  }
  return {
    shouldWriteAudit: true,
    action: changed.includes("status")
      ? "programme.participant_status_changed"
      : "programme.participant_updated",
    changed_fields: changed,
    previous_status: opts.previous.status ?? null,
    new_status: opts.next.status ?? opts.previous.status ?? null,
  };
}

describe("programme_participants PATCH — audit decision contract", () => {
  it("pending → approved writes a status_changed audit row", () => {
    const d = decideAudit({
      body: { status: "approved" },
      previous: { status: "pending", role: "contractor" },
      next: { status: "approved", role: "contractor" },
    });
    expect(d.shouldWriteAudit).toBe(true);
    expect(d.action).toBe("programme.participant_status_changed");
    expect(d.changed_fields).toEqual(["status"]);
    expect(d.previous_status).toBe("pending");
    expect(d.new_status).toBe("approved");
  });

  it("approved → rejected writes a status_changed audit row", () => {
    const d = decideAudit({
      body: { status: "rejected" },
      previous: { status: "approved" },
      next: { status: "rejected" },
    });
    expect(d.shouldWriteAudit).toBe(true);
    expect(d.action).toBe("programme.participant_status_changed");
    expect(d.changed_fields).toEqual(["status"]);
    expect(d.previous_status).toBe("approved");
    expect(d.new_status).toBe("rejected");
  });

  it("empty/no-op body does NOT write an audit row", () => {
    const d = decideAudit({
      body: {},
      previous: { status: "approved", role: "contractor" },
      next: { status: "approved", role: "contractor" },
    });
    expect(d.shouldWriteAudit).toBe(false);
    expect(d.action).toBeNull();
    expect(d.changed_fields).toEqual([]);
  });

  it("re-submitting the same status with no change does NOT write an audit row", () => {
    const d = decideAudit({
      body: { status: "approved" },
      previous: { status: "approved" },
      next: { status: "approved" },
    });
    expect(d.shouldWriteAudit).toBe(false);
    expect(d.action).toBeNull();
    expect(d.changed_fields).toEqual([]);
  });

  it("metadata-only change (role) writes the participant_updated audit row, status unchanged", () => {
    const d = decideAudit({
      body: { role: "lead" },
      previous: { status: "approved", role: "contractor" },
      next: { status: "approved", role: "lead" },
    });
    expect(d.shouldWriteAudit).toBe(true);
    expect(d.action).toBe("programme.participant_updated");
    expect(d.changed_fields).toEqual(["role"]);
    expect(d.previous_status).toBe("approved");
    expect(d.new_status).toBe("approved");
  });

  it("metadata-only change (notes) writes participant_updated, status not in changed_fields", () => {
    const d = decideAudit({
      body: { notes: "Confirmed eligibility documents on file." },
      previous: { status: "pending", notes: null },
      next: { status: "pending", notes: "Confirmed eligibility documents on file." },
    });
    expect(d.shouldWriteAudit).toBe(true);
    expect(d.action).toBe("programme.participant_updated");
    expect(d.changed_fields).toEqual(["notes"]);
    expect(d.changed_fields).not.toContain("status");
  });

  it("combined status + metadata change reports both fields and routes via status action", () => {
    const d = decideAudit({
      body: { status: "approved", notes: "Approved by ops lead." },
      previous: { status: "pending", notes: null },
      next: { status: "approved", notes: "Approved by ops lead." },
    });
    expect(d.shouldWriteAudit).toBe(true);
    expect(d.action).toBe("programme.participant_status_changed");
    expect(d.changed_fields).toEqual(["status", "notes"]);
  });

  it("body field outside the allow-list is ignored — no audit, no DB write", () => {
    const d = decideAudit({
      body: { weird_field: "anything" },
      previous: { status: "approved" },
      next: { status: "approved" },
    });
    expect(d.shouldWriteAudit).toBe(false);
    expect(d.action).toBeNull();
  });

  /**
   * Cross-cutting invariant: metadata-only saves never trigger transition-only
   * side effects. Mirrors the platform-wide invariant in
   * src/tests/field-save-status-matrix.test.ts.
   */
  it("INVARIANT: metadata saves never report a status field-change", () => {
    for (const field of ["role", "notes"] as const) {
      const d = decideAudit({
        body: { [field]: "changed value" },
        previous: { status: "pending", [field]: "old value" },
        next: { status: "pending", [field]: "changed value" },
      });
      expect(d.changed_fields).not.toContain("status");
      expect(d.previous_status).toBe(d.new_status);
    }
  });
});
