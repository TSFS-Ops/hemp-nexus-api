/**
 * Compliance Workbench — deterministic UI fixtures.
 *
 * Used ONLY when the adapter is in fixture mode (default in development /
 * live-preview builds). Live mode calls the typed adapter which throws
 * NotImplementedError until Claude wires the real backend.
 */
import type {
  CaseDetail,
  CaseSummary,
  CustomerCaseView,
  FunderSummary,
  OverviewMetrics,
} from "./types";
import { COMPLIANCE_SENDER_NAME } from "./constants";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

export const FIXTURE_CASES: CaseSummary[] = [
  {
    reference: "IZ-CMP-2026-000123",
    internalId: "fx-1",
    type: "organisation_onboarding",
    status: "in_review",
    riskBand: "medium",
    priority: "high",
    primarySubject: {
      id: "sub-1",
      kind: "organisation",
      displayName: "Meridian Trading (Pty) Ltd",
      jurisdiction: "ZA",
    },
    assignment: {
      analystDisplayName: "N. Dlamini",
      team: "Compliance Ops",
      assignedAt: iso(-2 * DAY),
    },
    sla: { targetAt: iso(2 * DAY), breached: false, warning: false },
    hasActiveHold: false,
    hasPendingApproval: false,
    hasOpenRfi: true,
    providerDependent: false,
    currentTask: "Reviewing UBO evidence",
    lastActivityAt: iso(-3 * HOUR),
    openedAt: iso(-6 * DAY),
  },
  {
    reference: "IZ-CMP-2026-000131",
    internalId: "fx-2",
    type: "sanctions",
    status: "blocked",
    riskBand: "critical",
    priority: "immediate",
    primarySubject: {
      id: "sub-2",
      kind: "individual",
      displayName: "Applicant #A-0071",
    },
    assignment: {
      analystDisplayName: "K. Patel",
      team: "Sanctions",
      assignedAt: iso(-6 * HOUR),
    },
    sla: { targetAt: iso(-2 * HOUR), breached: true, warning: false },
    hasActiveHold: true,
    hasPendingApproval: true,
    hasOpenRfi: false,
    providerDependent: false,
    currentTask: "Director review of possible match",
    lastActivityAt: iso(-30 * 60 * 1000),
    openedAt: iso(-1 * DAY),
  },
  {
    reference: "IZ-CMP-2026-000144",
    internalId: "fx-3",
    type: "individual_idv",
    status: "awaiting_customer",
    riskBand: "low",
    priority: "normal",
    primarySubject: {
      id: "sub-3",
      kind: "individual",
      displayName: "Applicant #A-0092",
    },
    assignment: {
      analystDisplayName: "T. van der Merwe",
      team: "Compliance Ops",
      assignedAt: iso(-4 * DAY),
    },
    sla: { targetAt: iso(6 * DAY), breached: false, warning: false, awaitingCustomerSince: iso(-2 * DAY) },
    hasActiveHold: false,
    hasPendingApproval: false,
    hasOpenRfi: true,
    providerDependent: false,
    currentTask: "Awaiting replacement proof of address",
    lastActivityAt: iso(-1 * DAY),
    openedAt: iso(-7 * DAY),
  },
  {
    reference: "IZ-CMP-2026-000158",
    internalId: "fx-4",
    type: "ubo_director",
    status: "awaiting_approval",
    riskBand: "high",
    priority: "urgent",
    primarySubject: {
      id: "sub-4",
      kind: "organisation",
      displayName: "Highveld Agri Holdings",
    },
    assignment: {
      analystDisplayName: "S. Mokoena",
      team: "Compliance Ops",
      assignedAt: iso(-1 * DAY),
    },
    sla: { targetAt: iso(6 * HOUR), breached: false, warning: true },
    hasActiveHold: false,
    hasPendingApproval: true,
    hasOpenRfi: false,
    providerDependent: false,
    currentTask: "Senior Compliance Approver review",
    lastActivityAt: iso(-1 * HOUR),
    openedAt: iso(-3 * DAY),
  },
  {
    reference: "IZ-CMP-2026-000162",
    internalId: "fx-5",
    type: "transaction_compliance",
    status: "awaiting_provider",
    riskBand: "medium",
    priority: "high",
    primarySubject: {
      id: "sub-5",
      kind: "organisation",
      displayName: "Cape Coastal Logistics",
    },
    assignment: { analystDisplayName: null, team: "Compliance Ops", assignedAt: null },
    sla: { targetAt: iso(8 * HOUR), breached: false, warning: false, awaitingProviderSince: iso(-4 * HOUR) },
    hasActiveHold: false,
    hasPendingApproval: false,
    hasOpenRfi: false,
    providerDependent: true,
    currentTask: "Awaiting bank verification result",
    lastActivityAt: iso(-4 * HOUR),
    openedAt: iso(-2 * DAY),
  },
  {
    reference: "IZ-CMP-2026-000170",
    internalId: "fx-6",
    type: "periodic_refresh",
    status: "submitted",
    riskBand: "low",
    priority: "normal",
    primarySubject: {
      id: "sub-6",
      kind: "organisation",
      displayName: "Sable Financial Services",
    },
    assignment: { analystDisplayName: null, team: null, assignedAt: null },
    sla: { targetAt: iso(3 * HOUR), breached: false, warning: true },
    hasActiveHold: false,
    hasPendingApproval: false,
    hasOpenRfi: false,
    providerDependent: false,
    currentTask: "Unassigned — needs analyst",
    lastActivityAt: iso(-15 * 60 * 1000),
    openedAt: iso(-4 * HOUR),
  },
  {
    reference: "IZ-CMP-2026-000181",
    internalId: "fx-7",
    type: "evidence_remediation",
    status: "approved",
    riskBand: "low",
    priority: "normal",
    primarySubject: {
      id: "sub-7",
      kind: "organisation",
      displayName: "Karoo Renewables",
    },
    assignment: {
      analystDisplayName: "N. Dlamini",
      team: "Compliance Ops",
      assignedAt: iso(-9 * DAY),
    },
    sla: { targetAt: iso(-2 * DAY), breached: false, warning: false },
    hasActiveHold: false,
    hasPendingApproval: false,
    hasOpenRfi: false,
    providerDependent: false,
    currentTask: null,
    lastActivityAt: iso(-2 * DAY),
    openedAt: iso(-11 * DAY),
  },
];

