/**
 * Phase 2 UI compatibility tests for GovernanceEventDrawer / normaliseEventStore.
 *
 * Verifies the drawer surfaces the new canonical payload keys (posture,
 * policy_version, source_function, correlation_id, request_id) written by
 * the backend governance-audit writer, and falls back to "Not recorded"
 * for legacy event_store rows that lack them.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GovernanceEventDrawer } from "@/components/admin/governance/GovernanceEventDrawer";
import { normaliseEventStore } from "@/lib/governance/governance-record";

function eventStoreRow(payload: Record<string, unknown>) {
  return {
    id: "es_1",
    occurred_at: "2026-05-24T10:00:00Z",
    event_type: "poi.state_changed",
    aggregate_type: "poi",
    aggregate_id: "agg-1",
    org_id: "org-1",
    actor_id: "user-1",
    actor_role: "platform_admin",
    payload,
  };
}

describe("GovernanceEventDrawer Phase 2 canonical fields", () => {
  it("renders policy_version, source_function, correlation_id, request_id from event_store payload", () => {
    const event = normaliseEventStore(
      eventStoreRow({
        posture: "Standard",
        policy_version: "v3.2",
        source_function: "poi-transition",
        correlation_id: "corr-abc",
        request_id: "req-xyz",
        previous_state: "DRAFT",
        new_state: "ELIGIBLE",
      }),
    );
    render(<GovernanceEventDrawer event={event} open={true} onClose={() => {}} />);
    expect(screen.getByText("v3.2")).toBeInTheDocument();
    expect(screen.getByText("poi-transition")).toBeInTheDocument();
    expect(screen.getByText("corr-abc")).toBeInTheDocument();
    expect(screen.getByText("req-xyz")).toBeInTheDocument();
    // Posture badge / row populated:
    expect(screen.getAllByText("Standard").length).toBeGreaterThan(0);
  });

  it('falls back to "Not recorded" for legacy event_store rows without Phase 2 keys', () => {
    const event = normaliseEventStore(eventStoreRow({ from_state: "DRAFT", to_state: "ELIGIBLE" }));
    render(<GovernanceEventDrawer event={event} open={true} onClose={() => {}} />);
    // 4 Phase 2 rows + others that are missing should all read "Not recorded".
    // We only assert presence (count is ≥1) to avoid coupling to other rows.
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThanOrEqual(4);
  });

  it("never displays raw provider payloads or secret-named keys", () => {
    const event = normaliseEventStore(
      eventStoreRow({
        api_key: "sk_live_should_never_appear",
        raw_payload: { card_number: "4111111111111111" },
        posture: "Standard",
      }),
    );
    render(<GovernanceEventDrawer event={event} open={true} onClose={() => {}} />);
    expect(screen.queryByText(/sk_live_should_never_appear/)).not.toBeInTheDocument();
    expect(screen.queryByText(/4111111111111111/)).not.toBeInTheDocument();
  });
});
