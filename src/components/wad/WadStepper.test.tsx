/**
 * Verifies attestation button + helper text reflect WaD status, and that
 * the inline error block clears the moment the user edits the form.
 *
 *  - draft                  → user can attest; primary CTA shows "Attest"
 *  - awaiting_attestations  → user has already attested; helper says
 *                              "Waiting for other party"; no Attest button
 *  - sealed                 → "Signed Deal has been sealed" + completion
 *                              helper; no Attest button
 *  - error recovery         → after a failed attestation, editing the name
 *                              OR toggling the confirm checkbox immediately
 *                              dismisses the inline error alert
 *
 * The component imports async helpers from `@/lib/modules/consequence`
 * (submitAttestation, sealWad, downloadCertificate, …) which transitively
 * pull in supabase/api-client. We mock that module so the test is a pure
 * presentation check — no network, no auth, no env vars needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

// ─── Module mocks ───────────────────────────────────────────────────
// Must be declared before importing the component under test.
const submitAttestationMock = vi.fn();
vi.mock("@/lib/modules/consequence", () => ({
  submitAttestation: (...args: unknown[]) => submitAttestationMock(...args),
  sealWad: vi.fn(),
  downloadCertificate: vi.fn(),
  triggerBlobDownload: vi.fn(),
  resolveAttestationRole: vi.fn(() => "buyer_signatory"),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Force the staged-rollout flag OFF so we test the default production copy
// (status-specific copy is opt-in; covered separately by its own derivation).
vi.mock("@/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => false,
}));

import { WadStepper } from "./WadStepper";
import type {
  ConsequenceState,
  WadRecord,
} from "@/lib/modules/consequence";
import type { Tables } from "@/integrations/supabase/types";

type Match = Tables<"matches">;

// ─── Fixture builders ───────────────────────────────────────────────
const BUYER_ORG = "buyer-org-1";
const SELLER_ORG = "seller-org-1";

function makeWad(overrides: Partial<WadRecord> = {}): WadRecord {
  return {
    id: "wad-1",
    poi_id: "poi-1",
    status: "draft",
    evidence_bundle: null,
    seal_hash: null,
    sealed_at: null,
    created_at: "2025-01-01T00:00:00Z",
    buyer_org_id: BUYER_ORG,
    seller_org_id: SELLER_ORG,
    attestations: [],
    ...overrides,
  };
}

function makeMatch(): Match {
  return {
    id: "match-1",
    buyer_name: "Buyer Co",
    seller_name: "Seller Co",
    commodity: "Maize",
    quantity_amount: 100,
    quantity_unit: "MT",
    price_amount: 50,
    price_currency: "USD",
  } as unknown as Match;
}

function makeState(
  overrides: Partial<ConsequenceState> = {}
): ConsequenceState {
  return {
    uiStatus: "draft",
    statusLabel: "Draft",
    wad: null,
    canCreate: false,
    createBlockedReasons: [],
    canAttest: true,
    hasAttested: false,
    allAttested: false,
    canSeal: false,
    canDownloadCertificate: false,
    canRevoke: false,
    isTerminal: false,
    attestations: { buyerAttested: false, sellerAttested: false, total: 0 },
    ...overrides,
  };
}

/**
 * Renders WadStepper and clicks the "Review & Attest" tab so we land on the
 * attestation step (default `activeStep` is the Summary tab).
 */
