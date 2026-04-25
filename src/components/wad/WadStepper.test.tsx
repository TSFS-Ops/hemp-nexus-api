import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WadStepper } from "./WadStepper";
import type { WadRecord, ConsequenceState } from "@/lib/modules/consequence";
import type { Tables } from "@/integrations/supabase/types";

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

const makeWad = (): WadRecord =>
  ({ id: "wad-1", status: "draft", buyer_org_id: "org-buyer", seller_org_id: "org-seller" } as unknown as WadRecord);
const makeMatch = (): Tables<"matches"> => ({ id: "match-1" } as unknown as Tables<"matches">);
const makeState = (): ConsequenceState =>
  ({
    canAttest: true,
    hasAttested: false,
    canSeal: false,
    canDownloadCertificate: false,
    attestations: [],
    uiStatus: "draft",
    statusLabel: "Draft",
    canRevoke: false,
    isParty: true,
    allAttested: false,
  } as unknown as ConsequenceState);

async function fillFormAndSubmit() {
  fireEvent.click(screen.getByRole("button", { name: /review & attest/i }));
  fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } });
  fireEvent.click(screen.getByLabelText(/i confirm that this is not a contract/i));
  fireEvent.click(screen.getByRole("button", { name: /^attest$/i }));
}

describe("WadStepper attestation error body shows Reference ID and persists until success", () => {
  beforeEach(() => submitAttestationMock.mockReset());

  it("renders the Reference ID inline in the error body", async () => {
    submitAttestationMock.mockResolvedValueOnce({
      success: false,
      error: "Server rejected attestation",
      requestId: "req-abc-123",
    });
    render(
      <WadStepper
        wad={makeWad()}
        match={makeMatch()}
        consequenceState={makeState()}
        userOrgId="org-buyer"
        onUpdate={() => {}}
      />
    );
    await fillFormAndSubmit();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Server rejected attestation/);
    expect(alert.textContent).toMatch(/Reference ID:\s*req-abc-123/);
    expect(alert.textContent).toMatch(/until you attest successfully/i);
  });

  it("keeps the error visible across a failed retry", async () => {
    submitAttestationMock
      .mockResolvedValueOnce({ success: false, error: "First failure", requestId: "req-1" })
      .mockResolvedValueOnce({ success: false, error: "Second failure", requestId: "req-2" });
    render(
      <WadStepper
        wad={makeWad()}
        match={makeMatch()}
        consequenceState={makeState()}
        userOrgId="org-buyer"
        onUpdate={() => {}}
      />
    );
    await fillFormAndSubmit();
    await screen.findByText(/First failure/);

    fireEvent.click(screen.getByRole("button", { name: /retry attestation/i }));
    await screen.findByText(/Second failure/);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Reference ID:\s*req-2/);
  });

  it("clears the error only on a successful attestation", async () => {
    submitAttestationMock
      .mockResolvedValueOnce({ success: false, error: "Initial failure", requestId: "req-1" })
      .mockResolvedValueOnce({ success: true });
    render(
      <WadStepper
        wad={makeWad()}
        match={makeMatch()}
        consequenceState={makeState()}
        userOrgId="org-buyer"
        onUpdate={() => {}}
      />
    );
    await fillFormAndSubmit();
    await screen.findByText(/Initial failure/);

    fireEvent.click(screen.getByRole("button", { name: /retry attestation/i }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
