import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";

type MockEngagement = Record<string, unknown>;

const CP006A_ENGAGEMENT_ID = "2b83c8e9-9289-4e96-ba8a-e2644513dc4e";
const CP006B_ENGAGEMENT_ID = "8ed7e4cf-e312-4080-801a-edfdd4262381";
const CP009_ENGAGEMENT_ID = "359e7e9d-897c-4eee-895c-35824ff2b02f";
const CP012_ENGAGEMENT_ID = "cd661af0-95fe-4268-bf2d-5d20b505b134";
const CP015_OLD_ENGAGEMENT_ID = "4226aff0-246c-406b-9c4f-ae64c89cc9e7";
const CP015_NEW_ENGAGEMENT_ID = "848a2ec1-e89c-4781-9f22-1713b86a6630";

const mockState = vi.hoisted((): {
  engagements: MockEngagement[];
  autoBindAuditIds: string[];
  invoke: any;
} => ({
  engagements: [],
  autoBindAuditIds: [],
  invoke: vi.fn(),
}));

function makeQuery(table: string) {
  const filters: Record<string, unknown> = {};
  const chain: any = {
    select: () => chain,
    like: () => chain,
    gte: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    or: () => chain,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return chain;
    },
    in: (column: string, value: unknown) => {
      filters[column] = value;
      return chain;
    },
    then: (resolve: (value: unknown) => unknown) => {
      if (table === "audit_logs" && filters.action === "pending_engagement.auto_bound_registered_org") {
        return Promise.resolve({
          data: mockState.autoBindAuditIds.map((entity_id) => ({ entity_id })),
          error: null,
        }).then(resolve);
      }
      return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockState.invoke(...args),
    },
    from: (table: string) => makeQuery(table),
    channel: () => ({
      on: () => ({
        subscribe: (cb?: (status: string) => void) => {
          cb?.("SUBSCRIBED");
          return { unsubscribe: vi.fn() };
        },
      }),
    }),
    removeChannel: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

import { AdminPendingEngagementsPanel, DANIEL_FIXTURE_UI_COPY } from "@/components/admin/AdminPendingEngagementsPanel";

const baseMatch = {
  id: "match-base",
  commodity: "DEMO Commodity",
  quantity_amount: 500,
  quantity_unit: "MT",
  price_amount: 250,
  price_currency: "USD",
  buyer_name: "DEMO Daniel Initiator Org",
  seller_name: "DEMO Daniel Counterparty Org",
  buyer_org_id: "org-initiator",
  seller_org_id: null,
};

function engagement(overrides: MockEngagement): MockEngagement {
  return {
    id: "eng-base",
    match_id: "match-base",
    org_id: "org-initiator",
    counterparty_org_id: null,
    counterparty_email: "counterparty@test.izenzo.co.za",
    counterparty_type: "unknown",
    engagement_status: "notification_sent",
    counterparty_response: null,
    contact_type: "organisation",
    contact_name: "DEMO Daniel Counterparty Org",
    contact_method: null,
    contacted_at: null,
    responded_at: null,
    admin_notes: null,
    support_notes: null,
    support_notes_updated_at: null,
    support_notes_updated_by: null,
    created_at: "2026-05-24T10:00:00.000Z",
    operational_state: null,
    binding_candidates: null,
    binding_resolution: null,
    is_demo: true,
    matches: baseMatch,
    initiator_org: { id: "org-initiator", name: "DEMO Daniel Initiator Org" },
    counterparty_org: null,
    ...overrides,
  };
}

async function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AdminPendingEngagementsPanel />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("show-demo-toggle")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("show-demo-toggle"));
}

beforeEach(() => {
  mockState.invoke.mockReset();
  mockState.invoke.mockImplementation((route: string) => {
    if (route.startsWith("poi-engagements?")) {
      return Promise.resolve({ data: { engagements: mockState.engagements }, error: null });
    }
    return Promise.resolve({ data: {}, error: null });
  });
  mockState.engagements = [];
  mockState.autoBindAuditIds = [];
});

describe("Daniel fixture admin UI proof — CP-006", () => {
  it("CP-006A renders unique-exact-email auto-bind confirmation text", async () => {
    mockState.autoBindAuditIds = [CP006A_ENGAGEMENT_ID];
    mockState.engagements = [engagement({
      id: CP006A_ENGAGEMENT_ID,
      match_id: "d3dde4fc-3d40-461f-8f55-d56c5969af90",
      counterparty_org_id: "org-counterparty",
      counterparty_type: "known",
      contact_type: "organisation",
      counterparty_org: { id: "org-counterparty", name: "DEMO Daniel Counterparty Org" },
      matches: { ...baseMatch, id: "d3dde4fc-3d40-461f-8f55-d56c5969af90", seller_org_id: "org-counterparty" },
    })];

    await renderPanel();

    expect(await screen.findByText(DANIEL_FIXTURE_UI_COPY.cp006AutoBind)).toBeInTheDocument();
    expect(screen.getByText("DEMO Daniel Counterparty Org")).toBeInTheDocument();
    expect(screen.getByText("Organisation-level contact")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send outreach/i })).toBeEnabled();
  });

  it("CP-006B renders binding-review warning and disables Send outreach", async () => {
    mockState.engagements = [engagement({
      id: CP006B_ENGAGEMENT_ID,
      match_id: "46e4acc5-7c50-455e-a9f7-613a475f0d33",
      counterparty_org_id: null,
      counterparty_type: "unknown",
      contact_type: "named_individual",
      contact_name: "Daniel CP006 Ambiguous Contact",
      counterparty_email: "daniel-cp006-ambiguous@test.izenzo.co.za",
      operational_state: "binding_review_required",
      binding_candidates: { candidates: [{ org_id: "org-a" }, { org_id: "org-b" }] },
      matches: { ...baseMatch, id: "46e4acc5-7c50-455e-a9f7-613a475f0d33", seller_name: null, seller_org_id: null },
    })];

    await renderPanel();

    expect(await screen.findByText(DANIEL_FIXTURE_UI_COPY.cp006BindingReview)).toBeInTheDocument();
    expect(screen.getByText("Binding review required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send outreach/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /resolve binding/i })).toBeInTheDocument();
  });
});

