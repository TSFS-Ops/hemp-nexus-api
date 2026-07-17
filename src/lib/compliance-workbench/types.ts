/**
 * Compliance Workbench — typed domain interfaces used by the frontend
 * adapter. The shape here is UI-facing (human-readable references, no raw
 * UUIDs bubbled up as identifiers) and is deliberately independent from any
 * particular table so Claude can wire the real backend without a rewrite.
 */
import type {
  CaseStatus,
  CaseType,
  DecisionOutcome,
  EvidenceState,
  ExportAudience,
  HoldType,
  NoteType,
  Priority,
  ProviderKind,
  ProviderState,
  RfiItemState,
  RiskBand,
} from "./constants";

export interface CaseSubject {
  id: string;
  kind: "organisation" | "individual" | "entity";
  displayName: string;
  jurisdiction?: string | null;
  relationship?: string; // e.g. "director", "ubo", "authorised representative"
}

export interface CaseAssignment {
  analystDisplayName: string | null;
  team: string | null;
  assignedAt: string | null; // ISO
  handoverReason?: string | null;
}

export interface CaseSlaState {
  targetAt: string | null; // ISO — final decision target
  breached: boolean;
  warning: boolean;
  awaitingCustomerSince?: string | null;
  awaitingProviderSince?: string | null;
  internalMsElapsed?: number;
}

export interface CaseSummary {
  /** Human-readable, non-secret. e.g. IZ-CMP-2026-000123 */
  reference: string;
  /** Internal id — used ONLY by the adapter for API calls, never rendered. */
  internalId: string;
  type: CaseType;
  status: CaseStatus;
  riskBand: RiskBand | null;
  priority: Priority;
  primarySubject: CaseSubject;
  assignment: CaseAssignment;
  sla: CaseSlaState;
  hasActiveHold: boolean;
  hasPendingApproval: boolean;
  hasOpenRfi: boolean;
  providerDependent: boolean;
  currentTask: string | null;
  lastActivityAt: string | null;
  openedAt: string;
}

export interface CaseTimelineEvent {
  id: string;
  at: string;
  kind: string; // free-form; labelled through timeline-labels
  actorDisplayName: string | null;
  actorRole?: string | null;
  summary: string;
  customerVisible: boolean;
  reasonCode?: string | null;
}

export interface CaseEvidenceItem {
  id: string;
  requirementKey: string;
  requirementLabel: string;
  state: EvidenceState;
  fileName?: string | null;
  version: number;
  uploadedAt?: string | null;
  reviewedAt?: string | null;
  reviewedByDisplayName?: string | null;
  rejectionReason?: string | null;
  reviewerNotes?: string | null;
  expiresAt?: string | null;
  attemptsUsed: number;
  attemptsAllowed: number;
  linkedToPack: boolean;
  history: Array<{
    at: string;
    state: EvidenceState;
    actorDisplayName?: string | null;
    note?: string | null;
  }>;
}

export interface CaseRfiItem {
  id: string;
  category: string;
  customerSafeText: string;
  internalReason: string;
  requestedItemType: "document" | "information" | "confirmation";
  state: RfiItemState;
  respondedAt?: string | null;
  responseSummary?: string | null;
}

export interface CaseRfi {
  id: string;
  reference: string;
  issuedAt: string;
  dueAt: string;
  extendedTo?: string | null;
  cycleNumber: number;
  overdue: boolean;
  awaitingCustomer: boolean;
  items: CaseRfiItem[];
  reminderPercents: readonly number[];
  closedAt?: string | null;
}

export interface CaseProviderResult {
  id: string;
  kind: ProviderKind;
  state: ProviderState;
  providerLabel: string | null; // internal only
  requestedAt: string | null;
  receivedAt: string | null;
  expiresAt: string | null;
  manuallyReviewed: boolean;
  reviewedByDisplayName?: string | null;
  publicSafeSummary: string;
}

export interface CaseRiskSnapshot {
  score: number | null;
  band: RiskBand | null;
  calculationVersion: string;
  calculatedAt: string;
  factors: Array<{ key: string; label: string; contribution: number }>;
  overrideActive: boolean;
  overrideExpiresAt?: string | null;
  overrideReason?: string | null;
}

export interface CaseApprovalRequirement {
  role: string;
  roleLabel: string;
  status: "pending" | "approved" | "rejected";
  actedByDisplayName?: string | null;
  actedAt?: string | null;
  note?: string | null;
}

export interface CaseApproval {
  id: string;
  proposedOutcome: DecisionOutcome;
  proposedByDisplayName: string;
  proposedAt: string;
  requirements: CaseApprovalRequirement[];
  emergencyBypass: boolean;
  invalidated: boolean;
}

export interface CaseCondition {
  id: string;
  label: string;
  ownerRole: string;
  dueAt: string;
  monitoringFrequency: string;
  allowedActivities: string[];
  prohibitedActivities: string[];
  breachAction: string;
  expiresAt: string;
  satisfiedAt?: string | null;
}

