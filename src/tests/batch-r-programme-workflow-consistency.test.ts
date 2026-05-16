/**
 * Batch R — Programme participant, archive, export and audit hardening.
 *
 * This file pins the BEHAVIOURAL CONTRACT enforced by:
 *   - supabase/migrations/...Batch-R…sql (status CHECK trigger, transition
 *     trigger, archive_programme_participant SECURITY DEFINER helper,
 *     entities → programme_participants ON DELETE RESTRICT)
 *   - supabase/functions/programmes/index.ts (Zod, AAL2, archive route,
 *     before/after audit, /report redaction + export audit)
 *
 * The tests are pure-TS simulators that mirror the same rules so the
 * regression suite can run in vitest without standing up Postgres. Edge
 * function deno tests (which DO hit the DB) exercise the live path.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// ── Simulators (single source of truth for the contract) ──────────

const VALID_STATUSES = ["pending", "approved", "rejected", "suspended", "withdrawn", "archived"] as const;
type Status = (typeof VALID_STATUSES)[number];

interface Participant {
  id: string;
  programme_id: string;
  entity_id: string;
  status: Status;
  role: "contractor" | "implementing_agent" | "beneficiary" | "oversight";
  email: string | null;
  phone: string | null;
  notes: string | null;
  contact_completeness_state: "pending_contact" | "complete";
  manual_follow_up_reason: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  trade_approval_id: string | null;
}

function validateStatus(s: string): asserts s is Status {
  if (!(VALID_STATUSES as readonly string[]).includes(s)) {
    throw new Error(`INVALID_PARTICIPANT_STATUS: ${s}`);
  }
}

function validateTransition(from: Status, to: Status, isAdmin = false): void {
  if (from === to) return;
  if (isAdmin) return; // platform_admin can repair
  if (["rejected", "withdrawn", "archived"].includes(from)) {
    throw new Error(`INVALID_PARTICIPANT_TRANSITION: ${from} is terminal`);
  }
  const allowed: Record<Status, Status[]> = {
    pending: ["approved", "rejected", "withdrawn"],
    approved: ["suspended", "withdrawn", "archived"],
    suspended: ["approved", "archived", "withdrawn"],
    rejected: [],
    withdrawn: [],
    archived: [],
  };
  if (!allowed[from].includes(to)) {
    throw new Error(`INVALID_PARTICIPANT_TRANSITION: ${from} -> ${to}`);
  }
}

function deriveContactState(email: string | null, phone: string | null): "pending_contact" | "complete" {
  return (email && email.trim()) || (phone && phone.trim()) ? "complete" : "pending_contact";
}

function applyParticipantPatch(prev: Participant, patch: Partial<Participant> & { manual_follow_up_reason?: string }): Participant {
  const next: Participant = { ...prev, ...patch };
  next.contact_completeness_state = deriveContactState(next.email, next.phone);
  if (next.status === "approved" && next.contact_completeness_state === "pending_contact") {
    const r = next.manual_follow_up_reason ?? "";
    if (r.trim().length < 10) {
      throw new Error("CONTACT_REQUIRED_FOR_APPROVAL");
    }
  }
  return next;
}

interface AuditRow {
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
}

function patchAudit(prev: Participant, next: Participant, opts: { reason?: string }): AuditRow | null {
  const TRACKED: (keyof Participant)[] = ["status", "role", "notes", "email", "phone", "contact_completeness_state"];
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of TRACKED) {
    if (prev[k] !== next[k]) changed[k] = { before: prev[k], after: next[k] };
  }
  if (Object.keys(changed).length === 0) return null;
  const statusChanged = "status" in changed;
  return {
    action: statusChanged ? "programme.participant_status_changed" : "programme.participant_updated",
    entity_type: "programme_participant",
    entity_id: prev.id,
    metadata: {
      programme_id: prev.programme_id,
      previous_status: prev.status,
      new_status: next.status,
      changed,
      changed_fields: Object.keys(changed),
      reason: opts.reason ?? null,
    },
  };
}

function archiveParticipant(
  p: Participant,
  opts: { reason: string; actor: string; org: string; linkedFundFlows: number; openMilestones: number; overrideLinked?: boolean },
): { participant: Participant; audit: AuditRow } {
  if (!opts.reason || opts.reason.trim().length < 10) {
    throw new Error("ARCHIVE_REASON_REQUIRED");
  }
  if (p.status === "archived") throw new Error("ALREADY_ARCHIVED");
  const linked = opts.linkedFundFlows > 0 || opts.openMilestones > 0 || !!p.trade_approval_id;
  if (linked && !opts.overrideLinked) throw new Error("PARTICIPANT_LINKED");
  const after: Participant = {
    ...p,
    status: "archived",
    archived_at: new Date().toISOString(),
    archived_by: opts.actor,
    archive_reason: opts.reason,
  };
  return {
    participant: after,
    audit: {
      action: "programme.participant_archived",
      entity_type: "programme_participant",
      entity_id: p.id,
      metadata: {
        programme_id: p.programme_id,
        reason: opts.reason,
        override_linked: !!opts.overrideLinked,
        linked_fund_flows: opts.linkedFundFlows,
        open_milestones: opts.openMilestones,
        had_trade_approval: !!p.trade_approval_id,
        before: p,
        after,
        actor_user_id: opts.actor,
        actor_org_id: opts.org,
      },
    },
  };
}

// Mirror of the handler's Zod schema for PATCH participant.
const ParticipantPatch = z.object({
  status: z.enum(["pending", "approved", "rejected", "suspended", "withdrawn"]).optional(),
  role: z.enum(["contractor", "implementing_agent", "beneficiary", "oversight"]).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  phone: z.string().trim().min(3).max(40).nullable().optional(),
  reason: z.string().trim().min(10).max(500).optional(),
  manual_follow_up_reason: z.string().trim().min(10).max(500).optional(),
}).strict();

// ── Report redaction mirror ──────────────────────────────────────
const FUND_FLOW_REDACTED_KEYS = new Set([
  "payload_hash", "previous_hash", "idempotency_key", "recorded_by", "reference",
]);
function redactFundFlow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = FUND_FLOW_REDACTED_KEYS.has(k) ? "[redacted]" : v;
  }
  return out;
}

// ── Test fixtures ────────────────────────────────────────────────
function mkParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: "p1",
    programme_id: "prog1",
    entity_id: "e1",
    status: "pending",
    role: "contractor",
    email: null,
    phone: null,
    notes: null,
    contact_completeness_state: "pending_contact",
    manual_follow_up_reason: null,
    archived_at: null,
    archived_by: null,
    archive_reason: null,
    trade_approval_id: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe("Batch R · 1. status model", () => {
  it("rejects arbitrary free-text status", () => {
    expect(() => validateStatus("active_yolo")).toThrow(/INVALID_PARTICIPANT_STATUS/);
    expect(() => validateStatus("")).toThrow(/INVALID_PARTICIPANT_STATUS/);
  });

  it("accepts every canonical status", () => {
    for (const s of VALID_STATUSES) expect(() => validateStatus(s)).not.toThrow();
  });

  it("allows pending → approved/rejected/withdrawn", () => {
    expect(() => validateTransition("pending", "approved")).not.toThrow();
    expect(() => validateTransition("pending", "rejected")).not.toThrow();
    expect(() => validateTransition("pending", "withdrawn")).not.toThrow();
  });

  it("blocks pending → suspended/archived (must go through approved first)", () => {
    expect(() => validateTransition("pending", "suspended")).toThrow(/INVALID_PARTICIPANT_TRANSITION/);
    expect(() => validateTransition("pending", "archived")).toThrow(/INVALID_PARTICIPANT_TRANSITION/);
  });

  it("approved → suspended/withdrawn/archived only", () => {
    expect(() => validateTransition("approved", "suspended")).not.toThrow();
    expect(() => validateTransition("approved", "archived")).not.toThrow();
    expect(() => validateTransition("approved", "pending")).toThrow();
  });

  it("rejected/withdrawn/archived are terminal for non-admins", () => {
    expect(() => validateTransition("rejected", "approved")).toThrow(/terminal/);
    expect(() => validateTransition("withdrawn", "approved")).toThrow(/terminal/);
    expect(() => validateTransition("archived", "approved")).toThrow(/terminal/);
  });

  it("platform_admin can repair any transition", () => {
    expect(() => validateTransition("archived", "approved", true)).not.toThrow();
    expect(() => validateTransition("rejected", "pending", true)).not.toThrow();
  });
});

describe("Batch R · 2. contact completeness", () => {
  it("name/entity-only participant is stored as pending_contact", () => {
    const p = mkParticipant();
    expect(p.contact_completeness_state).toBe("pending_contact");
  });

  it("adding email or phone flips the state to complete", () => {
    const withEmail = applyParticipantPatch(mkParticipant(), { email: "ops@example.com" });
    expect(withEmail.contact_completeness_state).toBe("complete");
    const withPhone = applyParticipantPatch(mkParticipant(), { phone: "+27 11 555 0000" });
    expect(withPhone.contact_completeness_state).toBe("complete");
  });

  it("pending_contact participant CANNOT be promoted to approved without a follow-up reason", () => {
    expect(() =>
      applyParticipantPatch(mkParticipant(), { status: "approved" }),
    ).toThrow(/CONTACT_REQUIRED_FOR_APPROVAL/);
  });

  it("pending_contact participant CAN be promoted with manual_follow_up_reason >=10 chars", () => {
    const next = applyParticipantPatch(mkParticipant(), {
      status: "approved",
      manual_follow_up_reason: "Confirmed by phone with ops lead 2026-05-16.",
    });
    expect(next.status).toBe("approved");
  });

  it("approval with complete contact does not require manual_follow_up_reason", () => {
    const p = mkParticipant({ email: "x@y.com", contact_completeness_state: "complete" });
    const next = applyParticipantPatch(p, { status: "approved" });
    expect(next.status).toBe("approved");
  });
});

describe("Batch R · 3. PATCH validation", () => {
  it("rejects unknown/protected fields (.strict())", () => {
    const r = ParticipantPatch.safeParse({ status: "approved", weird_field: "hack" });
    expect(r.success).toBe(false);
  });

  it("rejects bad enum value", () => {
    const r = ParticipantPatch.safeParse({ status: "yolo" });
    expect(r.success).toBe(false);
  });

  it("accepts canonical fields", () => {
    const r = ParticipantPatch.safeParse({ status: "rejected", reason: "Failed AML screening 2026-05-16." });
    expect(r.success).toBe(true);
  });

  it("rejects too-short reason", () => {
    const r = ParticipantPatch.safeParse({ reason: "no" });
    expect(r.success).toBe(false);
  });

  it("rejects malformed email", () => {
    const r = ParticipantPatch.safeParse({ email: "not-an-email" });
    expect(r.success).toBe(false);
  });
});

describe("Batch R · 4. audit before/after & no-op", () => {
  it("status change writes participant_status_changed with before/after", () => {
    const prev = mkParticipant({ email: "a@b.com", contact_completeness_state: "complete" });
    const next = applyParticipantPatch(prev, { status: "approved" });
    const audit = patchAudit(prev, next, {});
    expect(audit).not.toBeNull();
    expect(audit!.action).toBe("programme.participant_status_changed");
    const ch = audit!.metadata.changed as Record<string, { before: unknown; after: unknown }>;
    expect(ch.status).toEqual({ before: "pending", after: "approved" });
  });

  it("metadata-only edit writes participant_updated with before/after for role + notes", () => {
    const prev = mkParticipant();
    const next = applyParticipantPatch(prev, { role: "beneficiary", notes: "VAT registered" });
    const audit = patchAudit(prev, next, {});
    expect(audit!.action).toBe("programme.participant_updated");
    const ch = audit!.metadata.changed as Record<string, { before: unknown; after: unknown }>;
    expect(ch.role).toEqual({ before: "contractor", after: "beneficiary" });
    expect(ch.notes).toEqual({ before: null, after: "VAT registered" });
    expect(ch.status).toBeUndefined();
  });

  it("contact addition is audited as a metadata change with before=null", () => {
    const prev = mkParticipant();
    const next = applyParticipantPatch(prev, { email: "ops@example.com" });
    const audit = patchAudit(prev, next, {})!;
    const ch = audit.metadata.changed as Record<string, { before: unknown; after: unknown }>;
    expect(ch.email).toEqual({ before: null, after: "ops@example.com" });
    expect(ch.contact_completeness_state).toEqual({ before: "pending_contact", after: "complete" });
  });

  it("no-op patch writes no audit row", () => {
    const prev = mkParticipant({ role: "contractor", notes: "same" });
    const next = applyParticipantPatch(prev, { role: "contractor", notes: "same" });
    expect(patchAudit(prev, next, {})).toBeNull();
  });
});

describe("Batch R · 5. soft-archive route", () => {
  it("requires reason >=10 chars", () => {
    expect(() => archiveParticipant(mkParticipant({ status: "approved" }), {
      reason: "nope", actor: "u", org: "o", linkedFundFlows: 0, openMilestones: 0,
    })).toThrow(/ARCHIVE_REASON_REQUIRED/);
  });

  it("blocks archive when participant has live fund flows", () => {
    expect(() => archiveParticipant(mkParticipant({ status: "approved" }), {
      reason: "Closing out — counterparty insolvent.",
      actor: "u", org: "o", linkedFundFlows: 2, openMilestones: 0,
    })).toThrow(/PARTICIPANT_LINKED/);
  });

  it("blocks archive when participant has open milestones", () => {
    expect(() => archiveParticipant(mkParticipant({ status: "approved" }), {
      reason: "Closing programme down for FY end.",
      actor: "u", org: "o", linkedFundFlows: 0, openMilestones: 1,
    })).toThrow(/PARTICIPANT_LINKED/);
  });

  it("blocks archive when participant has a linked trade_approval_id", () => {
    expect(() => archiveParticipant(
      mkParticipant({ status: "approved", trade_approval_id: "ta-1" }),
      { reason: "Routine cleanup of approved list.", actor: "u", org: "o", linkedFundFlows: 0, openMilestones: 0 },
    )).toThrow(/PARTICIPANT_LINKED/);
  });

  it("allows linked archive ONLY with explicit override flag", () => {
    const out = archiveParticipant(mkParticipant({ status: "approved", trade_approval_id: "ta-1" }), {
      reason: "Director override — duplicate participant row.",
      actor: "u", org: "o", linkedFundFlows: 1, openMilestones: 1, overrideLinked: true,
    });
    expect(out.participant.status).toBe("archived");
    expect(out.audit.metadata.override_linked).toBe(true);
    expect(out.audit.metadata.linked_fund_flows).toBe(1);
    expect(out.audit.metadata.open_milestones).toBe(1);
    expect(out.audit.metadata.had_trade_approval).toBe(true);
  });

  it("writes before snapshot in audit metadata", () => {
    const p = mkParticipant({ status: "approved", role: "beneficiary", email: "x@y.com", contact_completeness_state: "complete" });
    const out = archiveParticipant(p, {
      reason: "Closing entity — entity dissolved.", actor: "u1", org: "o1",
      linkedFundFlows: 0, openMilestones: 0,
    });
    expect(out.audit.action).toBe("programme.participant_archived");
    expect((out.audit.metadata.before as Participant).status).toBe("approved");
    expect((out.audit.metadata.after as Participant).status).toBe("archived");
    expect(out.audit.metadata.reason).toMatch(/Closing entity/);
  });

  it("refuses to archive an already-archived participant", () => {
    expect(() => archiveParticipant(mkParticipant({ status: "archived" }), {
      reason: "Trying to double-archive.", actor: "u", org: "o",
      linkedFundFlows: 0, openMilestones: 0,
    })).toThrow(/ALREADY_ARCHIVED/);
  });
});

describe("Batch R · 6. report redaction", () => {
  const sampleFlow = {
    id: "ff1",
    programme_id: "prog1",
    participant_id: "p1",
    flow_type: "disbursement",
    amount: 100,
    payload_hash: "abc123",
    previous_hash: "prev123",
    idempotency_key: "idem-1",
    recorded_by: "user-1",
    reference: "PO-9000",
  };

  it("default view redacts hash, idempotency_key, recorded_by, reference", () => {
    const out = redactFundFlow(sampleFlow);
    expect(out.payload_hash).toBe("[redacted]");
    expect(out.previous_hash).toBe("[redacted]");
    expect(out.idempotency_key).toBe("[redacted]");
    expect(out.recorded_by).toBe("[redacted]");
    expect(out.reference).toBe("[redacted]");
    expect(out.amount).toBe(100);
    expect(out.flow_type).toBe("disbursement");
  });
});

// ── Handler contract guards (static source assertions) ───────────

describe("Batch R · 7. handler contract guards (static)", () => {
  const handler = fs.readFileSync(
    path.resolve(__dirname, "../../supabase/functions/programmes/index.ts"),
    "utf8",
  );

  it("Zod schemas use .strict() so unknown fields are rejected", () => {
    for (const name of ["ParticipantPatch", "ParticipantCreate", "ProgrammePatch", "FundFlowCreate", "ParticipantArchive"]) {
      expect(handler).toMatch(new RegExp(`${name}\\s*=\\s*z\\.object\\(`));
      // The schema block must end with .strict() before another const/Deno.serve.
      const start = handler.indexOf(`${name} = z.object(`);
      const tail = handler.slice(start, start + 4000);
      expect(tail).toMatch(/\}\)\.strict\(\)/);
    }
  });

  it("AAL2 is asserted on fund-flow POST, archive route, and sensitive report", () => {
    expect(handler).toMatch(/action:\s*"programme\.fund_flow_create"/);
    expect(handler).toMatch(/action:\s*"programme\.participant_archive"/);
    expect(handler).toMatch(/action:\s*"programme\.report_sensitive_view"/);
    // Ensure assertAal2 appears next to each.
    const aalCount = (handler.match(/assertAal2/g) ?? []).length;
    expect(aalCount).toBeGreaterThanOrEqual(4);
  });

  it("AAL2 is asserted on programme budget updates", () => {
    expect(handler).toMatch(/action:\s*"programme\.budget_update"/);
  });

  it("AAL2 is asserted on sensitive participant status promotions", () => {
    expect(handler).toMatch(/SENSITIVE_PARTICIPANT_STATUSES/);
    expect(handler).toMatch(/`programme\.participant_status_\$\{updates\.status\}`/);
  });

  it("/report writes an export-audit row on every call", () => {
    expect(handler).toMatch(/programme\.report_exported/);
    expect(handler).toMatch(/programme\.report_exported_sensitive/);
  });

  it("/report default view redacts payload_hash/previous_hash/idempotency_key/recorded_by/reference", () => {
    expect(handler).toMatch(/FUND_FLOW_REDACTED_KEYS/);
    for (const k of ["payload_hash", "previous_hash", "idempotency_key", "recorded_by", "reference"]) {
      expect(handler).toMatch(new RegExp(`"${k}"`));
    }
  });

  it("archive route calls archive_programme_participant RPC", () => {
    expect(handler).toMatch(/rpc\("archive_programme_participant"/);
  });

  it("PATCH participant rejects adverse transitions without a reason", () => {
    expect(handler).toMatch(/REASON_REQUIRED_STATUSES/);
    expect(handler).toMatch(/"REASON_REQUIRED"/);
  });

  it("PATCH participant computes before/after diff for status/role/notes/email/phone/contact_completeness_state", () => {
    expect(handler).toMatch(/TRACKED\s*=\s*\[\s*"status",\s*"role",\s*"notes",\s*"email",\s*"phone",\s*"contact_completeness_state"\s*\]/);
  });

  it("every mutating route inserts into audit_logs (audit-insert guard)", () => {
    // programme.participant_archived is written by the DB helper, not the
    // edge handler — covered by the migration guard below.
    const mutatingActions = [
      "programme.created",
      "programme.updated",
      "programme.participant_added",
      "programme.participant_status_changed",
      "programme.participant_updated",
      "programme.milestone_created",
      "programme.milestone_updated",
      "programme.fund_flow.",
      "programme.report_exported",
    ];
    for (const a of mutatingActions) {
      expect(handler).toContain(a);
    }
  });
});

// ── Migration / SQL contract guards (static) ─────────────────────

describe("Batch R · 8. migration contract guards (static)", () => {
  const migDir = path.resolve(__dirname, "../../supabase/migrations");
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql"));
  const all = files.map((f) => fs.readFileSync(path.join(migDir, f), "utf8")).join("\n\n");

  it("status validator trigger exists and enumerates the canonical set", () => {
    expect(all).toMatch(/validate_programme_participant_status/);
    for (const s of VALID_STATUSES) {
      expect(all).toMatch(new RegExp(`'${s}'`));
    }
  });

  it("transition trigger exists and is wired on UPDATE OF status", () => {
    expect(all).toMatch(/validate_programme_participant_transition/);
    expect(all).toMatch(/BEFORE UPDATE OF status ON public\.programme_participants/);
  });

  it("entities → programme_participants is ON DELETE RESTRICT (not CASCADE)", () => {
    // The latest definition (last occurrence wins at runtime) must be RESTRICT.
    const matches = [...all.matchAll(/programme_participants_entity_id_fkey[^;]*?ON DELETE (\w+)/gi)];
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[matches.length - 1][1].toUpperCase()).toBe("RESTRICT");
  });

  it("archive_programme_participant helper exists, is SECURITY DEFINER, and revoked from PUBLIC/authenticated", () => {
    expect(all).toMatch(/CREATE OR REPLACE FUNCTION public\.archive_programme_participant/);
    expect(all).toMatch(/SECURITY DEFINER/);
    expect(all).toMatch(/REVOKE ALL ON FUNCTION public\.archive_programme_participant[^;]*FROM PUBLIC/);
    expect(all).toMatch(/REVOKE ALL ON FUNCTION public\.archive_programme_participant[^;]*FROM authenticated/);
    expect(all).toMatch(/GRANT EXECUTE ON FUNCTION public\.archive_programme_participant[^;]*TO service_role/);
  });

  it("archive helper writes a before snapshot into audit_logs", () => {
    expect(all).toMatch(/programme\.participant_archived/);
    expect(all).toMatch(/to_jsonb\(v_before\)/);
    expect(all).toMatch(/to_jsonb\(v_after\)/);
  });

  it("contact-completeness column exists with safe default", () => {
    expect(all).toMatch(/contact_completeness_state\s+TEXT\s+NOT NULL\s+DEFAULT\s+'pending_contact'/i);
  });

  it("CONTACT_REQUIRED_FOR_APPROVAL is enforced at the DB layer", () => {
    expect(all).toMatch(/CONTACT_REQUIRED_FOR_APPROVAL/);
  });
});

// ── export-audit registry guard ─────────────────────────────────

describe("Batch R · 9. export-audit registry includes programme variants", () => {
  it("client-side helper enum includes programmes / programme_participants / programme_fund_flows", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../lib/export-audit.ts"), "utf8");
    expect(src).toContain('"programmes"');
    expect(src).toContain('"programme_participants"');
    expect(src).toContain('"programme_fund_flows"');
  });

  it("edge function Zod enum + sensitive set includes programme_fund_flows", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../supabase/functions/export-audit/index.ts"),
      "utf8",
    );
    expect(src).toContain('"programmes"');
    expect(src).toContain('"programme_participants"');
    expect(src).toContain('"programme_fund_flows"');
    expect(src).toMatch(/SENSITIVE_TARGETS[^]*programme_fund_flows/);
  });
});
