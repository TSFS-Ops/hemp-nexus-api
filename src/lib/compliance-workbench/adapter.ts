/**
 * Compliance Workbench — typed frontend adapter.
 *
 * Two modes:
 *  - "fixture" (default in dev/preview): returns deterministic fixture data.
 *  - "live":   throws NotImplementedError for every mutation and for reads
 *              that have no backend endpoint yet. Reads that DO have a real
 *              backend can be wired by Claude here without touching any
 *              other file in this feature.
 *
 * The workbench must never silently succeed against an unrelated backend
 * table. That's why mutations return `{ ok: false, code: "not_implemented" }`
 * in live mode and callers surface an explicit banner.
 */
import {
  FIXTURE_CASES,
  FIXTURE_CUSTOMER_CASE,
  FIXTURE_FUNDER_SUMMARY,
  FIXTURE_METRICS,
  fixtureCaseDetail,
} from "./fixtures";
import type {
  CaseDetail,
  CaseSummary,
  CustomerCaseView,
  FunderSummary,
  OverviewMetrics,
  QueueFilters,
} from "./types";
import { NotImplementedError, type AdapterMode } from "./types";

/**
 * The default mode is "fixture" so every preview build renders realistic
 * data. Flip via `localStorage.setItem("izenzo.compliance.mode", "live")`
 * or the DevModeSwitch component to test the not-implemented pathway.
 */
export function getAdapterMode(): AdapterMode {
  if (typeof window === "undefined") return "fixture";
  try {
    const v = window.localStorage.getItem("izenzo.compliance.mode");
    return v === "live" ? "live" : "fixture";
  } catch {
    return "fixture";
  }
}

export function setAdapterMode(mode: AdapterMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("izenzo.compliance.mode", mode);
}

export function isDevMode(): boolean {
  if (typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    return true;
  }
  if (typeof window !== "undefined" && window.location.hostname.includes("lovable.app")) {
    return true;
  }
  return false;
}

// ---------- READS ----------

export async function listCases(filters: QueueFilters = {}): Promise<CaseSummary[]> {
  if (getAdapterMode() === "live") {
    throw new NotImplementedError("listCases");
  }
  return filterCases(FIXTURE_CASES, filters);
}

export async function getOverviewMetrics(): Promise<OverviewMetrics> {
  if (getAdapterMode() === "live") throw new NotImplementedError("getOverviewMetrics");
  return FIXTURE_METRICS;
}

export async function getCaseDetail(reference: string): Promise<CaseDetail> {
  if (getAdapterMode() === "live") throw new NotImplementedError("getCaseDetail");
  return fixtureCaseDetail(reference);
}

export async function getCustomerCaseView(): Promise<CustomerCaseView> {
  if (getAdapterMode() === "live") throw new NotImplementedError("getCustomerCaseView");
  return FIXTURE_CUSTOMER_CASE;
}

export async function getFunderSummary(): Promise<FunderSummary> {
  if (getAdapterMode() === "live") throw new NotImplementedError("getFunderSummary");
  return FIXTURE_FUNDER_SUMMARY;
}

// ---------- MUTATIONS ----------
// Every mutation returns a discriminated result so callers can render the
// correct notice. In fixture mode we return `{ ok: true }` after simulated
// latency but persist nothing — this is a UI-only slice.

export interface MutationResult {
  ok: boolean;
  code?: "not_implemented" | "invalid_input" | "conflict";
  message?: string;
}

async function mutate(action: string): Promise<MutationResult> {
  if (getAdapterMode() === "live") {
    return { ok: false, code: "not_implemented", message: `Awaiting secure backend for ${action}.` };
  }
  await new Promise((r) => setTimeout(r, 250));
  return { ok: true };
}

export const complianceMutations = {
  assignCase: (_reference: string, _analyst: string) => mutate("assignCase"),
  reassignCase: (_reference: string, _analyst: string, _reason: string) => mutate("reassignCase"),
  addTask: (_reference: string, _title: string, _dueAt: string) => mutate("addTask"),
  completeTask: (_reference: string, _taskId: string) => mutate("completeTask"),
  uploadEvidence: (_reference: string, _requirementKey: string) => mutate("uploadEvidence"),
  reviewEvidence: (_reference: string, _evidenceId: string, _decision: "accept" | "reject", _reason?: string) =>
    mutate("reviewEvidence"),
  issueRfi: (_reference: string, _items: unknown[]) => mutate("issueRfi"),
  respondToRfi: (_rfiId: string, _itemId: string, _body: string) => mutate("respondToRfi"),
  extendRfi: (_rfiId: string, _newDueAt: string, _reason: string) => mutate("extendRfi"),
  proposeDecision: (_reference: string, _outcome: string, _rationale: string) => mutate("proposeDecision"),
  actOnApproval: (_approvalId: string, _decision: "approve" | "reject", _note?: string) =>
    mutate("actOnApproval"),
  applyHold: (_reference: string, _type: string, _reason: string) => mutate("applyHold"),
  requestHoldRelease: (_holdId: string, _reason: string) => mutate("requestHoldRelease"),
  approveHoldRelease: (_holdId: string, _note?: string) => mutate("approveHoldRelease"),
  addNote: (_reference: string, _type: string, _body: string) => mutate("addNote"),
  sendCustomerMessage: (_reference: string, _body: string) => mutate("sendCustomerMessage"),
  submitAppeal: (_reference: string, _basis: string, _body: string) => mutate("submitAppeal"),
  requestExport: (_reference: string, _audience: string, _purpose: string) => mutate("requestExport"),
  reopenCase: (_reference: string, _reason: string) => mutate("reopenCase"),
  closeCase: (_reference: string, _reason: string) => mutate("closeCase"),
} as const;

// ---------- helpers ----------

function filterCases(cases: CaseSummary[], f: QueueFilters): CaseSummary[] {
  return cases.filter((c) => {
    if (f.unassigned && c.assignment.analystDisplayName) return false;
    if (f.overdue && !c.sla.breached) return false;
    if (f.providerDependent && !c.providerDependent) return false;
    if (f.moreInformationRequired && c.status !== "awaiting_customer") return false;
    if (f.riskBands?.length && (!c.riskBand || !f.riskBands.includes(c.riskBand))) return false;
    if (f.caseTypes?.length && !f.caseTypes.includes(c.type)) return false;
    if (f.statuses?.length && !f.statuses.includes(c.status)) return false;
    if (f.hasHold && !c.hasActiveHold) return false;
    if (f.hasApproval && !c.hasPendingApproval) return false;
    if (f.organisationQuery) {
      const q = f.organisationQuery.toLowerCase();
      if (!c.primarySubject.displayName.toLowerCase().includes(q)) return false;
    }
    if (f.analystQuery) {
      const q = f.analystQuery.toLowerCase();
      const a = (c.assignment.analystDisplayName ?? "").toLowerCase();
      if (!a.includes(q)) return false;
    }
    if (f.text) {
      const t = f.text.toLowerCase();
      const hay = `${c.reference} ${c.primarySubject.displayName} ${c.currentTask ?? ""}`.toLowerCase();
      if (!hay.includes(t)) return false;
    }
    return true;
  });
}
