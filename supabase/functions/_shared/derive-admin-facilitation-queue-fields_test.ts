// Tests for derive-admin-facilitation-queue-fields.ts
// Pure-function unit tests + static guards proving no dispatch surface.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  aggregateOutreach,
  deriveNextAction,
  deriveQueueAgeDays,
  deriveQueueFields,
  deriveSla,
  latestDraft,
  SLA_DEFAULT_THRESHOLD_HOURS,
} from "./derive-admin-facilitation-queue-fields.ts";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.parse("2026-06-11T12:00:00.000Z");

function iso(ms: number) {
  return new Date(ms).toISOString();
}

Deno.test("deriveSla: notification_sent_at preferred over created_at", () => {
  const out = deriveSla(
    {
      id: "e1",
      engagement_status: "notification_sent",
      created_at: iso(NOW - 100 * HOUR),
      notification_sent_at: iso(NOW - 50 * HOUR),
    },
    48,
    NOW,
  );
  assertEquals(out.sla_status, "overdue");
  assertEquals(out.sla_due_at, iso(NOW - 50 * HOUR + 48 * HOUR));
});

Deno.test("deriveSla: due_soon inside last quarter of window", () => {
  const out = deriveSla(
    {
      id: "e2",
      engagement_status: "contacted",
      created_at: iso(NOW - 40 * HOUR),
    },
    48,
    NOW,
  );
  assertEquals(out.sla_status, "due_soon");
});

Deno.test("deriveSla: on_track far from due", () => {
  const out = deriveSla(
    {
      id: "e3",
      engagement_status: "notification_sent",
      created_at: iso(NOW - 1 * HOUR),
    },
    48,
    NOW,
  );
  assertEquals(out.sla_status, "on_track");
});

Deno.test("deriveSla: not_applicable for terminal statuses", () => {
  for (const s of ["accepted", "declined", "expired", "cancelled"]) {
    const out = deriveSla(
      { id: "e", engagement_status: s, created_at: iso(NOW - 100 * HOUR) },
      48,
      NOW,
    );
    assertEquals(out.sla_status, "not_applicable", `status=${s}`);
    assertEquals(out.sla_due_at, null);
  }
});

Deno.test("aggregateOutreach: returns latest by created_at and total count", () => {
  const out = aggregateOutreach([
    { engagement_id: "e", created_at: iso(NOW - 2 * HOUR), contact_method: "email", new_status: "notification_sent" },
    { engagement_id: "e", created_at: iso(NOW - 5 * HOUR), contact_method: "phone", new_status: "contacted" },
    { engagement_id: "e", created_at: iso(NOW - 1 * HOUR), contact_method: "linkedin", new_status: "contacted" },
  ]);
  assertEquals(out.outreach_count, 3);
  assertEquals(out.last_outreach_channel, "linkedin");
  assertEquals(out.last_outreach_outcome, "contacted");
  assertEquals(out.last_outreach_at, iso(NOW - 1 * HOUR));
});

Deno.test("aggregateOutreach: empty input is safe", () => {
  const out = aggregateOutreach([]);
  assertEquals(out.outreach_count, 0);
  assertEquals(out.last_outreach_at, null);
  assertEquals(out.last_outreach_channel, null);
  assertEquals(out.last_outreach_outcome, null);
});

Deno.test("latestDraft: picks latest by created_at", () => {
  const d = latestDraft([
    { engagement_id: "e", status: "rejected", created_at: iso(NOW - 5 * HOUR) },
    { engagement_id: "e", status: "approved", created_at: iso(NOW - 1 * HOUR) },
    { engagement_id: "e", status: "pending_review", created_at: iso(NOW - 3 * HOUR) },
  ]);
  assert(d);
  assertEquals(d!.status, "approved");
});

Deno.test("deriveQueueAgeDays: floor of (now - created) in days, never negative", () => {
  assertEquals(
    deriveQueueAgeDays({ id: "e", engagement_status: "x", created_at: iso(NOW - 3 * DAY - HOUR) }, NOW),
    3,
  );
  assertEquals(
    deriveQueueAgeDays({ id: "e", engagement_status: "x", created_at: iso(NOW + 5 * HOUR) }, NOW),
    0,
  );
});

Deno.test("deriveNextAction: blocked_ineligible wins over everything", () => {
  const out = deriveNextAction({
    eng: { id: "e", engagement_status: "notification_sent", created_at: iso(NOW) },
    sla: "overdue",
    outreachCount: 0,
    draftStatus: "approved",
    orgEligible: false,
  });
  assertEquals(out.next_action_label, "blocked_ineligible");
});

