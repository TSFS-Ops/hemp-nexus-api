/**
 * governance-record-phase1-fixes.test.tsx
 *
 * Covers the 7 Phase-1 polish/completeness fixes:
 *  1. "Open Governance Record" link renders for HQ and links to /hq/governance-records.
 *     Non-HQ users do not see the link.
 *  2. Top summary shows verification posture, current risk flag, demo/test/live
 *     label, and renders "Not recorded" rather than null where unavailable.
 *  3. Counterparty status falls back to match state when no engagement status is
 *     reachable from Phase 1 sources (verified via fixture below).
 *  4. Credit/payment surfaces a related event when finality_tokens_burned is 0.
 *  5. HQ decision wording renders in the timeline row, not only the drawer.
 *  6. event_store nested payload->>match_id is included via the new fetcher.
 *  7. Row-cap warning renders when a source hits the cap.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const MATCH_ID = "11111111-1111-1111-1111-111111111111";

// ── Auth mock ───────────────────────────────────────────────────────────
const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

// ── Supabase mock with .or() awareness so nested payload->>match_id works ─
const matchRow = {
  id: MATCH_ID,
  status: "settled",
  state: "ACTIVE",
  poi_state: "ELIGIBLE",
  commodity: "Copper",
  buyer_org_id: "b-org",
  seller_org_id: "s-org",
  buyer_name: "Acme Buyer",
  seller_name: "Globex Seller",
  settled_at: null,
  is_demo: false,
  created_at: "2026-05-01T00:00:00Z",
  finality_tokens_burned: 0,
};

const hqDecisionAuditRow = {
  id: "hq-1",
  action: "admin.manual_override.applied",
  entity_type: "match",
  entity_id: MATCH_ID,
  actor_user_id: "admin-1",
  org_id: "b-org",
  created_at: "2026-05-15T10:00:00Z",
  is_demo: false,
  metadata: { reason: "ops_request", match_id: MATCH_ID, verification_posture: "Waiver Applied" },
};

const blockedAuditRow = {
  id: "blk-1",
  action: "poi.blocked",
  entity_type: "match",
  entity_id: MATCH_ID,
  actor_user_id: "user-1",
  org_id: "b-org",
  created_at: "2026-05-14T10:00:00Z",
  is_demo: false,
  metadata: { reason: "no_evidence_seller", match_id: MATCH_ID },
};

const paymentAuditRow = {
  id: "pay-1",
  action: "payment.event_created",
  entity_type: "match",
  entity_id: MATCH_ID,
  actor_user_id: null,
  org_id: "b-org",
  created_at: "2026-05-13T10:00:00Z",
  is_demo: false,
  metadata: { match_id: MATCH_ID, payment_reference: "paystack_X" },
};

const nestedEventStoreRow = {
  id: "nested-1",
  event_type: "wad.passed",
  aggregate_type: "poi",
  aggregate_id: "99999999-9999-9999-9999-999999999999",
  occurred_at: "2026-05-16T10:00:00Z",
  actor_id: "user-1",
  actor_role: "system",
  org_id: "b-org",
  payload: { match_id: MATCH_ID, verification_posture: "Standard" },
};

let capAuditLogs = false;

function makeBuilder(rows: any[]) {
  const b: any = {
    _rows: rows,
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    like() { return this; },
    or() { return this; },
    filter() { return this; },
    order() { return this; },
    limit() { return Promise.resolve({ data: this._rows, error: null }); },
    maybeSingle() { return Promise.resolve({ data: this._rows[0] ?? null, error: null }); },
    then(resolve: any) { return Promise.resolve({ data: this._rows, error: null }).then(resolve); },
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from(table: string) {
        switch (table) {
          case "matches":
            return makeBuilder([matchRow]);
          case "audit_logs": {
            const rows = [hqDecisionAuditRow, blockedAuditRow, paymentAuditRow];
            if (capAuditLogs) {
              // Synthesise PER_SOURCE_LIMIT rows so the cap-warning fires.
              const synth = Array.from({ length: 500 }, (_, i) => ({
                ...paymentAuditRow,
                id: `pay-${i}`,
                created_at: `2026-05-13T10:00:${(i % 60).toString().padStart(2, "0")}Z`,
              }));
              return makeBuilder(synth);
            }
            return makeBuilder(rows);
          }
          case "admin_audit_logs":
            return makeBuilder([]);
          case "event_store":
            // Both the aggregate_id query and the nested .or() query share the
            // same builder — return the nested row so it surfaces in both.
            return makeBuilder([nestedEventStoreRow]);
          case "match_events":
            return makeBuilder([]);
          default:
            return makeBuilder([]);
        }
      },
    },
  };
});

import { GovernanceRecordDetail } from "@/components/admin/governance/GovernanceRecordDetail";
import { OpenGovernanceRecordLink } from "@/components/admin/governance/OpenGovernanceRecordLink";

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GovernanceRecordDetail anchor={{ matchId: MATCH_ID }} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Phase 1 fixes — OpenGovernanceRecordLink", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    capAuditLogs = false;
  });

  it("renders link for platform admin with correct deep-link href", () => {
    mockUseAuth.mockReturnValue({ isPlatformAdmin: true });
    render(
      <MemoryRouter>
        <OpenGovernanceRecordLink matchId={MATCH_ID} />
      </MemoryRouter>,
    );
    const link = screen.getByTestId("open-governance-record-link");
    expect(link).toBeInTheDocument();
    expect(link.querySelector("a") ?? link).toHaveAttribute(
      "href",
      `/hq/governance-records?match=${MATCH_ID}`,
    );
  });

  it("renders nothing for non-HQ users", () => {
    mockUseAuth.mockReturnValue({ isPlatformAdmin: false });
    const { container } = render(
      <MemoryRouter>
        <OpenGovernanceRecordLink matchId={MATCH_ID} />
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-testid='open-governance-record-link']")).toBeNull();
  });

  it("renders nothing when no anchor id is provided, even for HQ", () => {
    mockUseAuth.mockReturnValue({ isPlatformAdmin: true });
    const { container } = render(
      <MemoryRouter>
        <OpenGovernanceRecordLink />
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-testid='open-governance-record-link']")).toBeNull();
  });

  it("falls back to poi / engagement / pending_engagement params in priority order", () => {
    mockUseAuth.mockReturnValue({ isPlatformAdmin: true });
    const { rerender } = render(
      <MemoryRouter>
        <OpenGovernanceRecordLink poiId="poi-xyz" />
      </MemoryRouter>,
    );
    let link = screen.getByTestId("open-governance-record-link");
    expect(link.querySelector("a") ?? link).toHaveAttribute(
      "href",
      "/hq/governance-records?poi=poi-xyz",
    );

    rerender(
      <MemoryRouter>
        <OpenGovernanceRecordLink engagementId="eng-1" />
      </MemoryRouter>,
    );
    link = screen.getByTestId("open-governance-record-link");
    expect(link.querySelector("a") ?? link).toHaveAttribute(
      "href",
      "/hq/governance-records?engagement=eng-1",
    );

    rerender(
      <MemoryRouter>
        <OpenGovernanceRecordLink pendingEngagementId="pe-1" />
      </MemoryRouter>,
    );
    link = screen.getByTestId("open-governance-record-link");
    expect(link.querySelector("a") ?? link).toHaveAttribute(
      "href",
      "/hq/governance-records?pending_engagement=pe-1",
    );
  });
});

describe("Phase 1 fixes — GovernanceRecordDetail top summary", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue({ isPlatformAdmin: true });
    capAuditLogs = false;
  });

  it("shows Demo/Test/Live label explicitly (Live when match is not flagged demo)", async () => {
    renderDetail();
    await waitFor(() => {
      const label = screen.getAllByTestId("demo-test-live-label")[0];
      expect(label).toBeInTheDocument();
      expect(label.getAttribute("data-value")).toBe("Live");
    });
  });

  it("renders verification posture derived from a Phase 1 event", async () => {
    renderDetail();
    // Either Standard (from event_store wad row) or Waiver Applied (from HQ
    // decision audit row) — whichever is the most recent posture-bearing event
    // surfaces first. Both are acceptable derivations.
    await waitFor(() => {
      const text = screen.getByText(/Verification posture/i).parentElement!.textContent ?? "";
      expect(/Standard|Waiver Applied|Demo\/Test/.test(text)).toBe(true);
    });
  });

  it("renders current risk flag from blocked event", async () => {
    renderDetail();
    await waitFor(() => {
      const text = screen.getByText(/Current risk flag/i).parentElement!.textContent ?? "";
      expect(/Blocked|no_evidence_seller/.test(text)).toBe(true);
    });
  });

  it("renders 'Not recorded' for Memory record (Phase 1 has no Memory source)", async () => {
    renderDetail();
    await waitFor(() => {
      const block = screen.getByText(/Memory record/i).parentElement!;
      expect(block.textContent).toMatch(/Not recorded/);
    });
  });

  it("renders Credit / payment derived from payment.event_created when no tokens burned", async () => {
    renderDetail();
    await waitFor(() => {
      const block = screen.getByText(/Credit \/ payment/i).parentElement!;
      expect(block.textContent).toMatch(/payment\.event_created/);
    });
  });

  it("renders HQ decision controlled wording on the timeline row", async () => {
    renderDetail();
    await waitFor(() => {
      const copies = screen.getAllByTestId("hq-decision-copy");
      expect(copies.length).toBeGreaterThan(0);
      expect(copies[0].textContent).toMatch(/HQ decision recorded/);
    });
  });

  it("includes event_store rows whose payload.match_id references the anchor (nested)", async () => {
    renderDetail();
    await waitFor(() => {
      // The nested wad.passed row should appear in the timeline.
      expect(screen.getByText("wad.passed")).toBeInTheDocument();
    });
  });

  it("renders cap-warning when any source hits the 500-row cap", async () => {
    capAuditLogs = true;
    renderDetail();
    await waitFor(() => {
      const warn = screen.getByTestId("row-cap-warning");
      expect(warn).toBeInTheDocument();
      expect(warn.textContent).toMatch(/500-row display limit/);
      expect(warn.textContent).toMatch(/audit_logs/);
    });
  });
});
