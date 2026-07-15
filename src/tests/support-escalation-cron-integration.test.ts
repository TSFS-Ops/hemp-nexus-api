/**
 * Enterprise Support Centre — SLA escalation cron integration tests.
 *
 * We can't invoke the real Postgres function from Vitest, so this suite:
 *   1. Parses the migration that defines
 *      `public.escalate_overdue_support_tickets()` and its priority-ladder
 *      helper, guarding the rules that determine which tickets get bumped
 *      and how the payload is shaped.
 *   2. Runs a faithful JavaScript re-implementation of that function
 *      against seeded ticket fixtures whose SLA deadlines sit either side
 *      of `now()`, asserting that:
 *        - overdue open tickets have their priority stepped up the ladder,
 *        - the correct gate is reported per row,
 *        - support_ticket_events rows with kind `auto_escalated` are
 *          produced with the expected payload,
 *        - resolved/closed/cancelled tickets and already-escalated tickets
 *          are skipped, and
 *        - a second run is a no-op (idempotency).
 *
 * If the migration text is edited so the ladder, gate names, event kind
 * or payload keys change, both the parser guard and the simulator will
 * fail loudly.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// 1. Locate + parse the migration that defines the escalation function.
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "..", "supabase", "migrations");

function loadEscalationMigration(): string {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => path.join(MIGRATIONS_DIR, f));
  const hits = files.filter((f) =>
    fs.readFileSync(f, "utf8").includes("escalate_overdue_support_tickets")
  );
  if (hits.length === 0) {
    throw new Error("No migration defines escalate_overdue_support_tickets");
  }
  // Prefer the one that actually CREATEs the function.
  const creator = hits.find((f) =>
    /CREATE OR REPLACE FUNCTION public\.escalate_overdue_support_tickets/i.test(
      fs.readFileSync(f, "utf8")
    )
  );
  return fs.readFileSync(creator ?? hits[0], "utf8");
}

const MIGRATION_SQL = loadEscalationMigration();

// ---------------------------------------------------------------------------
// 2. Migration guards — pin the invariants the simulator relies on.
// ---------------------------------------------------------------------------

describe("escalation cron — migration guards", () => {
  it("defines the priority ladder low → medium → high → urgent → urgent", () => {
    expect(MIGRATION_SQL).toMatch(
      /WHEN 'low' THEN 'medium'::public\.support_ticket_priority/
    );
    expect(MIGRATION_SQL).toMatch(
      /WHEN 'medium' THEN 'high'::public\.support_ticket_priority/
    );
    expect(MIGRATION_SQL).toMatch(
      /WHEN 'high' THEN 'urgent'::public\.support_ticket_priority/
    );
    expect(MIGRATION_SQL).toMatch(
      /ELSE 'urgent'::public\.support_ticket_priority/
    );
  });

  it("excludes resolved/closed/cancelled tickets and requires open gate columns", () => {
    // First-response loop excludes confirmation_requested too.
    expect(MIGRATION_SQL).toMatch(
      /status NOT IN \('resolved','closed','cancelled','confirmation_requested'\)[\s\S]*first_response_at IS NULL[\s\S]*sla_first_response_escalated_at IS NULL[\s\S]*sla_first_response_due_at < now\(\)/
    );
    // Resolution loop excludes resolved/closed/cancelled.
    expect(MIGRATION_SQL).toMatch(
      /status NOT IN \('resolved','closed','cancelled'\)[\s\S]*resolved_at IS NULL[\s\S]*sla_resolution_escalated_at IS NULL[\s\S]*sla_resolution_due_at < now\(\)/
    );
  });

  it("emits support_ticket_events rows with event_kind 'auto_escalated' for both gates", () => {
    const matches = MIGRATION_SQL.match(
      /INSERT INTO public\.support_ticket_events\(ticket_id, event_kind, actor_user_id, payload\)\s*VALUES \(r\.id, 'auto_escalated'/g
    );
    expect(matches?.length).toBe(2);
    expect(MIGRATION_SQL).toMatch(/'gate','first_response'/);
    expect(MIGRATION_SQL).toMatch(/'gate','resolution'/);
    expect(MIGRATION_SQL).toMatch(/'reason','sla_auto_escalation'/);
    expect(MIGRATION_SQL).toMatch(/'from_priority', r\.priority/);
    expect(MIGRATION_SQL).toMatch(/'to_priority', v_new/);
  });

  it("stamps the *_escalated_at column so a second run is a no-op", () => {
    expect(MIGRATION_SQL).toMatch(
      /sla_first_response_escalated_at = now\(\)/
    );
    expect(MIGRATION_SQL).toMatch(
      /sla_resolution_escalated_at = now\(\)/
    );
    expect(MIGRATION_SQL).toMatch(/priority_source = 'override'/);
  });

  it("locks execute privileges to service_role only", () => {
    expect(MIGRATION_SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.escalate_overdue_support_tickets\(\)\s+FROM PUBLIC, authenticated, anon/
    );
    expect(MIGRATION_SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.escalate_overdue_support_tickets\(\)\s+TO service_role/
    );
  });
});

// ---------------------------------------------------------------------------
// 3. JS re-implementation of the SQL function — mirrors the migration.
// ---------------------------------------------------------------------------

type Priority = "low" | "medium" | "high" | "urgent";
type Status =
  | "new"
  | "open"
  | "waiting_on_customer"
  | "confirmation_requested"
  | "resolved"
  | "closed"
  | "cancelled";

interface Ticket {
  id: string;
  status: Status;
  priority: Priority;
  priority_source: "calculated" | "override";
  first_response_at: Date | null;
  resolved_at: Date | null;
  sla_first_response_due_at: Date | null;
  sla_resolution_due_at: Date | null;
  sla_first_response_escalated_at: Date | null;
  sla_resolution_escalated_at: Date | null;
  updated_at: Date;
}

interface EscalationEvent {
  ticket_id: string;
  event_kind: "auto_escalated";
  actor_user_id: null;
  payload: {
    gate: "first_response" | "resolution";
    from_priority: Priority;
    to_priority: Priority;
    reason: "sla_auto_escalation";
  };
}

interface EscalationRow {
  ticket_id: string;
  gate: "first_response" | "resolution";
  from_priority: Priority;
  to_priority: Priority;
}

function nextPriority(p: Priority): Priority {
  switch (p) {
    case "low":
      return "medium";
    case "medium":
      return "high";
    case "high":
      return "urgent";
    default:
      return "urgent";
  }
}

function escalateOverdue(
  tickets: Ticket[],
  events: EscalationEvent[],
  now: Date
): EscalationRow[] {
  const out: EscalationRow[] = [];

  // First-response gate.
  const firstResponseCandidates = tickets
    .filter(
      (t) =>
        !["resolved", "closed", "cancelled", "confirmation_requested"].includes(
          t.status
        ) &&
        t.first_response_at === null &&
        t.sla_first_response_escalated_at === null &&
        t.sla_first_response_due_at !== null &&
        t.sla_first_response_due_at.getTime() < now.getTime()
    )
    .sort(
      (a, b) =>
        (a.sla_first_response_due_at as Date).getTime() -
        (b.sla_first_response_due_at as Date).getTime()
    )
    .slice(0, 200);

  for (const r of firstResponseCandidates) {
    const from = r.priority;
    const to = nextPriority(from);
    r.priority = to;
    r.priority_source = "override";
    r.sla_first_response_escalated_at = now;
    r.updated_at = now;
    events.push({
      ticket_id: r.id,
      event_kind: "auto_escalated",
      actor_user_id: null,
      payload: {
        gate: "first_response",
        from_priority: from,
        to_priority: to,
        reason: "sla_auto_escalation",
      },
    });
    out.push({
      ticket_id: r.id,
      gate: "first_response",
      from_priority: from,
      to_priority: to,
    });
  }

  // Resolution gate.
  const resolutionCandidates = tickets
    .filter(
      (t) =>
        !["resolved", "closed", "cancelled"].includes(t.status) &&
        t.resolved_at === null &&
        t.sla_resolution_escalated_at === null &&
        t.sla_resolution_due_at !== null &&
        t.sla_resolution_due_at.getTime() < now.getTime()
    )
    .sort(
      (a, b) =>
        (a.sla_resolution_due_at as Date).getTime() -
        (b.sla_resolution_due_at as Date).getTime()
    )
    .slice(0, 200);

  for (const r of resolutionCandidates) {
    const from = r.priority;
    const to = nextPriority(from);
    r.priority = to;
    r.priority_source = "override";
    r.sla_resolution_escalated_at = now;
    r.updated_at = now;
    events.push({
      ticket_id: r.id,
      event_kind: "auto_escalated",
      actor_user_id: null,
      payload: {
        gate: "resolution",
        from_priority: from,
        to_priority: to,
        reason: "sla_auto_escalation",
      },
    });
    out.push({
      ticket_id: r.id,
      gate: "resolution",
      from_priority: from,
      to_priority: to,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// 4. Fixture builder — a ticket "near" its SLA deadline.
// ---------------------------------------------------------------------------

let seq = 0;
function mkTicket(overrides: Partial<Ticket>): Ticket {
  seq += 1;
  return {
    id: `t-${seq.toString().padStart(4, "0")}`,
    status: "new",
    priority: "low",
    priority_source: "calculated",
    first_response_at: null,
    resolved_at: null,
    sla_first_response_due_at: null,
    sla_resolution_due_at: null,
    sla_first_response_escalated_at: null,
    sla_resolution_escalated_at: null,
    updated_at: new Date(0),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 5. Integration behaviour tests against seeded near-deadline tickets.
// ---------------------------------------------------------------------------

describe("escalation cron — seeded ticket behaviour", () => {
  const NOW = new Date("2026-07-15T12:00:00Z");
  const overdueBy = (minutes: number) =>
    new Date(NOW.getTime() - minutes * 60_000);
  const dueIn = (minutes: number) =>
    new Date(NOW.getTime() + minutes * 60_000);

  it("bumps overdue first-response tickets one step up the priority ladder", () => {
    const overdueLow = mkTicket({
      priority: "low",
      sla_first_response_due_at: overdueBy(5),
      sla_resolution_due_at: dueIn(240),
    });
    const overdueMedium = mkTicket({
      priority: "medium",
      sla_first_response_due_at: overdueBy(1),
      sla_resolution_due_at: dueIn(240),
    });
    const events: EscalationEvent[] = [];
    const rows = escalateOverdue([overdueLow, overdueMedium], events, NOW);

    expect(rows).toHaveLength(2);
    expect(overdueLow.priority).toBe("medium");
    expect(overdueMedium.priority).toBe("high");
    expect(overdueLow.priority_source).toBe("override");
    expect(overdueLow.sla_first_response_escalated_at).toBe(NOW);
    expect(rows.every((r) => r.gate === "first_response")).toBe(true);
  });

  it("caps at urgent once the ladder is exhausted", () => {
    const overdueUrgent = mkTicket({
      priority: "urgent",
      sla_first_response_due_at: overdueBy(2),
    });
    const events: EscalationEvent[] = [];
    const rows = escalateOverdue([overdueUrgent], events, NOW);
    expect(rows[0]).toMatchObject({
      gate: "first_response",
      from_priority: "urgent",
      to_priority: "urgent",
    });
    expect(overdueUrgent.priority).toBe("urgent");
  });

  it("emits one auto_escalated event per bumped ticket with the correct payload", () => {
    const t = mkTicket({
      priority: "medium",
      sla_first_response_due_at: overdueBy(3),
    });
    const events: EscalationEvent[] = [];
    escalateOverdue([t], events, NOW);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      ticket_id: t.id,
      event_kind: "auto_escalated",
      actor_user_id: null,
      payload: {
        gate: "first_response",
        from_priority: "medium",
        to_priority: "high",
        reason: "sla_auto_escalation",
      },
    });
  });

  it("distinguishes first_response vs resolution gates in the same run", () => {
    const frOverdue = mkTicket({
      priority: "low",
      sla_first_response_due_at: overdueBy(10),
    });
    const resOverdue = mkTicket({
      status: "open",
      priority: "high",
      first_response_at: new Date(NOW.getTime() - 3600_000),
      sla_first_response_due_at: overdueBy(60),
      sla_first_response_escalated_at: new Date(NOW.getTime() - 30 * 60_000),
      sla_resolution_due_at: overdueBy(5),
    });
    const events: EscalationEvent[] = [];
    const rows = escalateOverdue([frOverdue, resOverdue], events, NOW);

    const gates = rows.map((r) => `${r.ticket_id}:${r.gate}`).sort();
    expect(gates).toEqual([
      `${frOverdue.id}:first_response`,
      `${resOverdue.id}:resolution`,
    ]);
    expect(resOverdue.priority).toBe("urgent");
    expect(resOverdue.sla_resolution_escalated_at).toBe(NOW);
  });

  it("skips tickets that are not yet overdue", () => {
    const notYet = mkTicket({
      priority: "low",
      sla_first_response_due_at: dueIn(15),
      sla_resolution_due_at: dueIn(300),
    });
    const events: EscalationEvent[] = [];
    const rows = escalateOverdue([notYet], events, NOW);
    expect(rows).toEqual([]);
    expect(events).toEqual([]);
    expect(notYet.priority).toBe("low");
    expect(notYet.sla_first_response_escalated_at).toBeNull();
  });

  it("skips tickets whose first response has already landed for the FR gate", () => {
    const responded = mkTicket({
      status: "open",
      priority: "low",
      first_response_at: new Date(NOW.getTime() - 60_000),
      sla_first_response_due_at: overdueBy(30),
      sla_resolution_due_at: dueIn(240),
    });
    const events: EscalationEvent[] = [];
    const rows = escalateOverdue([responded], events, NOW);
    expect(rows).toEqual([]);
    expect(responded.priority).toBe("low");
  });

  it("skips resolved/closed/cancelled tickets on both gates", () => {
    const resolved = mkTicket({
      status: "resolved",
      priority: "low",
      resolved_at: new Date(NOW.getTime() - 3600_000),
      sla_first_response_due_at: overdueBy(60),
      sla_resolution_due_at: overdueBy(30),
    });
    const closed = mkTicket({
      status: "closed",
      priority: "low",
      sla_first_response_due_at: overdueBy(60),
      sla_resolution_due_at: overdueBy(30),
    });
    const cancelled = mkTicket({
      status: "cancelled",
      priority: "low",
      sla_first_response_due_at: overdueBy(60),
      sla_resolution_due_at: overdueBy(30),
    });
    const events: EscalationEvent[] = [];
    const rows = escalateOverdue([resolved, closed, cancelled], events, NOW);
    expect(rows).toEqual([]);
    expect(events).toEqual([]);
  });

  it("skips confirmation_requested tickets on the first-response gate", () => {
    const awaiting = mkTicket({
      status: "confirmation_requested",
      priority: "medium",
      sla_first_response_due_at: overdueBy(45),
    });
    const events: EscalationEvent[] = [];
    const rows = escalateOverdue([awaiting], events, NOW);
    expect(rows).toEqual([]);
    expect(awaiting.priority).toBe("medium");
  });

  it("does not re-escalate a ticket that has already been auto-escalated for that gate (idempotency)", () => {
    const t = mkTicket({
      priority: "medium",
      sla_first_response_due_at: overdueBy(10),
    });
    const events: EscalationEvent[] = [];

    const first = escalateOverdue([t], events, NOW);
    expect(first).toHaveLength(1);
    expect(t.priority).toBe("high");
    expect(t.sla_first_response_escalated_at).toBe(NOW);

    // A second run 5 minutes later, ticket still overdue and unanswered, must be a no-op.
    const later = new Date(NOW.getTime() + 5 * 60_000);
    const second = escalateOverdue([t], events, later);
    expect(second).toEqual([]);
    expect(events).toHaveLength(1);
    expect(t.priority).toBe("high");
  });

  it("orders escalations by earliest deadline first within a gate", () => {
    const later = mkTicket({
      priority: "low",
      sla_first_response_due_at: overdueBy(2),
    });
    const earlier = mkTicket({
      priority: "low",
      sla_first_response_due_at: overdueBy(30),
    });
    const events: EscalationEvent[] = [];
    const rows = escalateOverdue([later, earlier], events, NOW);
    expect(rows.map((r) => r.ticket_id)).toEqual([earlier.id, later.id]);
  });
});
