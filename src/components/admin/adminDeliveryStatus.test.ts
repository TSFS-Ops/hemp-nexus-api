import { describe, it, expect } from "vitest";
import {
  DELIVERY_LABELS,
  DELIVERY_STYLES,
  deliveryLabelFor,
  deliveryStyleFor,
  deriveDeliveryMap,
  type EmailSendLogRow,
} from "./adminDeliveryStatus";

/**
 * These tests cover the pure presentation derivation used by
 * AdminPendingEngagementsPanel for its delivery-status badges. They prove that
 * every supported `email_send_log.status` value renders the expected human
 * label and Tailwind pill, and that the dedupe-by-newest rule respects
 * visibility scoping.
 *
 * NO email behaviour is exercised here — this is read-only mapping logic.
 */

const E1 = "11111111-1111-4111-8111-111111111111";
const E2 = "22222222-2222-4222-8222-222222222222";
const E3 = "33333333-3333-4333-8333-333333333333";

function row(over: Partial<EmailSendLogRow>): EmailSendLogRow {
  return {
    idempotency_key: null,
    status: "pending",
    created_at: "2026-05-15T00:00:00.000Z",
    error_message: null,
    message_id: null,
    ...over,
  };
}

describe("DELIVERY_LABELS / DELIVERY_STYLES", () => {
  it.each([
    ["pending", "Queued"],
    ["sent", "Sent"],
    ["failed", "Failed"],
    ["dlq", "Dead-letter"],
    ["bounced", "Bounced"],
    ["complained", "Complained"],
    ["suppressed", "Suppressed"],
  ])("maps %s -> %s with a non-empty pill class", (status, label) => {
    expect(DELIVERY_LABELS[status]).toBe(label);
    expect(DELIVERY_STYLES[status]).toBeTruthy();
    expect(DELIVERY_STYLES[status].length).toBeGreaterThan(0);
  });

  it("uses the muted slate pill for pending (queued)", () => {
    expect(DELIVERY_STYLES.pending).toContain("slate");
  });

  it("uses the institutional emerald pill for sent (no rose/red)", () => {
    expect(DELIVERY_STYLES.sent).toContain("emerald");
    expect(DELIVERY_STYLES.sent).not.toMatch(/rose|red/);
  });

  it.each(["failed", "dlq", "bounced", "complained"])(
    "uses a rose pill for failure-class status %s",
    (s) => {
      expect(DELIVERY_STYLES[s]).toContain("rose");
    },
  );

  it("uses an amber pill for suppressed (advisory, not failure)", () => {
    expect(DELIVERY_STYLES.suppressed).toContain("amber");
    expect(DELIVERY_STYLES.suppressed).not.toContain("rose");
  });
});

describe("deliveryLabelFor / deliveryStyleFor fallbacks (unlinked / unknown)", () => {
  it("falls back to the raw status as the label when unmapped", () => {
    // The panel renders this case as the literal status string so admins are
    // never shown a "Sent" badge for a status the UI doesn't recognise.
    expect(deliveryLabelFor("not_linked")).toBe("not_linked");
    expect(deliveryLabelFor("totally-new-provider-state")).toBe(
      "totally-new-provider-state",
    );
  });

  it("falls back to a neutral slate pill (never green) for unknown status", () => {
    const cls = deliveryStyleFor("not_linked");
    expect(cls).toContain("slate");
    expect(cls).not.toContain("emerald");
    expect(cls).not.toContain("rose");
  });
});

describe("deriveDeliveryMap", () => {
  it("returns an empty map when there are no rows", () => {
    expect(deriveDeliveryMap([], new Set([E1]))).toEqual({});
  });

  it("ignores rows whose idempotency_key is missing or non-outreach", () => {
    const out = deriveDeliveryMap(
      [
        row({ idempotency_key: null, status: "sent" }),
        row({ idempotency_key: "engagement-reminder-foo", status: "sent" }),
        row({ idempotency_key: `outreach-send-${E1}-abc`, status: "sent" }),
      ],
      new Set([E1]),
    );
    expect(Object.keys(out)).toEqual([E1]);
    expect(out[E1].status).toBe("sent");
  });

  it("ignores rows for engagements that are not visible", () => {
    const out = deriveDeliveryMap(
      [row({ idempotency_key: `outreach-send-${E2}-abc`, status: "sent" })],
      new Set([E1]),
    );
    expect(out).toEqual({});
  });

  it("keeps the newest row per engagement (input is DESC by created_at)", () => {
    const out = deriveDeliveryMap(
      [
        // newest first — this should win
        row({
          idempotency_key: `outreach-send-${E1}-retry-2`,
          status: "sent",
          created_at: "2026-05-15T12:00:00.000Z",
          message_id: "msg-newest",
        }),
        row({
          idempotency_key: `outreach-send-${E1}-retry-1`,
          status: "failed",
          created_at: "2026-05-15T10:00:00.000Z",
          message_id: "msg-older",
          error_message: "transient",
        }),
      ],
      new Set([E1]),
    );
    expect(out[E1].status).toBe("sent");
    expect(out[E1].message_id).toBe("msg-newest");
    expect(out[E1].error_message).toBeNull();
  });

  it("populates each delivery state surfaced by the panel", () => {
    const out = deriveDeliveryMap(
      [
        row({ idempotency_key: `outreach-send-${E1}-x`, status: "pending" }),
        row({
          idempotency_key: `outreach-send-${E2}-x`,
          status: "failed",
          error_message: "smtp 550",
        }),
        row({ idempotency_key: `outreach-send-${E3}-x`, status: "dlq" }),
      ],
      new Set([E1, E2, E3]),
    );

    expect(out[E1].status).toBe("pending");
    expect(DELIVERY_LABELS[out[E1].status]).toBe("Queued");

    expect(out[E2].status).toBe("failed");
    expect(out[E2].error_message).toBe("smtp 550");
    expect(DELIVERY_LABELS[out[E2].status]).toBe("Failed");

    expect(out[E3].status).toBe("dlq");
    expect(DELIVERY_LABELS[out[E3].status]).toBe("Dead-letter");
  });

  it("represents 'unlinked' engagements by their absence from the map", () => {
    // The panel treats any visible engagement that is NOT a key in the
    // delivery map as 'no outreach yet' (no badge rendered). We assert that
    // contract here so a future refactor can't silently start emitting a
    // misleading default state.
    const out = deriveDeliveryMap(
      [row({ idempotency_key: `outreach-send-${E1}-x`, status: "sent" })],
      new Set([E1, E2]),
    );
    expect(E1 in out).toBe(true);
    expect(E2 in out).toBe(false);
  });

  it("preserves suppressed status verbatim from email_send_log", () => {
    const out = deriveDeliveryMap(
      [row({ idempotency_key: `outreach-send-${E1}-x`, status: "suppressed" })],
      new Set([E1]),
    );
    expect(out[E1].status).toBe("suppressed");
    expect(DELIVERY_STYLES[out[E1].status]).toContain("amber");
  });
});
