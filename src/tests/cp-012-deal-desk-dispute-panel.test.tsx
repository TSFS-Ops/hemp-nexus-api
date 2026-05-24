/**
 * CP-012 — Deal Desk dispute panel proof.
 *
 * Pins the exact text and controls that must render on
 * /desk/match/:matchId when an engagement is in
 * `disputed_being_named`. This is the route Daniel actually
 * tests; admin-side fixtures are covered separately.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ error: null })) },
  },
}));

import {
  MatchDisputeBeingNamedPanel,
  CP012_INITIATOR_MESSAGE,
  CP012_COUNTERPARTY_MESSAGE,
  CP012_ADMIN_MESSAGE,
} from "@/components/match/MatchDisputeBeingNamedPanel";

const BASE = {
  engagementId: "cd661af0-95fe-4268-bf2d-5d20b505b134",
  engagementStatus: "disputed_being_named" as const,
  operationalState: "disputed_being_named",
  counterpartyResponse: "disputes_being_named",
};

describe("CP-012 — /desk/match deal-desk dispute panel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows status, counterparty_response, and DISPUTE_ACTIVE badges", () => {
    render(
      <MatchDisputeBeingNamedPanel
        {...BASE}
        viewerRole="initiator"
        isPlatformAdmin={false}
      />,
    );
    expect(screen.getByTestId("cp012-status-badge")).toHaveTextContent(
      "Status: disputed_being_named",
    );
    expect(
      screen.getByTestId("cp012-counterparty-response-badge"),
    ).toHaveTextContent("Counterparty response: disputes_being_named");
    expect(screen.getByTestId("cp012-dispute-active-badge")).toHaveTextContent(
      "DISPUTE_ACTIVE",
    );
  });

  it("renders the exact initiator message for the initiator viewer", () => {
    render(
      <MatchDisputeBeingNamedPanel
        {...BASE}
        viewerRole="initiator"
        isPlatformAdmin={false}
      />,
    );
    expect(screen.getByTestId("cp012-initiator-message")).toHaveTextContent(
      CP012_INITIATOR_MESSAGE,
    );
    // Counterparty + admin copy must NOT leak to the initiator.
    expect(screen.queryByTestId("cp012-counterparty-message")).toBeNull();
    expect(screen.queryByTestId("cp012-admin-block")).toBeNull();
  });

  it("renders the exact counterparty message for the counterparty viewer", () => {
    render(
      <MatchDisputeBeingNamedPanel
        {...BASE}
        viewerRole="counterparty"
        isPlatformAdmin={false}
      />,
    );
    expect(screen.getByTestId("cp012-counterparty-message")).toHaveTextContent(
      CP012_COUNTERPARTY_MESSAGE,
    );
    expect(screen.queryByTestId("cp012-admin-block")).toBeNull();
  });

  it("renders the exact admin message + Release/Close controls for platform_admin", () => {
    render(
      <MatchDisputeBeingNamedPanel
        {...BASE}
        viewerRole="initiator"
        isPlatformAdmin
      />,
    );
    expect(screen.getByTestId("cp012-admin-message")).toHaveTextContent(
      CP012_ADMIN_MESSAGE,
    );
    expect(screen.getByTestId("cp012-release-button")).toBeInTheDocument();
    expect(screen.getByTestId("cp012-close-button")).toBeInTheDocument();
  });

  it("hides Release/Close for non-platform-admin users", () => {
    render(
      <MatchDisputeBeingNamedPanel
        {...BASE}
        viewerRole="counterparty"
        isPlatformAdmin={false}
      />,
    );
    expect(screen.queryByTestId("cp012-release-button")).toBeNull();
    expect(screen.queryByTestId("cp012-close-button")).toBeNull();
  });

  it("declares POI/WaD/execution/credit-burn are blocked by DISPUTE_ACTIVE", () => {
    render(
      <MatchDisputeBeingNamedPanel
        {...BASE}
        viewerRole="initiator"
        isPlatformAdmin={false}
      />,
    );
    const note = screen.getByTestId("cp012-progression-block-note");
    expect(note.textContent ?? "").toMatch(/DISPUTE_ACTIVE/);
    for (const word of ["POI", "WaD", "execution", "credit burn"]) {
      expect(note.textContent ?? "").toContain(word);
    }
  });

  it("never renders the 'unrecognised state' fallback wording", () => {
    const { container } = render(
      <MatchDisputeBeingNamedPanel
        {...BASE}
        viewerRole="initiator"
        isPlatformAdmin
      />,
    );
    expect(container.textContent ?? "").not.toMatch(/unrecognised state/i);
  });

  it("Release routes to dispute-release endpoint", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
      <MatchDisputeBeingNamedPanel
        {...BASE}
        viewerRole="initiator"
        isPlatformAdmin
      />,
    );
    await user.click(screen.getByTestId("cp012-release-button"));
    const textarea = await screen.findByLabelText("Resolution reason");
    await user.type(textarea, "Release for retest verification");
    await user.click(screen.getByTestId("cp012-resolution-submit"));
    expect(invoke).toHaveBeenCalledWith(
      `poi-engagements/${BASE.engagementId}/dispute-release`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("Close routes to dispute-close endpoint", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
      <MatchDisputeBeingNamedPanel
        {...BASE}
        viewerRole="initiator"
        isPlatformAdmin
      />,
    );
    await user.click(screen.getByTestId("cp012-close-button"));
    const textarea = await screen.findByLabelText("Resolution reason");
    await user.type(textarea, "Close after admin review");
    await user.click(screen.getByTestId("cp012-resolution-submit"));
    expect(invoke).toHaveBeenCalledWith(
      `poi-engagements/${BASE.engagementId}/dispute-close`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});