export const FIXTURE_METRICS: OverviewMetrics = {
  openCases: 42,
  unassignedCases: 5,
  highRiskCases: 6,
  criticalRiskCases: 2,
  overdueCases: 3,
  slaWarnings: 4,
  slaBreaches: 1,
  outstandingRfis: 9,
  pendingApprovals: 4,
  activeHolds: 3,
  providerErrors: 1,
  appeals: 1,
  periodicReviewsDue: 7,
  averageDecisionHours: 41,
  timeAwaitingCustomerHours: 18,
  timeAwaitingProviderHours: 6,
  approvalTurnaroundHours: 12,
  riskDistribution: { low: 22, medium: 12, high: 6, critical: 2 },
  statusDistribution: {
    submitted: 6,
    in_review: 14,
    awaiting_customer: 9,
    awaiting_provider: 4,
    awaiting_approval: 4,
    blocked: 2,
    approved: 3,
  },
  caseTypeDistribution: {
    organisation_onboarding: 11,
    individual_idv: 9,
    ubo_director: 6,
    sanctions: 3,
    evidence_remediation: 5,
    periodic_refresh: 5,
    transaction_compliance: 3,
  },
  perAnalyst: [
    { analystDisplayName: "N. Dlamini", open: 9, overdue: 1 },
    { analystDisplayName: "K. Patel", open: 6, overdue: 0 },
    { analystDisplayName: "T. van der Merwe", open: 7, overdue: 1 },
    { analystDisplayName: "S. Mokoena", open: 5, overdue: 0 },
  ],
};