function renderOnAttestStep(args: {
  wad: WadRecord;
  state: ConsequenceState;
  userOrgId?: string | null;
}) {
  const utils = render(
    <WadStepper
      wad={args.wad}
      match={makeMatch()}
      consequenceState={args.state}
      userOrgId={args.userOrgId ?? BUYER_ORG}
      onUpdate={() => {}}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /Review & Attest/i }));
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  submitAttestationMock.mockReset();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("WadStepper attestation copy", () => {
  describe("draft status (user has NOT attested, can attest)", () => {
    it("shows the primary 'Attest' button and the statement label", () => {
      renderOnAttestStep({
        wad: makeWad({ status: "draft" }),
        state: makeState({
          uiStatus: "draft",
          canAttest: true,
          hasAttested: false,
        }),
      });

      expect(screen.getByText("Attestation Statement:")).toBeInTheDocument();

      const cta = screen.getByRole("button", { name: "Attest" });
      expect(cta).toBeInTheDocument();
      expect(cta).toBeDisabled();

      expect(
        screen.queryByText("You have already attested")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Signed Deal has been sealed")
      ).not.toBeInTheDocument();
    });
  });

  describe("awaiting_attestations status (user already attested, waiting on counterparty)", () => {
    it("shows the 'already attested' helper text and no Attest button", () => {
      renderOnAttestStep({
        wad: makeWad({
          status: "awaiting_attestations",
          attestations: [
            {
              id: "att-1",
              wad_id: "wad-1",
              user_id: "user-1",
              org_id: BUYER_ORG,
              role: "buyer_signatory",
              attested_name: "Alice Buyer",
              attested_at: "2025-01-02T00:00:00Z",
              attestation_text: "...",
            },
          ],
        }),
        state: makeState({
          uiStatus: "awaiting_attestations",
          canAttest: false,
          hasAttested: true,
          attestations: {
            buyerAttested: true,
            sellerAttested: false,
            total: 1,
          },
        }),
      });

      expect(
        screen.getByText("You have already attested")
      ).toBeInTheDocument();
      expect(screen.getByText("Waiting for other party")).toBeInTheDocument();

      expect(
        screen.queryByRole("button", { name: "Attest" })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Retry attestation/ })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Seal Signed Deal/i })
      ).not.toBeInTheDocument();
    });
  });

  describe("sealed status", () => {
    it("shows the 'Signed Deal has been sealed' completion message and no Attest button", () => {
      renderOnAttestStep({
        wad: makeWad({
          status: "sealed",
          sealed_at: "2025-01-03T00:00:00Z",
          seal_hash: "abc123",
        }),
        state: makeState({
          uiStatus: "sealed",
          statusLabel: "Sealed",
          canAttest: false,
          hasAttested: true,
          allAttested: true,
          canSeal: false,
          canDownloadCertificate: true,
          isTerminal: true,
          attestations: {
            buyerAttested: true,
            sellerAttested: true,
            total: 2,
          },
        }),
      });

      expect(
        screen.getByText("Signed Deal has been sealed")
      ).toBeInTheDocument();
      expect(screen.getByText("All attestations complete")).toBeInTheDocument();

      expect(
        screen.queryByRole("button", { name: "Attest" })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("You have already attested")
      ).not.toBeInTheDocument();
    });
  });

  describe("inline error clears on form edit", () => {
    /**
     * Helper: drives the form into the failed-attestation state so the
     * inline error alert is rendered, then returns once the alert is
     * present in the DOM. Submission is simulated by resolving
     * submitAttestation with a failure payload (no real network).
     */
    async function triggerAttestationError() {
      submitAttestationMock.mockResolvedValueOnce({
        success: false,
        error: "Server rejected the attestation",
        requestId: "req-abc-123",
      });

      renderOnAttestStep({
        wad: makeWad({ status: "draft" }),
        state: makeState({ uiStatus: "draft", canAttest: true }),
      });

      // Fill in name + tick checkbox → CTA enables.
      const nameInput = screen.getByLabelText(
        /Your Full Name/i
      ) as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: "Alice Buyer" } });

      // Radix checkbox: click the labelled control to toggle.
      fireEvent.click(
        screen.getByLabelText(/I confirm that this is NOT a contract/i)
      );

      const cta = screen.getByRole("button", { name: "Attest" });
      await waitFor(() => expect(cta).not.toBeDisabled());

      await act(async () => {
        fireEvent.click(cta);
      });

      // Wait for the inline alert to appear.
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Attestation failed");
      expect(alert).toHaveTextContent("Server rejected the attestation");

      return { nameInput };
    }

    it("dismisses the inline error when the user edits the attested name", async () => {
      const { nameInput } = await triggerAttestationError();

      fireEvent.change(nameInput, { target: { value: "Alice Buyer!" } });

      // Alert disappears synchronously on the next render.
      await waitFor(() =>
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      );
      expect(screen.queryByText("Attestation failed")).not.toBeInTheDocument();
      expect(screen.queryByText(/req-abc-123/)).not.toBeInTheDocument();

      // CTA returns to its non-error label.
      expect(
        screen.getByRole("button", { name: "Attest" })
      ).toBeInTheDocument();
    });

    it("dismisses the inline error when the user toggles the confirmation checkbox", async () => {
      await triggerAttestationError();

      // Toggle the confirm checkbox off (it was checked to enable submit).
      fireEvent.click(
        screen.getByLabelText(/I confirm that this is NOT a contract/i)
      );

      await waitFor(() =>
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      );
      expect(screen.queryByText("Attestation failed")).not.toBeInTheDocument();
      expect(screen.queryByText(/req-abc-123/)).not.toBeInTheDocument();

      // CTA returns to its non-error label.
      expect(
        screen.getByRole("button", { name: "Attest" })
      ).toBeInTheDocument();
    });
  });
});