Deno.test("deriveNextAction: binding_review_required beats sla/draft", () => {
  const out = deriveNextAction({
    eng: {
      id: "e",
      engagement_status: "notification_sent",
      operational_state: "binding_review_required",
      created_at: iso(NOW),
    },
    sla: "overdue",
    outreachCount: 0,
    draftStatus: "approved",
    orgEligible: true,
  });
  assertEquals(out.next_action_label, "binding_review_required");
});

Deno.test("deriveNextAction: accepted/declined map to terminal labels", () => {
  assertEquals(
    deriveNextAction({
      eng: { id: "e", engagement_status: "accepted", created_at: iso(NOW) },
      sla: "not_applicable",
      outreachCount: 1,
      draftStatus: null,
      orgEligible: true,
    }).next_action_label,
    "accepted",
  );
  assertEquals(
    deriveNextAction({
      eng: { id: "e", engagement_status: "declined", created_at: iso(NOW) },
      sla: "not_applicable",
      outreachCount: 0,
      draftStatus: null,
      orgEligible: true,
    }).next_action_label,
    "declined",
  );
});

Deno.test("deriveNextAction: overdue beats draft and outreach states", () => {
  const out = deriveNextAction({
    eng: { id: "e", engagement_status: "notification_sent", created_at: iso(NOW) },
    sla: "overdue",
    outreachCount: 0,
    draftStatus: "pending_review",
    orgEligible: true,
  });
  assertEquals(out.next_action_label, "overdue");
});

Deno.test("deriveNextAction: draft_approved_manual_send when approved draft exists and not overdue", () => {
  const out = deriveNextAction({
    eng: { id: "e", engagement_status: "notification_sent", created_at: iso(NOW) },
    sla: "on_track",
    outreachCount: 0,
    draftStatus: "approved",
    orgEligible: true,
  });
  assertEquals(out.next_action_label, "draft_approved_manual_send");
});

Deno.test("deriveNextAction: no_outreach_logged when no draft and no logs", () => {
  const out = deriveNextAction({
    eng: { id: "e", engagement_status: "notification_sent", created_at: iso(NOW) },
    sla: "on_track",
    outreachCount: 0,
    draftStatus: null,
    orgEligible: true,
  });
  assertEquals(out.next_action_label, "no_outreach_logged");
});

Deno.test("deriveNextAction: waiting_on_counterparty when status=contacted", () => {
  const out = deriveNextAction({
    eng: { id: "e", engagement_status: "contacted", created_at: iso(NOW) },
    sla: "on_track",
    outreachCount: 2,
    draftStatus: null,
    orgEligible: true,
  });
  assertEquals(out.next_action_label, "waiting_on_counterparty");
});

Deno.test("deriveQueueFields: approved draft ⇒ manual_send_required=true and approved_draft_available=true", () => {
  const out = deriveQueueFields({
    engagement: {
      id: "e",
      engagement_status: "notification_sent",
      created_at: iso(NOW - 10 * HOUR),
    },
    outreachLogs: [],
    drafts: [
      { engagement_id: "e", status: "approved", created_at: iso(NOW - HOUR) },
    ],
    thresholdHours: 48,
    nowMs: NOW,
  });
  assertEquals(out.approved_draft_available, true);
  assertEquals(out.manual_send_required, true);
  assertEquals(out.draft_status, "approved");
  assertEquals(out.next_action_label, "draft_approved_manual_send");
});

Deno.test("deriveQueueFields: default threshold is 48h", () => {
  assertEquals(SLA_DEFAULT_THRESHOLD_HOURS, 48);
  const out = deriveQueueFields({
    engagement: { id: "e", engagement_status: "notification_sent", created_at: iso(NOW - 49 * HOUR) },
    outreachLogs: [],
    drafts: [],
    nowMs: NOW,
  });
  assertEquals(out.sla_status, "overdue");
});

Deno.test("static guard: helper source contains no dispatch tokens", async () => {
  const src = await Deno.readTextFile(
    new URL("./derive-admin-facilitation-queue-fields.ts", import.meta.url),
  );
  // Strip comments — boundary documentation MAY name forbidden tokens.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n")
    .toLowerCase();
  const forbidden = [
    "notification-dispatch",
    "send-transactional-email",
    "process-email-queue",
    "engagement-reminder",
    "functions.invoke",
    "resend.",
    "sendgrid",
    "twilio",
    "smtp",
    "fetch(",
    "supabase.from(",
  ];
  for (const tok of forbidden) {
    assert(!code.includes(tok), `forbidden token in helper code: ${tok}`);
  }
});