export function fixtureCaseDetail(reference: string): CaseDetail {
  const summary =
    FIXTURE_CASES.find((c) => c.reference === reference) ?? FIXTURE_CASES[0];
  return {
    summary,
    subjects: [summary.primarySubject],
    relatedRecords: [
      { label: "Organisation record", kind: "organisation", reference: summary.primarySubject.displayName },
      { label: "KYB profile", kind: "kyb", reference: `KYB-${summary.reference.slice(-6)}` },
    ],
    evidence: [
      {
        id: "ev-1",
        requirementKey: "registration_document",
        requirementLabel: "Official registration evidence",
        state: "accepted",
        fileName: "CoR14.3-registration.pdf",
        version: 2,
        uploadedAt: iso(-4 * DAY),
        reviewedAt: iso(-3 * DAY),
        reviewedByDisplayName: "N. Dlamini",
        attemptsUsed: 1,
        attemptsAllowed: 3,
        linkedToPack: true,
        history: [
          { at: iso(-6 * DAY), state: "uploaded" },
          { at: iso(-4 * DAY), state: "rejected", note: "Illegible" },
          { at: iso(-3 * DAY), state: "accepted" },
        ],
      },
      {
        id: "ev-2",
        requirementKey: "proof_of_address",
        requirementLabel: "Proof of address (≤3 months)",
        state: "rejected",
        fileName: "utility-bill.pdf",
        version: 1,
        uploadedAt: iso(-2 * DAY),
        reviewedAt: iso(-1 * DAY),
        reviewedByDisplayName: "N. Dlamini",
        rejectionReason: "Older than 3 months",
        attemptsUsed: 1,
        attemptsAllowed: 3,
        linkedToPack: false,
        history: [
          { at: iso(-2 * DAY), state: "uploaded" },
          { at: iso(-1 * DAY), state: "rejected", note: "Older than 3 months" },
        ],
      },
      {
        id: "ev-3",
        requirementKey: "bank_confirmation",
        requirementLabel: "Bank confirmation letter",
        state: "required",
        version: 0,
        attemptsUsed: 0,
        attemptsAllowed: 3,
        linkedToPack: false,
        history: [],
      },
      {
        id: "ev-4",
        requirementKey: "ubo_evidence",
        requirementLabel: "Ultimate Beneficial Owner evidence",
        state: "under_review",
        fileName: "ubo-declaration.pdf",
        version: 1,
        uploadedAt: iso(-6 * HOUR),
        attemptsUsed: 1,
        attemptsAllowed: 3,
        linkedToPack: false,
        history: [{ at: iso(-6 * HOUR), state: "uploaded" }],
      },
    ],
    providerResults: [
      {
        id: "pr-1",
        kind: "kyb",
        state: "clear",
        providerLabel: "Approved KYB provider",
        requestedAt: iso(-5 * DAY),
        receivedAt: iso(-5 * DAY + 20 * 60_000),
        expiresAt: iso(360 * DAY),
        manuallyReviewed: false,
        publicSafeSummary: "Company verification returned clear.",
      },
      {
        id: "pr-2",
        kind: "sanctions",
        state: summary.type === "sanctions" ? "possible_match" : "clear",
        providerLabel: "Approved sanctions provider",
        requestedAt: iso(-2 * DAY),
        receivedAt: iso(-2 * DAY + 30 * 60_000),
        expiresAt: iso(28 * DAY),
        manuallyReviewed: false,
        publicSafeSummary:
          summary.type === "sanctions"
            ? "Possible match — under analyst review."
            : "Sanctions screening returned no match.",
      },
      {
        id: "pr-3",
        kind: "bank_verification",
        state: summary.status === "awaiting_provider" ? "pending" : "not_required",
        providerLabel: "Approved bank verification provider",
        requestedAt: iso(-4 * HOUR),
        receivedAt: null,
        expiresAt: null,
        manuallyReviewed: false,
        publicSafeSummary: "Awaiting provider response.",
      },
    ],
    risk: {
      score: summary.riskBand === "critical" ? 92 : summary.riskBand === "high" ? 74 : summary.riskBand === "medium" ? 48 : 22,
      band: summary.riskBand,
      calculationVersion: "v1.4.0",
      calculatedAt: iso(-3 * HOUR),
      factors: [
        { key: "jurisdiction", label: "Jurisdiction exposure", contribution: 12 },
        { key: "ownership_complexity", label: "Ownership complexity", contribution: 8 },
        { key: "sanctions_exposure", label: "Sanctions exposure", contribution: summary.type === "sanctions" ? 30 : 4 },
      ],
      overrideActive: false,
    },
    rfis: summary.hasOpenRfi
      ? [
          {
            id: "rfi-1",
            reference: `RFI-${summary.reference.slice(-6)}-01`,
            issuedAt: iso(-3 * DAY),
            dueAt: iso(7 * DAY),
            cycleNumber: 1,
            overdue: false,
            awaitingCustomer: true,
            reminderPercents: [50, 80, 100],
            items: [
              {
                id: "rfi-item-1",
                category: "Evidence",
                customerSafeText: "Please upload a proof of address dated within the last 3 months.",
                internalReason: "Existing utility bill exceeded 3-month validity.",
                requestedItemType: "document",
                state: "requested",
              },
            ],
          },
        ]
      : [],
    tasks: [
      { id: "task-1", title: "Contact customer for replacement proof of address", ownerDisplayName: summary.assignment.analystDisplayName, dueAt: iso(1 * DAY), done: false },
      { id: "task-2", title: "Review UBO declaration", ownerDisplayName: summary.assignment.analystDisplayName, dueAt: iso(2 * DAY), done: false },
    ],
    notes: [
      { id: "n-1", type: "internal_analyst", createdAt: iso(-2 * DAY), authorDisplayName: "N. Dlamini", authorRole: "Compliance Analyst", body: "Customer engaged and responsive. Expect replacement within 24h." },
      { id: "n-2", type: "decision_rationale", createdAt: iso(-1 * DAY), authorDisplayName: "N. Dlamini", authorRole: "Compliance Analyst", body: "Proposing conditional approval subject to proof of address." },
    ],
    customerMessages: [
      { id: "m-1", type: "customer_visible", createdAt: iso(-3 * DAY), authorDisplayName: COMPLIANCE_SENDER_NAME, authorRole: "Compliance Team", body: "We require a proof of address dated within the last 3 months. Please upload via your compliance area." },
    ],
    escalations: [],
    approvals: summary.hasPendingApproval
      ? [
          {
            id: "ap-1",
            proposedOutcome: summary.status === "blocked" ? "blocked" : "conditionally_approved",
            proposedByDisplayName: summary.assignment.analystDisplayName ?? "Compliance Analyst",
            proposedAt: iso(-4 * HOUR),
            emergencyBypass: false,
            invalidated: false,
            requirements: [
              {
                role: "senior_compliance_approver",
                roleLabel: "Senior Compliance Approver",
                status: "pending",
              },
              ...(summary.riskBand === "critical"
                ? [{ role: "director", roleLabel: "Director", status: "pending" as const }]
                : []),
            ],
          },
        ]
      : [],
    decisions:
      summary.status === "approved"
        ? [
            {
              id: "d-1",
              outcome: "approved",
              version: 1,
              decidedAt: iso(-2 * DAY),
              decidedByDisplayName: "Senior Compliance Approver",
              rationaleCustomerSafe: "Your onboarding review has completed successfully.",
              rationaleInternal: "All evidence accepted; risk band low; no adverse provider result.",
              conditions: [],
            },
          ]
        : [],
    holds: summary.hasActiveHold
      ? [
          {
            id: "h-1",
            type: summary.type === "sanctions" ? "sanctions" : "critical_risk",
            appliedAt: iso(-6 * HOUR),
            appliedByDisplayName: "K. Patel",
            reasonInternal: "Sanctions screening returned a possible match requiring director review.",
            reasonCustomerSafe: "Review in progress.",
            effects: [
              "Evidence upload allowed",
              "Onboarding blocked",
              "Transaction, POI and WaD blocked",
              "Evidence-pack release blocked",
              "Payment and token actions blocked",
            ],
            requiresDistinctApprover: true,
            active: true,
          },
        ]
      : [],
    timeline: [
      { id: "t-1", at: summary.openedAt, kind: "case_opened", actorDisplayName: "System", summary: "Case opened.", customerVisible: true },
      { id: "t-2", at: iso(-4 * DAY), kind: "assigned", actorDisplayName: "Compliance Ops Lead", summary: `Assigned to ${summary.assignment.analystDisplayName ?? "queue"}.`, customerVisible: false },
      { id: "t-3", at: iso(-3 * DAY), kind: "rfi_issued", actorDisplayName: summary.assignment.analystDisplayName, summary: "RFI issued: proof of address.", customerVisible: true },
      { id: "t-4", at: iso(-3 * HOUR), kind: "risk_recalculated", actorDisplayName: "System", summary: `Risk band recalculated: ${summary.riskBand ?? "unknown"}.`, customerVisible: false },
    ],
    exports: [
      { id: "ex-1", audience: "internal", version: 1, generatedAt: null, expiresAt: null, watermarkApplied: false, sealHashPresent: false, approvalRequired: false, downloadAvailable: false },
      { id: "ex-2", audience: "customer", version: 1, generatedAt: null, expiresAt: null, watermarkApplied: true, sealHashPresent: false, approvalRequired: false, downloadAvailable: false },
      { id: "ex-3", audience: "funder", version: 1, generatedAt: null, expiresAt: null, watermarkApplied: true, sealHashPresent: false, approvalRequired: true, downloadAvailable: false },
    ],
    appeals: [],
  };
}