describe("Daniel fixture admin UI proof — CP-009 / CP-012 / CP-015", () => {
  it("CP-009 renders late-acceptance explanation and Reconfirm/Decline", async () => {
    mockState.engagements = [engagement({
      id: CP009_ENGAGEMENT_ID,
      match_id: "ff4bab64-aa58-47e6-92e9-987b4a7da655",
      engagement_status: "late_acceptance_pending_initiator_reconfirmation",
      counterparty_response: "accepted_after_expiry",
      late_acceptance_recorded_at: "2026-05-24T09:00:00.000Z",
      reconfirmation_window_expires_at: "2026-05-31T09:00:00.000Z",
    })];

    await renderPanel();

    expect(await screen.findByText(DANIEL_FIXTURE_UI_COPY.cp009LateAcceptance)).toBeInTheDocument();
    expect(screen.getByText("Late acceptance — awaiting initiator reconfirmation")).toBeInTheDocument();
    expect(screen.getByText("accepted_after_expiry")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reconfirm/i })).toBeInTheDocument();
    expect(screen.getByTestId("cp009-decline")).toHaveTextContent("Decline");
  });

  it("CP-012 renders dispute-hold messages and Release/Close controls", async () => {
    mockState.engagements = [engagement({
      id: CP012_ENGAGEMENT_ID,
      match_id: "7d08a348-350b-4d6a-a538-95f4ebd4a74d",
      engagement_status: "disputed_being_named",
      operational_state: "disputed_being_named",
      counterparty_org_id: "org-counterparty",
      counterparty_type: "known",
      counterparty_org: { id: "org-counterparty", name: "DEMO Daniel Counterparty Org" },
    })];

    await renderPanel();

    expect(await screen.findByText(DANIEL_FIXTURE_UI_COPY.cp012DisputeHoldAdmin)).toBeInTheDocument();
    expect(screen.getByText(DANIEL_FIXTURE_UI_COPY.cp012DisputeHoldInitiator)).toBeInTheDocument();
    expect(screen.getByText(DANIEL_FIXTURE_UI_COPY.cp012DisputeHoldCounterparty)).toBeInTheDocument();
    expect(screen.getByText("Disputed — being named")).toBeInTheDocument();
    expect(screen.getByTestId("cp012-release-dispute")).toHaveTextContent("Release");
    expect(screen.getByTestId("cp012-close-dispute")).toHaveTextContent("Close");
    expect(screen.queryByRole("button", { name: /send outreach/i })).not.toBeInTheDocument();
  });

  it("CP-015 renders old/new engagement state and email-change warning", async () => {
    const oldEmail = "daniel-cp015-old@test.izenzo.co.za";
    const newEmail = "daniel-cp015-corrected@test.izenzo.co.za";
    mockState.engagements = [
      engagement({
        id: CP015_OLD_ENGAGEMENT_ID,
        match_id: "b50e94c8-a916-46c2-ac00-50eb9c109a88",
        engagement_status: "cancelled_email_change",
        operational_state: "cancelled_for_email_change",
        counterparty_email: oldEmail,
      }),
      engagement({
        id: CP015_NEW_ENGAGEMENT_ID,
        match_id: "b50e94c8-a916-46c2-ac00-50eb9c109a88",
        engagement_status: "pending",
        counterparty_email: newEmail,
      }),
    ];

    await renderPanel();

    expect(await screen.findByText(DANIEL_FIXTURE_UI_COPY.cp015EmailChange)).toBeInTheDocument();
    expect(screen.getByText(DANIEL_FIXTURE_UI_COPY.cp015InactiveLink)).toBeInTheDocument();
    expect(screen.getByText(oldEmail)).toBeInTheDocument();
    expect(screen.getByText(newEmail)).toBeInTheDocument();
    expect(screen.getByText("Cancelled (email change)")).toBeInTheDocument();
    const oldRow = screen.getByTestId(`engagement-row-${CP015_OLD_ENGAGEMENT_ID}`);
    expect(oldRow).toHaveAttribute("data-operational-state", "cancelled_for_email_change");
    expect(within(oldRow).getByTestId("cp015-old-outreach-inactive")).toBeDisabled();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });
});