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

// ─── Keyboard shortcut handling ──────────────────────────────────────
//
// Native <button> already activates on Enter/Space, but we attach an
// explicit, focus-scoped onKeyDown to:
//   1. stopPropagation so a future ancestor key listener (e.g. global
//      stepper navigation) cannot also act on the same keystroke.
//   2. Make the contract testable: the shortcut MUST only fire when the
//      Attest/Retry button is the focused element — not when focus is on
//      the stepper, the name input, or the consent checkbox.
describe("WadStepper attest keyboard shortcut", () => {
  beforeEach(() => {
    submitAttestationMock.mockReset();
    sessionStorage.clear();
  });

  function navigateToReadyAttestStep() {
    render(
      <WadStepper
        wad={makeWad()}
        match={makeMatch()}
        consequenceState={makeState()}
        userOrgId="org-buyer"
        onUpdate={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /review & attest/i }));
    fireEvent.change(screen.getByLabelText(/your full name/i), {
      target: { value: "Jane Doe" },
    });
    fireEvent.click(screen.getByLabelText(/i confirm that this is not a contract/i));
  }

  it("triggers Attest when Enter is pressed on the focused button", async () => {
    submitAttestationMock.mockResolvedValueOnce({ success: true });
    navigateToReadyAttestStep();

    const btn = screen.getByTestId("attest-submit-button") as HTMLButtonElement;
    btn.focus();
    expect(document.activeElement).toBe(btn);

    fireEvent.keyDown(btn, { key: "Enter" });

    await waitFor(() => expect(submitAttestationMock).toHaveBeenCalledTimes(1));
    expect(submitAttestationMock).toHaveBeenCalledWith(
      "wad-1",
      "Jane Doe",
      "buyer_signatory",
    );
  });

  it("triggers Attest when Space is pressed on the focused button", async () => {
    submitAttestationMock.mockResolvedValueOnce({ success: true });
    navigateToReadyAttestStep();

    const btn = screen.getByTestId("attest-submit-button") as HTMLButtonElement;
    btn.focus();

    fireEvent.keyDown(btn, { key: " " });

    await waitFor(() => expect(submitAttestationMock).toHaveBeenCalledTimes(1));
  });

  it("triggers Retry when the button is in the post-error 'Retry attestation' state", async () => {
    // First, force the form into the error state.
    submitAttestationMock.mockResolvedValueOnce({
      success: false,
      error: "Boom",
      requestId: "req-xyz",
      errorKind: "server_error",
    });
    navigateToReadyAttestStep();
    fireEvent.click(screen.getByTestId("attest-submit-button"));
    await waitFor(() => screen.getByTestId("attest-error-hint"));
    expect(
      screen.getByRole("button", { name: /retry attestation/i }),
    ).toBeInTheDocument();

    // Now the keyboard shortcut should retry via the same handler.
    submitAttestationMock.mockResolvedValueOnce({ success: true });
    const btn = screen.getByTestId("attest-submit-button") as HTMLButtonElement;
    btn.focus();
    fireEvent.keyDown(btn, { key: "Enter" });

    await waitFor(() => expect(submitAttestationMock).toHaveBeenCalledTimes(2));
  });

  it("does NOT trigger when the keystroke originates on the stepper navigation", () => {
    navigateToReadyAttestStep();

    const stepperButton = screen.getByRole("button", { name: /review & attest/i });
    stepperButton.focus();
    fireEvent.keyDown(stepperButton, { key: "Enter" });

    // Pressing Enter on a sibling stepper button must never reach the
    // Attest handler — it's the focus-scoped contract we're locking down.
    expect(submitAttestationMock).not.toHaveBeenCalled();
  });

  it("does NOT trigger when focus is in the name input", () => {
    navigateToReadyAttestStep();

    const nameInput = screen.getByLabelText(/your full name/i);
    (nameInput as HTMLInputElement).focus();
    fireEvent.keyDown(nameInput, { key: "Enter" });

    expect(submitAttestationMock).not.toHaveBeenCalled();
  });

  it("ignores Enter while a submission is already in flight (no double-fire)", async () => {
    // Never resolves — keeps `attesting` true so the second keystroke
    // must be a no-op.
    submitAttestationMock.mockReturnValueOnce(new Promise(() => {}));
    navigateToReadyAttestStep();

    const btn = screen.getByTestId("attest-submit-button") as HTMLButtonElement;
    btn.focus();
    fireEvent.keyDown(btn, { key: "Enter" });
    fireEvent.keyDown(btn, { key: "Enter" });

    // Microtask flush so the first call's state update lands before we assert.
    await Promise.resolve();
    expect(submitAttestationMock).toHaveBeenCalledTimes(1);
  });

  it("ignores Enter while the form is incomplete (mirrors the click-disabled gate)", () => {
    render(
      <WadStepper
        wad={makeWad()}
        match={makeMatch()}
        consequenceState={makeState()}
        userOrgId="org-buyer"
        onUpdate={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /review & attest/i }));

    // Name + consent intentionally NOT filled in.
    const btn = screen.getByTestId("attest-submit-button") as HTMLButtonElement;
    fireEvent.keyDown(btn, { key: "Enter" });

    expect(submitAttestationMock).not.toHaveBeenCalled();
  });

  it("ignores modifier-combo keystrokes (Ctrl/Meta+Enter etc.)", () => {
    submitAttestationMock.mockResolvedValueOnce({ success: true });
    navigateToReadyAttestStep();

    const btn = screen.getByTestId("attest-submit-button") as HTMLButtonElement;
    btn.focus();
    fireEvent.keyDown(btn, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(btn, { key: "Enter", metaKey: true });
    fireEvent.keyDown(btn, { key: "Enter", altKey: true });
    fireEvent.keyDown(btn, { key: "Enter", shiftKey: true });

    expect(submitAttestationMock).not.toHaveBeenCalled();
  });

  it("ignores auto-repeat keystrokes (held Enter key)", () => {
    submitAttestationMock.mockResolvedValueOnce({ success: true });
    navigateToReadyAttestStep();

    const btn = screen.getByTestId("attest-submit-button") as HTMLButtonElement;
    btn.focus();
    fireEvent.keyDown(btn, { key: "Enter", repeat: true });

    expect(submitAttestationMock).not.toHaveBeenCalled();
  });

  it("stops propagation so an ancestor listener can't also fire", () => {
    submitAttestationMock.mockResolvedValueOnce({ success: true });
    const ancestorListener = vi.fn();

    render(
      <div onKeyDown={ancestorListener}>
        <WadStepper
          wad={makeWad()}
          match={makeMatch()}
          consequenceState={makeState()}
          userOrgId="org-buyer"
          onUpdate={() => {}}
        />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /review & attest/i }));
    fireEvent.change(screen.getByLabelText(/your full name/i), {
      target: { value: "Jane Doe" },
    });
    fireEvent.click(
      screen.getByLabelText(/i confirm that this is not a contract/i),
    );

    const btn = screen.getByTestId("attest-submit-button") as HTMLButtonElement;
    btn.focus();
    ancestorListener.mockClear();
    fireEvent.keyDown(btn, { key: "Enter" });

    // Attest fired …
    await waitFor(() =>
      expect(submitAttestationMock).toHaveBeenCalledTimes(1),
    );
    // … but the ancestor listener did NOT receive the bubbled event.
    expect(ancestorListener).not.toHaveBeenCalled();
  });
});
