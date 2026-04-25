/**
 * Integration test: Copy Ref click instrumentation.
 *
 * Verifies that the "Copy Ref" affordance on the persistent error alert
 * emits a `wad.attest_error.copy_ref` event into the client-analytics
 * pipeline with the correct surface + outcome, in both the success and
 * the clipboard-denied paths. The toast surface is exercised in
 * client-analytics.test.ts at the unit level — here we only need the
 * stable DOM-level call to prove the wiring.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WadStepper } from "./WadStepper";
import type { WadRecord, ConsequenceState } from "@/lib/modules/consequence";
import type { Tables } from "@/integrations/supabase/types";
import {
  CLIENT_ANALYTICS_DOM_EVENT,
  resetClientAnalyticsCounters,
} from "@/lib/client-analytics";

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

const makeMatch = (): Tables<"matches"> =>
  ({ id: "match-1" } as unknown as Tables<"matches">);

const makeState = (): ConsequenceState =>
  ({
    canAttest: true,
    hasAttested: false,
    canSeal: false,
    canDownloadCertificate: false,
    attestations: { buyerAttested: false, sellerAttested: false, total: 0 },
    uiStatus: "draft",
    statusLabel: "Draft",
    canRevoke: false,
    isParty: true,
    allAttested: false,
  } as unknown as ConsequenceState);

async function getIntoErrorState() {
  submitAttestationMock.mockResolvedValueOnce({
    success: false,
    error: "Boom",
    requestId: "req-xyz-1",
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
  fireEvent.click(screen.getByRole("button", { name: /review & attest/i }));
  fireEvent.change(screen.getByLabelText(/your full name/i), {
    target: { value: "Jane Doe" },
  });
  fireEvent.click(
    screen.getByLabelText(/i confirm that this is not a contract/i),
  );
  fireEvent.click(screen.getByTestId("attest-submit-button"));
  await screen.findByTestId("attest-error-alert");
}

describe("WadStepper Copy Ref analytics", () => {
  beforeEach(() => {
    submitAttestationMock.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    resetClientAnalyticsCounters();
  });

  it("emits a success event when the inline 'Copy' button copies the ref", async () => {
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener(CLIENT_ANALYTICS_DOM_EVENT, listener);

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await getIntoErrorState();
    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    await waitFor(() => expect(events.length).toBeGreaterThan(0));
    const detail = events[0].detail;
    expect(detail.name).toBe("wad.attest_error.copy_ref");
    expect(detail.payload).toMatchObject({
      surface: "alert",
      outcome: "success",
      hasRef: true,
      context: "wad_attest_error",
    });
    expect(writeText).toHaveBeenCalledWith("req-xyz-1");

    window.removeEventListener(CLIENT_ANALYTICS_DOM_EVENT, listener);
  });

  it("emits a denied event with reason when clipboard.writeText rejects", async () => {
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener(CLIENT_ANALYTICS_DOM_EVENT, listener);

    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("denied"), { name: "NotAllowedError" }),
          ),
      },
      configurable: true,
    });

    await getIntoErrorState();
    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    await waitFor(() => expect(events.length).toBeGreaterThan(0));
    const detail = events[0].detail;
    expect(detail.payload).toMatchObject({
      surface: "alert",
      outcome: "denied",
      hasRef: true,
      reason: "NotAllowedError",
    });

    window.removeEventListener(CLIENT_ANALYTICS_DOM_EVENT, listener);
  });
});
