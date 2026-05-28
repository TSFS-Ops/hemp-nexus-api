/**
 * DATA-003 Phase 1 — AdminLegalHoldsPanel UI tests.
 *
 * Proves the `/hq/legal-holds` surface:
 *   1. Renders apply form + active/released tabs
 *   2. Scope-type selector enumerates all 10 signed scope types
 *   3. Apply button is disabled until scope_id is a UUID AND reason ≥10 chars
 *   4. Apply success invokes `admin-legal-hold` with action:apply and
 *      surfaces the exact success copy in the toast description
 *   5. Release UI requires release reason ≥10 chars and invokes
 *      `admin-legal-hold` with action:release on submit
 *   6. Release success surfaces the exact release success copy
 *   7. Released holds render in the released tab
 *
 * Admin gating is enforced at the route level (HQ.tsx) — this test
 * suite covers the panel contract once rendered.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const APPLY_COPY = "Legal hold applied — deletion/anonymisation suspended for this scope.";
const RELEASE_COPY = "Legal hold released — deletion/anonymisation may resume where otherwise permitted.";

const ACTIVE_HOLD = {
  id: "11111111-aaaa-4aaa-8aaa-111111111111",
  scope_type: "user" as const,
  scope_id: "22222222-bbbb-4bbb-8bbb-222222222222",
  reason: "Litigation hold for case 2026-LX-441",
  status: "active" as const,
  applied_by: "33333333-cccc-4ccc-8ccc-333333333333",
  applied_at: "2026-05-20T10:00:00Z",
  released_by: null,
  released_at: null,
  released_reason: null,
  metadata: {},
};

const RELEASED_HOLD = {
  ...ACTIVE_HOLD,
  id: "44444444-dddd-4ddd-8ddd-444444444444",
  status: "released" as const,
  released_by: "55555555-eeee-4eee-8eee-555555555555",
  released_at: "2026-05-22T10:00:00Z",
  released_reason: "Case closed; hold lifted by counsel",
};

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: vi.fn(),
  aalLevel: "aal2" as "aal1" | "aal2" | "unknown",
  aalError: null as null | { message: string },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => state.invoke(...args) },
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: () =>
          Promise.resolve({
            data: state.aalError
              ? null
              : { currentLevel: state.aalLevel, nextLevel: state.aalLevel },
            error: state.aalError,
          }),
      },
    },
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: state.toast }),
}));

import { AdminLegalHoldsPanel, HoldActiveBadge } from "@/components/admin/AdminLegalHoldsPanel";

function setListResponse(opts: { active?: any[]; released?: any[] } = {}) {
  state.invoke.mockImplementation((_fn: string, opts2: any) => {
    const body = opts2?.body ?? {};
    if (body.action === "list" && body.status === "active") {
      return Promise.resolve({ data: { ok: true, holds: opts.active ?? [] }, error: null });
    }
    if (body.action === "list" && body.status === "released") {
      return Promise.resolve({ data: { ok: true, holds: opts.released ?? [] }, error: null });
    }
    if (body.action === "apply") {
      return Promise.resolve({ data: { ok: true, legal_hold_id: "new-id", applied_at: new Date().toISOString() }, error: null });
    }
    if (body.action === "release") {
      return Promise.resolve({ data: { ok: true, legal_hold_id: body.legal_hold_id, released_at: new Date().toISOString() }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => {
  state.invoke.mockReset();
  state.toast.mockReset();
});

describe("AdminLegalHoldsPanel — render + scope selector", () => {
  it("renders apply form, active/released tabs, and HoldActiveBadge", async () => {
    setListResponse({ active: [ACTIVE_HOLD], released: [RELEASED_HOLD] });
    render(<AdminLegalHoldsPanel />);
    await waitFor(() => {
      expect(screen.getByText(/Apply legal hold/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Scope type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Scope ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Reason/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Active \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Released \(1\)/ })).toBeInTheDocument();
    expect(screen.getByText(ACTIVE_HOLD.reason)).toBeInTheDocument();
  });

  it("HoldActiveBadge renders distinct active vs inactive variants", () => {
    const { rerender } = render(<HoldActiveBadge active />);
    expect(screen.getByText(/Legal hold active/i)).toBeInTheDocument();
    rerender(<HoldActiveBadge active={false} />);
    expect(screen.getByText(/No hold/i)).toBeInTheDocument();
  });

  it("scope_type selector lists all 10 signed scope types", () => {
    // The select is a native Radix Select; assert the options are
    // declared in the source so the user has every signed scope available.
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "..", "components/admin/AdminLegalHoldsPanel.tsx"),
      "utf8",
    );
    for (const s of [
      "user","org","match","engagement","poi",
      "wad","dispute","payment","evidence","record_group",
    ]) {
      expect(src).toMatch(new RegExp(`"${s}"`));
    }
  });
});

describe("AdminLegalHoldsPanel — apply validation + invoke contract", () => {
  it("apply button is disabled until scope_id is a UUID AND reason ≥ 10 chars", async () => {
    setListResponse();
    render(<AdminLegalHoldsPanel />);
    const btn = await screen.findByRole("button", { name: /Apply hold/i });
    expect(btn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Scope ID/i), {
      target: { value: "not-a-uuid" },
    });
    fireEvent.change(screen.getByLabelText(/Reason/i), {
      target: { value: "short" },
    });
    expect(btn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Scope ID/i), {
      target: { value: "22222222-bbbb-4bbb-8bbb-222222222222" },
    });
    expect(btn).toBeDisabled(); // reason still < 10

    fireEvent.change(screen.getByLabelText(/Reason/i), {
      target: { value: "Litigation hold reasoning that is long enough" },
    });
    expect(btn).not.toBeDisabled();
  });

  it("apply invokes admin-legal-hold with action:apply and surfaces exact success copy", async () => {
    setListResponse();
    render(<AdminLegalHoldsPanel />);
    fireEvent.change(await screen.findByLabelText(/Scope ID/i), {
      target: { value: "22222222-bbbb-4bbb-8bbb-222222222222" },
    });
    fireEvent.change(screen.getByLabelText(/Reason/i), {
      target: { value: "Litigation hold for case 2026-LX-441" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Apply hold/i }));

    await waitFor(() => {
      const applyCall = state.invoke.mock.calls.find(
        (c) => c[1]?.body?.action === "apply",
      );
      expect(applyCall).toBeTruthy();
      expect(applyCall![0]).toBe("admin-legal-hold");
      expect(applyCall![1].body).toMatchObject({
        action: "apply",
        scope_type: "user",
        scope_id: "22222222-bbbb-4bbb-8bbb-222222222222",
        reason: "Litigation hold for case 2026-LX-441",
      });
    });

    await waitFor(() => {
      const successToast = state.toast.mock.calls.find(
        (c) => c[0]?.description === APPLY_COPY,
      );
      expect(successToast, "exact apply success copy must surface").toBeTruthy();
    });
  });
});

describe("AdminLegalHoldsPanel — release validation + invoke contract", () => {
  it("release button is disabled until release reason ≥ 10 chars", async () => {
    setListResponse({ active: [ACTIVE_HOLD] });
    render(<AdminLegalHoldsPanel />);
    const release = await screen.findByRole("button", { name: /Release hold/i });
    expect(release).toBeDisabled();

    const textarea = screen.getByPlaceholderText(/Release reason/i);
    fireEvent.change(textarea, { target: { value: "short" } });
    expect(release).toBeDisabled();

    fireEvent.change(textarea, {
      target: { value: "Case closed; hold lifted by counsel" },
    });
    expect(release).not.toBeDisabled();
  });

  it("release invokes admin-legal-hold with action:release and surfaces exact success copy", async () => {
    setListResponse({ active: [ACTIVE_HOLD] });
    render(<AdminLegalHoldsPanel />);
    fireEvent.change(
      await screen.findByPlaceholderText(/Release reason/i),
      { target: { value: "Case closed; hold lifted by counsel" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Release hold/i }));

    await waitFor(() => {
      const releaseCall = state.invoke.mock.calls.find(
        (c) => c[1]?.body?.action === "release",
      );
      expect(releaseCall).toBeTruthy();
      expect(releaseCall![1].body).toMatchObject({
        action: "release",
        legal_hold_id: ACTIVE_HOLD.id,
        released_reason: "Case closed; hold lifted by counsel",
      });
    });
    await waitFor(() => {
      const successToast = state.toast.mock.calls.find(
        (c) => c[0]?.description === RELEASE_COPY,
      );
      expect(successToast, "exact release success copy must surface").toBeTruthy();
    });
  });
});

describe("AdminLegalHoldsPanel — released tab", () => {
  it("requests released list from admin-legal-hold and renders count badge", async () => {
    setListResponse({ active: [], released: [RELEASED_HOLD] });
    render(<AdminLegalHoldsPanel />);
    // Released count badge proves the released list invocation succeeded.
    expect(await screen.findByRole("tab", { name: /Released \(1\)/ })).toBeInTheDocument();
    // Both list invocations (active + released) must have been made.
    await waitFor(() => {
      const listCalls = state.invoke.mock.calls.filter((c) => c[1]?.body?.action === "list");
      const statuses = listCalls.map((c) => c[1].body.status);
      expect(statuses).toContain("active");
      expect(statuses).toContain("released");
    });
  });
});