export const FIXTURE_FUNDER_SUMMARY: FunderSummary = {
  caseReference: "IZ-CMP-2026-000181",
  approvedOutcomeLabel: "Approved",
  highLevelRiskBand: "low",
  materialOutstandingItems: [],
  activeHold: false,
  lastReviewAt: iso(-14 * DAY),
  nextReviewAt: iso(180 * DAY),
  approvedConditions: [],
  evidencePackVersion: "v3",
  accessExpiresAt: iso(30 * DAY),
  releasedByDisplayName: "Senior Compliance Approver",
  purpose: "Transaction due diligence — Facility ref F-2026-0044",
  transactionContext: "F-2026-0044",
};

export const FIXTURE_CUSTOMER_CASE: CustomerCaseView = {
  reference: "IZ-CMP-2026-000123",
  statusLabel: "In Review",
  statusTone: "info",
  outstandingActions: [
    { id: "a-1", title: "Upload a proof of address dated within the last 3 months.", dueAt: iso(7 * DAY) },
  ],
  nextReviewAt: iso(180 * DAY),
  customerSafeMessages: [
    { id: "m-1", at: iso(-3 * DAY), sender: COMPLIANCE_SENDER_NAME, body: "We require a proof of address dated within the last 3 months. Please upload via your compliance area." },
  ],
  timeline: [
    { at: iso(-6 * DAY), label: "Compliance review opened" },
    { at: iso(-3 * DAY), label: "Information requested from you" },
  ],
  disclosureHistory: [],
  appealAvailable: false,
};
