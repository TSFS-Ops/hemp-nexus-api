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

const makeWad = (): WadRecord => ({
  id: "wad-1",
  status: "draft",
  buyer_org_id: "org-buyer",
  seller_org_id: "org-seller",
} as unknown as WadRecord);

const makeMatch = (): Tables<"matches"> => ({ id: "match-1" } as unknown as Tables<"matches">);

const makeState = (): ConsequenceState => ({
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

async function triggerAttestError(kind: "auth_required" | "client_error" | "server_error" | "network_error") {
  submitAttestationMock.mockResolvedValueOnce({
    success: false,
    error: "Attestation failed",
    requestId: "req-abc-123",
    errorKind: kind,
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
  // navigate to Review & Attest step
  fireEvent.click(screen.getByRole("button", { name: /review & attest/i }));
  fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } });
  fireEvent.click(screen.getByLabelText(/i confirm that this is not a contract/i));
  fireEvent.click(screen.getByRole("button", { name: /^attest$/i }));
  await waitFor(() => screen.getByTestId("attest-error-hint"));
}

describe("WadStepper attestation error hints", () => {
  beforeEach(() => {
    submitAttestationMock.mockReset();
    sessionStorage.clear();
  });

  it("shows auth-required hint for expired session", async () => {
    await triggerAttestError("auth_required");
    expect(screen.getByTestId("attest-error-hint").textContent).toMatch(/sign in again/i);
  });

  it("shows client-error hint pointing at form with Ref", async () => {
    await triggerAttestError("client_error");
    const text = screen.getByTestId("attest-error-hint").textContent ?? "";
    expect(text).toMatch(/check the details/i);
    expect(text).toMatch(/Ref req-abc-123/);
  });

  it("shows server-error hint as transient with Ref", async () => {
    await triggerAttestError("server_error");
    const text = screen.getByTestId("attest-error-hint").textContent ?? "";
    expect(text).toMatch(/temporary problem/i);
    expect(text).toMatch(/Ref req-abc-123/);
  });

  it("shows network-error hint about connectivity", async () => {
    await triggerAttestError("network_error");
    expect(screen.getByTestId("attest-error-hint").textContent).toMatch(/couldn't reach the server/i);
  });
});

describe("WadStepper attestation error persistence", () => {
  beforeEach(() => {
    submitAttestationMock.mockReset();
    sessionStorage.clear();
  });

  it("persists the error to sessionStorage and restores it on remount", async () => {
    await triggerAttestError("server_error");
    const stored = sessionStorage.getItem("wad:attestError:wad-1");
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.requestId).toBe("req-abc-123");
    expect(parsed.kind).toBe("server_error");

    // Simulate a reload: unmount + fresh render with the same wad id.
    document.body.innerHTML = "";
    render(
      <WadStepper
        wad={makeWad()}
        match={makeMatch()}
        consequenceState={makeState()}
        userOrgId="org-buyer"
        onUpdate={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /review & attest/i }));
    expect(screen.getByTestId("attest-error-hint")).toBeTruthy();
    expect(screen.getAllByText(/req-abc-123/).length).toBeGreaterThan(0);
  });

  it("clears the persisted error after a successful attestation", async () => {
    await triggerAttestError("client_error");
    expect(sessionStorage.getItem("wad:attestError:wad-1")).toBeTruthy();

    submitAttestationMock.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByRole("button", { name: /retry attestation/i }));
    await waitFor(() => {
      expect(screen.queryByTestId("attest-error-hint")).toBeNull();
    });
    expect(sessionStorage.getItem("wad:attestError:wad-1")).toBeNull();
  });
});
