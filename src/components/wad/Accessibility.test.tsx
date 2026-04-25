/**
 * Accessibility tests for the attestation flow.
 *
 * These lock down the screen-reader contract for two distinct surfaces:
 *
 *   1. The attest error region — must be an aria-live alert so the
 *      message is announced as soon as the failed attestation lands,
 *      AND focus must move to it so keyboard users can immediately reach
 *      the "Copy Ref" / "Retry" controls without scrolling.
 *
 *   2. The progress stepper "Next" panel — must be an aria-live status
 *      region so the announcement updates politely as the consequence
 *      state advances (canAttest → hasAttested → canSeal → sealed),
 *      without stealing focus.
 *
 * We use @testing-library/react throughout so the assertions describe
 * what an assistive-tech user actually perceives, not implementation
 * details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { WadStepper } from "./WadStepper";
import { AttestationProgressStepper } from "./AttestationProgressStepper";
import type {
  ConsequenceState,
  WadAttestation,
  WadRecord,
} from "@/lib/modules/consequence";
import type { Tables } from "@/integrations/supabase/types";

// ─── Module mocks (mirror WadStepper.test.tsx) ───────────────────────
const submitAttestationMock = vi.fn();

vi.mock("@/lib/modules/consequence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/modules/consequence")>();
  return {
    ...actual,
    submitAttestation: (...args: unknown[]) => submitAttestationMock(...args),
    sealWad: vi.fn(),
    downloadCertificate: vi.fn(),
    triggerBlobDownload: vi.fn(),
    resolveAttestationRole: vi.fn(() => "buyer_signatory"),
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ─── Fixtures ────────────────────────────────────────────────────────
const makeWad = (overrides: Partial<WadRecord> = {}): WadRecord =>
  ({
    id: "wad-1",
    poi_id: "poi-1",
    status: "draft",
    evidence_bundle: null,
    seal_hash: null,
    sealed_at: null,
    created_at: "2025-01-01T00:00:00Z",
    buyer_org_id: "org-buyer",
    seller_org_id: "org-seller",
    revoked_reason: null,
    attestations: [],
    ...overrides,
  }) as unknown as WadRecord;

const makeMatch = (): Tables<"matches"> =>
  ({ id: "match-1", buyer_name: "Acme Buyer", seller_name: "Globex Seller" } as unknown as Tables<"matches">);

const makeState = (overrides: Partial<ConsequenceState> = {}): ConsequenceState =>
  ({
    canAttest: true,
    hasAttested: false,
    canSeal: false,
    canDownloadCertificate: false,
    canRevoke: false,
    isTerminal: false,
    allAttested: false,
    canCreate: false,
    createBlockedReasons: [],
    attestations: { buyerAttested: false, sellerAttested: false, total: 0 },
    uiStatus: "draft",
    statusLabel: "Draft",
    wad: null,
    ...overrides,
  }) as unknown as ConsequenceState;

const buyerAttestation = (): WadAttestation =>
  ({
    id: "att-1",
    wad_id: "wad-1",
    user_id: "u-buyer",
    org_id: "org-buyer",
    role: "buyer_signatory",
    attested_name: "Jane Buyer",
    attested_at: "2025-04-01T10:00:00Z",
    attestation_text: "I confirm",
  });

// Drives the form to the "ready to submit" state, then submits once and
// waits for the resulting alert (or absence of one) to settle so the
// async submitAttestation state update lands inside an act() boundary.
async function submitOnceAndWait() {
  fireEvent.click(screen.getByRole("button", { name: /review & attest/i }));
  fireEvent.change(screen.getByLabelText(/your full name/i), {
    target: { value: "Jane Doe" },
  });
  fireEvent.click(screen.getByLabelText(/i confirm that this is not a contract/i));
  fireEvent.click(screen.getByTestId("attest-submit-button"));
  // Let the mocked promise + setState pair flush.
  await waitFor(() => {
    // Either the alert appears (failure path) or attesting flips back to
    // false (success path). We just need the microtask queue to drain.
    expect(submitAttestationMock).toHaveBeenCalled();
  });
}

// ──────────────────────────────────────────────────────────────────────
// 1. Attest error: aria-live announcement + focus movement
// ──────────────────────────────────────────────────────────────────────
describe("Attest error a11y", () => {
  beforeEach(() => {
    submitAttestationMock.mockReset();
    sessionStorage.clear();
  });

  it("exposes the failure as an assertive aria-live alert with the error text", async () => {
    submitAttestationMock.mockResolvedValueOnce({
      success: false,
      error: "Attestation failed",
      requestId: "req-abc-123",
      errorKind: "server_error",
    });

    render(
      <WadStepper
        wad={makeWad()}
        match={makeMatch()}
        consequenceState={makeState()}
        userOrgId="org-buyer"
        onUpdate={() => {}}
      />,
    );
    await submitOnce();

    // The alert must be discoverable by its semantic role — that's the
    // only contract screen readers actually consume.
    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.getAttribute("aria-atomic")).toBe("true");

    // The announcement text bundles message + reference id together
    // (aria-atomic="true" means the SR will read the whole region as one
    // utterance), so we assert both are present in the same node.
    expect(
      within(alert).getAllByText(/Attestation failed/i).length,
    ).toBeGreaterThan(0);
    expect(within(alert).getByText("req-abc-123")).toBeInTheDocument();
  });

  it("moves keyboard focus to the alert when the error first appears", async () => {
    submitAttestationMock.mockResolvedValueOnce({
      success: false,
      error: "Boom",
      requestId: "req-1",
      errorKind: "server_error",
    });

    render(
      <WadStepper
        wad={makeWad()}
        match={makeMatch()}
        consequenceState={makeState()}
        userOrgId="org-buyer"
        onUpdate={() => {}}
      />,
    );
    await submitOnce();

    const alert = await screen.findByTestId("attest-error-alert");
    await waitFor(() => expect(document.activeElement).toBe(alert));

    // The alert is programmatically focusable (tabIndex=-1) but NOT in
    // the natural tab order, so subsequent Tab presses still advance to
    // the Copy Ref / Retry controls.
    expect(alert.getAttribute("tabindex")).toBe("-1");
  });

  it("does not steal focus on unrelated re-renders while the same error is shown", async () => {
    submitAttestationMock.mockResolvedValueOnce({
      success: false,
      error: "Boom",
      requestId: "req-1",
      errorKind: "server_error",
    });

    const { rerender } = render(
      <WadStepper
        wad={makeWad()}
        match={makeMatch()}
        consequenceState={makeState()}
        userOrgId="org-buyer"
        onUpdate={() => {}}
      />,
    );
    await submitOnce();
    await screen.findByTestId("attest-error-alert");

    // User Tabs away to the Copy Ref control.
    const copyButton = screen.getByRole("button", { name: /^copy$/i });
    copyButton.focus();
    expect(document.activeElement).toBe(copyButton);

    // An unrelated re-render (e.g. parent passing a new but equivalent
    // consequenceState reference) MUST NOT yank focus back to the alert.
    rerender(
      <WadStepper
        wad={makeWad()}
        match={makeMatch()}
        consequenceState={makeState()}
        userOrgId="org-buyer"
        onUpdate={() => {}}
      />,
    );

    expect(document.activeElement).toBe(copyButton);
  });

  it("re-focuses the alert when a *new* error (different requestId) arrives", async () => {
    submitAttestationMock.mockResolvedValueOnce({
      success: false,
      error: "First failure",
      requestId: "req-first",
      errorKind: "server_error",
    });

    render(
      <WadStepper
        wad={makeWad()}
        match={makeMatch()}
        consequenceState={makeState()}
        userOrgId="org-buyer"
        onUpdate={() => {}}
      />,
    );
    await submitOnce();
    let alert = await screen.findByTestId("attest-error-alert");
    await waitFor(() => expect(document.activeElement).toBe(alert));

    // User moves focus elsewhere.
    const retryBtn = screen.getByTestId("attest-submit-button") as HTMLButtonElement;
    retryBtn.focus();
    expect(document.activeElement).toBe(retryBtn);

    // Second submission fails with a *different* requestId — focus
    // should jump back to the freshly mounted alert region so the new
    // failure isn't missed.
    submitAttestationMock.mockResolvedValueOnce({
      success: false,
      error: "Second failure",
      requestId: "req-second",
      errorKind: "server_error",
    });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      alert = screen.getByTestId("attest-error-alert");
      expect(within(alert).getByText("req-second")).toBeInTheDocument();
    });
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });
});

// ──────────────────────────────────────────────────────────────────────
// 2. Progress stepper: aria-live announcements for state advancement
// ──────────────────────────────────────────────────────────────────────
describe("Attestation progress a11y announcements", () => {
  function renderStepper(state: ConsequenceState, wad: WadRecord = makeWad()) {
    return render(
      <AttestationProgressStepper
        wad={wad}
        consequenceState={state}
        buyerName="Acme Buyer"
        sellerName="Globex Seller"
        userOrgId="org-buyer"
      />,
    );
  }

  it("announces the next action via a polite aria-live status region", () => {
    renderStepper(makeState({ canAttest: true }));

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    // The full announcement is collapsed into the aria-label so it's
    // read as one utterance regardless of internal markup.
    expect(status.getAttribute("aria-label")).toMatch(/^Next: Attest now\./);
  });

  it("updates the status announcement as the state advances (attest → await → seal → sealed)", () => {
    // Stage 1: viewer needs to attest.
    const { rerender } = renderStepper(makeState({ canAttest: true }));
    expect(screen.getByRole("status").getAttribute("aria-label")).toMatch(/Attest now/);

    // Stage 2: viewer has attested, awaiting counterparty.
    rerender(
      <AttestationProgressStepper
        wad={makeWad({ attestations: [buyerAttestation()] })}
        consequenceState={makeState({
          canAttest: false,
          hasAttested: true,
          attestations: { buyerAttested: true, sellerAttested: false, total: 1 },
        })}
        buyerName="Acme Buyer"
        sellerName="Globex Seller"
        userOrgId="org-buyer"
      />,
    );
    expect(screen.getByRole("status").getAttribute("aria-label")).toMatch(
      /Awaiting other party/,
    );

    // Stage 3: both parties attested — ready to seal.
    rerender(
      <AttestationProgressStepper
        wad={makeWad({ attestations: [buyerAttestation()] })}
        consequenceState={makeState({
          canAttest: false,
          hasAttested: true,
          allAttested: true,
          canSeal: true,
          attestations: { buyerAttested: true, sellerAttested: true, total: 2 },
        })}
        buyerName="Acme Buyer"
        sellerName="Globex Seller"
        userOrgId="org-buyer"
      />,
    );
    expect(screen.getByRole("status").getAttribute("aria-label")).toMatch(
      /Seal Signed Deal/,
    );

    // Stage 4: sealed.
    rerender(
      <AttestationProgressStepper
        wad={makeWad({
          status: "sealed",
          sealed_at: "2025-04-02T12:00:00Z",
          seal_hash: "deadbeef",
          attestations: [buyerAttestation()],
        })}
        consequenceState={makeState({
          uiStatus: "sealed",
          statusLabel: "Sealed",
          canDownloadCertificate: true,
          allAttested: true,
          attestations: { buyerAttested: true, sellerAttested: true, total: 2 },
        })}
        buyerName="Acme Buyer"
        sellerName="Globex Seller"
        userOrgId="org-buyer"
      />,
    );
    expect(screen.getByRole("status").getAttribute("aria-label")).toMatch(
      /Download certificate/,
    );
  });

  it("re-points aria-current=\"step\" as attestations land", () => {
    // Initially: viewer (buyer) is the current step.
    const { rerender } = renderStepper(makeState({ canAttest: true }));
    let items = screen.getAllByRole("listitem");
    expect(items[0].getAttribute("aria-current")).toBe("step");
    expect(items[1].getAttribute("aria-current")).toBeNull();

    // Buyer attests — current step now points at the seller.
    rerender(
      <AttestationProgressStepper
        wad={makeWad({ attestations: [buyerAttestation()] })}
        consequenceState={makeState({
          canAttest: false,
          hasAttested: true,
          attestations: { buyerAttested: true, sellerAttested: false, total: 1 },
        })}
        buyerName="Acme Buyer"
        sellerName="Globex Seller"
        userOrgId="org-buyer"
      />,
    );
    items = screen.getAllByRole("listitem");
    expect(items[0].getAttribute("aria-current")).toBeNull();
    expect(items[1].getAttribute("aria-current")).toBe("step");
  });

  it("does NOT use the aggressive role=\"alert\" for routine progress updates", () => {
    // Progress updates are announced politely (role=status / aria-live=polite)
    // so they don't interrupt whatever the user is currently reading.
    // Asserting the absence of role=alert here guards against a regression
    // where a future "celebration" component might escalate the politeness.
    renderStepper(makeState({ canAttest: true }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