export interface CaseDecision {
  id: string;
  outcome: DecisionOutcome;
  version: number;
  decidedAt: string;
  decidedByDisplayName: string;
  rationaleCustomerSafe: string;
  rationaleInternal: string;
  conditions: CaseCondition[];
  supersededByVersion?: number | null;
}

export interface CaseHold {
  id: string;
  type: HoldType;
  appliedAt: string;
  appliedByDisplayName: string;
  reasonInternal: string;
  reasonCustomerSafe: string;
  effects: string[];
  releaseRequestedAt?: string | null;
  releaseRequestedByDisplayName?: string | null;
  releasedAt?: string | null;
  releasedByDisplayName?: string | null;
  requiresDistinctApprover: boolean;
  active: boolean;
}

export interface CaseNote {
  id: string;
  type: NoteType;
  createdAt: string;
  authorDisplayName: string;
  authorRole: string;
  body: string;
  editedAt?: string | null;
  editReason?: string | null;
}

export interface CaseAppeal {
  id: string;
  reference: string;
  submittedAt: string;
  submittedByDisplayName: string;
  basis: "new_evidence" | "platform_error" | "provider_error";
  status: "submitted" | "under_review" | "upheld" | "dismissed";
  reviewerDisplayName?: string | null;
  decidedAt?: string | null;
}

export interface CaseExport {
  id: string;
  audience: ExportAudience;
  version: number;
  generatedAt: string | null;
  expiresAt: string | null;
  watermarkApplied: boolean;
  sealHashPresent: boolean;
  approvalRequired: boolean;
  approvedByDisplayName?: string | null;
  downloadAvailable: boolean;
  reason?: string | null;
}

export interface CaseDetail {
  summary: CaseSummary;
  subjects: CaseSubject[];
  relatedRecords: Array<{ label: string; kind: string; reference: string }>;
  evidence: CaseEvidenceItem[];
  providerResults: CaseProviderResult[];
  risk: CaseRiskSnapshot | null;
  rfis: CaseRfi[];
  tasks: Array<{ id: string; title: string; ownerDisplayName: string | null; dueAt: string; done: boolean }>;
  notes: CaseNote[];
  customerMessages: CaseNote[];
  escalations: Array<{ id: string; at: string; level: string; reason: string; ownerDisplayName: string }>;
  approvals: CaseApproval[];
  decisions: CaseDecision[];
  holds: CaseHold[];
  timeline: CaseTimelineEvent[];
  exports: CaseExport[];
  appeals: CaseAppeal[];
}

export interface QueueFilters {
  assignedToMe?: boolean;
  unassigned?: boolean;
  overdue?: boolean;
  providerDependent?: boolean;
  moreInformationRequired?: boolean;
  riskBands?: RiskBand[];
  caseTypes?: CaseType[];
  statuses?: CaseStatus[];
  hasHold?: boolean;
  hasApproval?: boolean;
  organisationQuery?: string;
  analystQuery?: string;
  text?: string;
}

export interface OverviewMetrics {
  openCases: number;
  unassignedCases: number;
  highRiskCases: number;
  criticalRiskCases: number;
  overdueCases: number;
  slaWarnings: number;
  slaBreaches: number;
  outstandingRfis: number;
  pendingApprovals: number;
  activeHolds: number;
  providerErrors: number;
  appeals: number;
  periodicReviewsDue: number;
  averageDecisionHours: number | null;
  timeAwaitingCustomerHours: number | null;
  timeAwaitingProviderHours: number | null;
  approvalTurnaroundHours: number | null;
  riskDistribution: Record<RiskBand, number>;
  statusDistribution: Partial<Record<CaseStatus, number>>;
  caseTypeDistribution: Partial<Record<CaseType, number>>;
  perAnalyst: Array<{ analystDisplayName: string; open: number; overdue: number }>;
}

export interface FunderSummary {
  caseReference: string;
  approvedOutcomeLabel: string;
  highLevelRiskBand: RiskBand;
  materialOutstandingItems: string[];
  activeHold: boolean;
  lastReviewAt: string;
  nextReviewAt: string;
  approvedConditions: string[];
  evidencePackVersion: string;
  accessExpiresAt: string;
  releasedByDisplayName: string;
  purpose: string;
  transactionContext: string | null;
}

export interface CustomerCaseView {
  reference: string;
  statusLabel: string;
  statusTone: "info" | "warn" | "success" | "danger" | "neutral";
  outstandingActions: Array<{ id: string; title: string; dueAt: string | null }>;
  nextReviewAt: string | null;
  customerSafeMessages: Array<{ id: string; at: string; sender: string; body: string }>;
  outcomeLabel?: string;
  conditions?: string[];
  timeline: Array<{ at: string; label: string }>;
  disclosureHistory: Array<{ at: string; recipient: string; category: string; version: string }>;
  appealAvailable: boolean;
}

export type AdapterMode = "fixture" | "live";

export class NotImplementedError extends Error {
  code = "not_implemented";
  constructor(action: string) {
    super(`Compliance action "${action}" is not yet wired to the backend.`);
    this.name = "NotImplementedError";
  }
}
