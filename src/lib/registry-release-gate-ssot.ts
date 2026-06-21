/**
 * Batch 18 — Registry Release Gate, UAT Scenarios and Demo Pack SSOT.
 *
 * Single source of truth for:
 *   - Release statuses and the per-module release-gate matrix.
 *   - Allowed and forbidden readiness wording.
 *   - The controlled UAT scenario pack (end-to-end registry journey).
 *   - The controlled demo data set (clearly labelled demo/UAT only).
 *   - Client-safe limitations list.
 *
 * Used by:
 *   - src/pages/admin/registry/ReleaseGate.tsx
 *   - src/pages/admin/registry/DemoPack.tsx
 *   - src/pages/admin/registry/UatScenarios.tsx
 *   - src/tests/batch-18-end-to-end-uat-release-demo.test.ts
 *   - scripts/check-batch-18-*.mjs guard scripts
 *
 * SAFETY RULES — must not change without an accepted business decision:
 *   - Default release status is NOT `production_ready`.
 *   - Forbidden readiness wording must never appear in the SSOT values
 *     except inside FORBIDDEN_READINESS_WORDING itself (where it is
 *     stringly enumerated as a guard list).
 *   - Demo records are flagged `isDemo: true` and must never be presented
 *     as real production data.
 *   - Demo bank-detail fields are fake/safe and never raw production
 *     account numbers.
 */

export const RELEASE_STATUSES = [
  "not_started",
  "blocked",
  "partial",
  "uat_ready",
  "demo_ready",
  "production_blocked",
  "production_ready",
] as const;

export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const DEFAULT_FINAL_RELEASE_STATUS: ReleaseStatus = "demo_ready";

export const ALLOWED_READINESS_WORDING = [
  "Demo-ready",
  "UAT-ready",
  "Controlled test mode",
  "Backend accepted",
  "UI accepted",
  "Provider integration not yet enabled",
  "Production access disabled by default",
  "Bank details captured but not verified",
  "Verified only where final verification gates pass",
] as const;

/**
 * Wording that must never appear in user-facing release-readiness copy
 * unless an accepted business decision and gate explicitly authorise it.
 * Enforced by `scripts/check-batch-18-forbidden-readiness-wording.mjs`.
 */
export const FORBIDDEN_READINESS_WORDING = [
  "Production-ready",
  "Live",
  "Provider verified",
  "Bank verified",
  "Guaranteed accurate",
  "Fully verified registry",
  "Ready for all customers",
  "Real-time bank verification",
  "Raw bank details available",
  "Automatic approval",
] as const;

export const DEMO_DATA_WARNING_COPY =
  "This is demo/UAT data. It must not be treated as production registry data.";

/* ────────────────────────── Release gate matrix ────────────────────────── */

export interface ReleaseGateRow {
  /** Module key — stable identifier */
  key: string;
  /** Human label */
  label: string;
  /** Originating batch references */
  batches: string[];
  /** Current release status */
  status: ReleaseStatus;
  /** Blocker reason, when applicable */
  blocker: string | null;
  /** Evidence README reference */
  evidence: string;
  /** Owner team */
  owner: string;
  /** ISO date string of last review */
  lastChecked: string;
  /** Next action */
  nextAction: string;
}

const TODAY = "2026-06-21";

export const RELEASE_GATE_MATRIX: ReleaseGateRow[] = [
  {
    key: "registry_foundation",
    label: "Registry foundation",
    batches: ["1"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-1-registry-foundation/README.md",
    owner: "registry",
    lastChecked: TODAY,
    nextAction: "Maintain readiness states per country.",
  },
  {
    key: "product_truth_readiness",
    label: "Product truth and readiness",
    batches: ["1"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-1-registry-foundation/README.md",
    owner: "registry",
    lastChecked: TODAY,
    nextAction: "Hold readiness wording at controlled-test mode.",
  },
  {
    key: "business_decisions",
    label: "Business decisions register",
    batches: ["1"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-1-registry-foundation/README.md",
    owner: "governance",
    lastChecked: TODAY,
    nextAction: "Continue logging decisions before enabling any gate.",
  },
  {
    key: "provenance",
    label: "Field-level provenance",
    batches: ["2"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-2-registry-provenance-coverage-imports/README.md",
    owner: "registry",
    lastChecked: TODAY,
    nextAction: "Re-confirm provenance on each import batch.",
  },
  {
    key: "country_coverage",
    label: "Country coverage controls",
    batches: ["2"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-2-registry-provenance-coverage-imports/README.md",
    owner: "registry",
    lastChecked: TODAY,
    nextAction: "Coverage must remain country-by-country.",
  },
  {
    key: "import_pipeline",
    label: "Import pipeline",
    batches: ["2", "9", "10", "12"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-9-registry-source-import-validation/README.md",
    owner: "registry",
    lastChecked: TODAY,
    nextAction: "Imported records remain admin-staged until published.",
  },
  {
    key: "public_search",
    label: "Public registry search",
    batches: ["8"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-8-registry-record-search-profile/README.md",
    owner: "registry",
    lastChecked: TODAY,
    nextAction: "Search results must never imply verification.",
  },
  {
    key: "public_company_profile",
    label: "Public company profile",
    batches: ["8"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-8-registry-record-search-profile/README.md",
    owner: "registry",
    lastChecked: TODAY,
    nextAction: "Profile must hide personal contacts and bank fields.",
  },
  {
    key: "claim_workflow",
    label: "Claim workflow",
    batches: ["3", "10", "11"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-11-real-claim-submission-review/README.md",
    owner: "compliance",
    lastChecked: TODAY,
    nextAction: "Approved claim never implies verification.",
  },
  {
    key: "authority_to_act",
    label: "Authority-to-act workflow",
    batches: ["12"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-12-authority-to-act-request-review/README.md",
    owner: "compliance",
    lastChecked: TODAY,
    nextAction: "Approved authority never implies verification.",
  },
  {
    key: "bank_detail_submission",
    label: "Bank-detail submission",
    batches: ["13", "13B"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-13b-bank-detail-ui-wiring/README.md",
    owner: "compliance",
    lastChecked: TODAY,
    nextAction: "Captured ≠ verified; copy must remain explicit.",
  },
  {
    key: "bank_detail_review",
    label: "Bank-detail review",
    batches: ["13", "13B"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-13b-bank-detail-ui-wiring/README.md",
    owner: "compliance",
    lastChecked: TODAY,
    nextAction: "Reviewer copy must mark non-final states as not verified.",
  },
  {
    key: "bank_verification",
    label: "Bank verification decision layer",
    batches: ["14", "14B"],
    status: "uat_ready",
    blocker: "Live provider integration not yet enabled — simulation only.",
    evidence: "evidence/batch-14b-bank-verification-ui-status/README.md",
    owner: "compliance",
    lastChecked: TODAY,
    nextAction: "Hold verified label until Batch 14 final gate passes.",
  },
  {
    key: "api_profile_status",
    label: "Institutional API — profile-status",
    batches: ["15", "15B"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-15b-institutional-api-admin-ui/README.md",
    owner: "platform",
    lastChecked: TODAY,
    nextAction: "Production access remains disabled by default.",
  },
  {
    key: "api_payment_status",
    label: "Institutional API — payment-status",
    batches: ["15", "15B"],
    status: "uat_ready",
    blocker: "Non-final verification states must render as not verified.",
    evidence: "evidence/batch-15b-institutional-api-admin-ui/README.md",
    owner: "platform",
    lastChecked: TODAY,
    nextAction: "Keep payment-status safe-mapping enforced.",
  },
  {
    key: "api_client_management",
    label: "API client management",
    batches: ["15B"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-15b-institutional-api-admin-ui/README.md",
    owner: "platform",
    lastChecked: TODAY,
    nextAction: "Production approval requires acknowledgement checklist.",
  },
  {
    key: "company_portal",
    label: "Company portal guided journey",
    batches: ["16"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-16-company-portal-guided-journey/README.md",
    owner: "registry",
    lastChecked: TODAY,
    nextAction: "Next-step engine must remain deterministic.",
  },
  {
    key: "admin_operations_centre",
    label: "Admin operations centre",
    batches: ["17"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-17-registry-admin-operations-centre/README.md",
    owner: "platform",
    lastChecked: TODAY,
    nextAction: "Keep operations data role-gated.",
  },
  {
    key: "audit_logging",
    label: "Audit logging coverage",
    batches: ["1", "3", "10", "11", "12", "13", "14", "15", "16", "17"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-17-registry-admin-operations-centre/README.md",
    owner: "governance",
    lastChecked: TODAY,
    nextAction: "Maintain event-coverage check on every status change.",
  },
  {
    key: "rls_security",
    label: "RLS and security posture",
    batches: ["all"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-18-end-to-end-uat-release-demo/README.md",
    owner: "platform",
    lastChecked: TODAY,
    nextAction: "Re-run security regression pack each release.",
  },
  {
    key: "no_raw_bank_exposure",
    label: "No raw bank exposure",
    batches: ["13", "13B", "14", "14B", "15", "15B", "16", "17", "18"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-18-end-to-end-uat-release-demo/README.md",
    owner: "platform",
    lastChecked: TODAY,
    nextAction: "Guards prevent raw bank fields across all surfaces.",
  },
  {
    key: "no_personal_contact_leakage",
    label: "No personal contact leakage",
    batches: ["12", "16", "17", "18"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-12-registry-people-personal-contact/README.md",
    owner: "platform",
    lastChecked: TODAY,
    nextAction: "Personal contacts remain admin-only and audited.",
  },
  {
    key: "no_provider_payload_leakage",
    label: "No provider payload leakage",
    batches: ["14", "14B", "15", "15B"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-14b-bank-verification-ui-status/README.md",
    owner: "platform",
    lastChecked: TODAY,
    nextAction: "Provider payloads stay server-side only.",
  },
  {
    key: "demo_uat_controls",
    label: "Demo/UAT controls",
    batches: ["18"],
    status: "demo_ready",
    blocker: null,
    evidence: "evidence/batch-18-end-to-end-uat-release-demo/README.md",
    owner: "registry",
    lastChecked: TODAY,
    nextAction: "Demo records remain labelled and non-production.",
  },
  {
    key: "readiness_wording",
    label: "Readiness wording controls",
    batches: ["1", "18"],
    status: "uat_ready",
    blocker: null,
    evidence: "evidence/batch-18-end-to-end-uat-release-demo/README.md",
    owner: "governance",
    lastChecked: TODAY,
    nextAction: "Forbidden wording guard runs at prebuild.",
  },
];

/** Required modules — every release-gate review must cover these keys. */
export const REQUIRED_RELEASE_GATE_MODULES = RELEASE_GATE_MATRIX.map(
  (r) => r.key,
);

/** Overall final release status — derived, defensive. */
export function computeFinalReleaseStatus(
  matrix: ReleaseGateRow[] = RELEASE_GATE_MATRIX,
): ReleaseStatus {
  if (matrix.some((r) => r.status === "blocked" || r.status === "production_blocked")) {
    return "production_blocked";
  }
  if (matrix.every((r) => r.status === "production_ready")) {
    return "production_ready";
  }
  if (matrix.every((r) => r.status === "uat_ready" || r.status === "demo_ready" || r.status === "production_ready")) {
    return DEFAULT_FINAL_RELEASE_STATUS;
  }
  return "partial";
}

/* ───────────────────────── UAT scenario pack ────────────────────────── */

export interface UatScenario {
  id: string;
  title: string;
  role:
    | "public_user"
    | "authenticated_user"
    | "compliance_analyst"
    | "platform_admin"
    | "api_client";
  startingState: string;
  steps: string[];
  expected: string;
  safetyRules: string[];
  routeOrFunction: string;
  evidenceRef: string;
}

export const UAT_SCENARIOS: UatScenario[] = [
  {
    id: "uat-01-public-search",
    title: "Public user searches for a company",
    role: "public_user",
    startingState: "Imported company present in registry",
    steps: ["Open /registry/search", "Search by company name"],
    expected: "Safe result list without contact or bank fields",
    safetyRules: ["no personal contact", "no bank fields", "no verified wording"],
    routeOrFunction: "/registry/search",
    evidenceRef: "evidence/batch-8-registry-record-search-profile/README.md",
  },
  {
    id: "uat-02-public-profile",
    title: "Public user views safe company profile",
    role: "public_user",
    startingState: "Published company record",
    steps: ["Open /registry/company/:id"],
    expected: "Safe profile rendered; sensitive fields hidden",
    safetyRules: ["no personal contact", "no bank fields"],
    routeOrFunction: "/registry/company/:id",
    evidenceRef: "evidence/batch-8-registry-record-search-profile/README.md",
  },
  {
    id: "uat-03-start-claim",
    title: "User starts a claim",
    role: "authenticated_user",
    startingState: "Claimable company exists",
    steps: ["Open /registry/company/:id/claim", "Submit claim form"],
    expected: "Claim recorded in submitted state",
    safetyRules: ["claim ≠ verification"],
    routeOrFunction: "/registry/company/:id/claim",
    evidenceRef: "evidence/batch-11-real-claim-submission-review/README.md",
  },
  {
    id: "uat-04-claim-evidence",
    title: "User uploads claim evidence",
    role: "authenticated_user",
    startingState: "Submitted claim",
    steps: ["Open claim status", "Upload evidence document"],
    expected: "Evidence recorded; not auto-approved",
    safetyRules: ["no automatic approval"],
    routeOrFunction: "/registry/claims/:claimId",
    evidenceRef: "evidence/batch-11-real-claim-submission-review/README.md",
  },
  {
    id: "uat-05-claim-review",
    title: "Admin/compliance reviews claim",
    role: "compliance_analyst",
    startingState: "Claim with evidence",
    steps: ["Open /admin/registry/claims-review", "Review evidence", "Record decision"],
    expected: "Decision recorded with audit event",
    safetyRules: ["review-gated", "audited"],
    routeOrFunction: "/admin/registry/claims-review",
    evidenceRef: "evidence/batch-11-real-claim-submission-review/README.md",
  },
  {
    id: "uat-06-claim-approved",
    title: "Claim is approved",
    role: "compliance_analyst",
    startingState: "Claim under review",
    steps: ["Approve claim with reasons"],
    expected: "Claim approved; company portal next-step advances",
    safetyRules: ["approval ≠ verification"],
    routeOrFunction: "/admin/registry/claims-review",
    evidenceRef: "evidence/batch-11-real-claim-submission-review/README.md",
  },
  {
    id: "uat-07-authority-request",
    title: "User requests authority-to-act",
    role: "authenticated_user",
    startingState: "Approved claim",
    steps: ["Open /registry/authority", "Submit authority request"],
    expected: "Authority request recorded",
    safetyRules: ["review-gated"],
    routeOrFunction: "/registry/authority",
    evidenceRef: "evidence/batch-12-authority-to-act-request-review/README.md",
  },
  {
    id: "uat-08-authority-evidence",
    title: "User uploads authority evidence",
    role: "authenticated_user",
    startingState: "Submitted authority request",
    steps: ["Upload board resolution / mandate"],
    expected: "Evidence recorded against authority request",
    safetyRules: ["no automatic approval"],
    routeOrFunction: "/registry/authority/:authorityRequestId",
    evidenceRef: "evidence/batch-12-authority-to-act-request-review/README.md",
  },
  {
    id: "uat-09-authority-review",
    title: "Admin/compliance reviews authority",
    role: "compliance_analyst",
    startingState: "Authority request with evidence",
    steps: ["Open /admin/registry/authority/:authorityRequestId", "Record decision"],
    expected: "Decision recorded with audit event",
    safetyRules: ["review-gated", "audited"],
    routeOrFunction: "/admin/registry/authority/:authorityRequestId",
    evidenceRef: "evidence/batch-12-authority-to-act-request-review/README.md",
  },
  {
    id: "uat-10-authority-approved",
    title: "Authority approved",
    role: "compliance_analyst",
    startingState: "Authority under review",
    steps: ["Approve with scope"],
    expected: "Authority approved within scope only",
    safetyRules: ["approval ≠ verification"],
    routeOrFunction: "/admin/registry/authority/:authorityRequestId",
    evidenceRef: "evidence/batch-12-authority-to-act-request-review/README.md",
  },
  {
    id: "uat-11-bank-submit",
    title: "User submits bank details",
    role: "authenticated_user",
    startingState: "Approved authority",
    steps: ["Open /registry/bank-details", "Submit fields with consent"],
    expected: "Submission recorded with consent receipt",
    safetyRules: ["captured ≠ verified"],
    routeOrFunction: "/registry/bank-details",
    evidenceRef: "evidence/batch-13b-bank-detail-ui-wiring/README.md",
  },
  {
    id: "uat-12-bank-review",
    title: "Admin reviews bank-detail submission",
    role: "compliance_analyst",
    startingState: "Pending bank-detail submission",
    steps: ["Open /admin/registry/bank-details/submissions/:id", "Record decision"],
    expected: "Decision recorded; raw bank fields never displayed in full",
    safetyRules: ["no raw bank exposure", "audited"],
    routeOrFunction: "/admin/registry/bank-details/submissions/:id",
    evidenceRef: "evidence/batch-13b-bank-detail-ui-wiring/README.md",
  },
  {
    id: "uat-13-captured-not-verified",
    title: "Bank details become captured but not verified",
    role: "authenticated_user",
    startingState: "Submission accepted",
    steps: ["Open /registry/bank-details/:id"],
    expected: "Status renders explicitly as captured (not verified)",
    safetyRules: ["captured ≠ verified"],
    routeOrFunction: "/registry/bank-details/:id",
    evidenceRef: "evidence/batch-13b-bank-detail-ui-wiring/README.md",
  },
  {
    id: "uat-14-verification-requested",
    title: "Verification is requested",
    role: "compliance_analyst",
    startingState: "Captured bank details",
    steps: ["Open /admin/registry/bank-verification/:id", "Request verification"],
    expected: "Verification request recorded; status remains not verified",
    safetyRules: ["non-final ≠ verified", "no live provider"],
    routeOrFunction: "/admin/registry/bank-verification/:id",
    evidenceRef: "evidence/batch-14b-bank-verification-ui-status/README.md",
  },
  {
    id: "uat-15-verification-gates",
    title: "Verification decision gates reviewed",
    role: "compliance_analyst",
    startingState: "Verification requested",
    steps: ["Review gate decisions"],
    expected: "All gate decisions visible; raw payloads hidden",
    safetyRules: ["no provider payload leakage"],
    routeOrFunction: "/admin/registry/bank-verification/:id",
    evidenceRef: "evidence/batch-14b-bank-verification-ui-status/README.md",
  },
  {
    id: "uat-16-non-final-not-verified",
    title: "Non-final verification status remains not verified",
    role: "authenticated_user",
    startingState: "Non-final verification state",
    steps: ["Open /registry/bank-details/:id"],
    expected: "Label renders as Not verified",
    safetyRules: ["captured ≠ verified", "manual_verified ≠ verified"],
    routeOrFunction: "/registry/bank-details/:id",
    evidenceRef: "evidence/batch-14b-bank-verification-ui-status/README.md",
  },
  {
    id: "uat-17-final-verified",
    title: "Final verified status only when gate permits",
    role: "authenticated_user",
    startingState: "Final verified through accepted gate",
    steps: ["Open /registry/bank-details/:id"],
    expected: "Verified label shown only when Batch 14 final gate passes",
    safetyRules: ["final verified only when accepted gate passes"],
    routeOrFunction: "/registry/bank-details/:id",
    evidenceRef: "evidence/batch-14b-bank-verification-ui-status/README.md",
  },
  {
    id: "uat-18-api-profile-status",
    title: "Institutional API profile-status query",
    role: "api_client",
    startingState: "Sandbox API client; allowed scope/country",
    steps: ["Call profile-status from test console"],
    expected: "Safe envelope returned; no raw fields",
    safetyRules: ["no raw bank", "no full key"],
    routeOrFunction: "/admin/registry/api-test-console",
    evidenceRef: "evidence/batch-15b-institutional-api-admin-ui/README.md",
  },
  {
    id: "uat-19-api-payment-status",
    title: "Institutional API payment-status query",
    role: "api_client",
    startingState: "Sandbox API client",
    steps: ["Call payment-status from test console"],
    expected: "Non-final bank states render as Not verified",
    safetyRules: ["non-final ≠ verified"],
    routeOrFunction: "/admin/registry/api-test-console",
    evidenceRef: "evidence/batch-15b-institutional-api-admin-ui/README.md",
  },
  {
    id: "uat-20-company-portal",
    title: "Company portal shows correct next step",
    role: "authenticated_user",
    startingState: "User with one claimed company",
    steps: ["Open /registry/my-companies/:id"],
    expected: "Deterministic safe next-step rendered",
    safetyRules: ["captured ≠ verified", "no raw bank"],
    routeOrFunction: "/registry/my-companies/:id",
    evidenceRef: "evidence/batch-16-company-portal-guided-journey/README.md",
  },
  {
    id: "uat-21-admin-operations",
    title: "Admin operations centre shows related work items",
    role: "platform_admin",
    startingState: "Mixed work-item backlog",
    steps: ["Open /admin/registry/operations"],
    expected: "Cockpit lists work items, SLAs and risk safely",
    safetyRules: ["no raw bank", "no full keys"],
    routeOrFunction: "/admin/registry/operations",
    evidenceRef: "evidence/batch-17-registry-admin-operations-centre/README.md",
  },
  {
    id: "uat-22-correction",
    title: "Correction request review-gated",
    role: "authenticated_user",
    startingState: "Claim approved",
    steps: ["Open /registry/my-companies/:id/corrections", "Submit correction"],
    expected: "Correction submitted; remains review-gated",
    safetyRules: ["review-gated", "no automatic approval"],
    routeOrFunction: "/registry/my-companies/:id/corrections",
    evidenceRef: "evidence/batch-16-company-portal-guided-journey/README.md",
  },
  {
    id: "uat-23-dispute",
    title: "Dispute review-gated",
    role: "authenticated_user",
    startingState: "Verification or claim contested",
    steps: ["Open /registry/my-companies/:id/disputes", "Submit dispute"],
    expected: "Dispute submitted; remains review-gated",
    safetyRules: ["review-gated"],
    routeOrFunction: "/registry/my-companies/:id/disputes",
    evidenceRef: "evidence/batch-16-company-portal-guided-journey/README.md",
  },
  {
    id: "uat-24-revocation",
    title: "Revocation request review-gated",
    role: "authenticated_user",
    startingState: "Active claim/authority",
    steps: ["Open /registry/my-companies/:id/revocations", "Submit revocation"],
    expected: "Revocation submitted with consequences acknowledged",
    safetyRules: ["consequence-gated", "review-gated"],
    routeOrFunction: "/registry/my-companies/:id/revocations",
    evidenceRef: "evidence/batch-16-company-portal-guided-journey/README.md",
  },
  {
    id: "uat-25-expired-revoked-disputed",
    title: "Expired/revoked/disputed verification returns not verified",
    role: "api_client",
    startingState: "Bank verification expired or revoked or disputed",
    steps: ["Query payment-status"],
    expected: "Response renders as Not verified",
    safetyRules: ["non-final ≠ verified"],
    routeOrFunction: "/admin/registry/api-test-console",
    evidenceRef: "evidence/batch-14b-bank-verification-ui-status/README.md",
  },
];

export const REQUIRED_UAT_SCENARIO_KEYS = UAT_SCENARIOS.map((s) => s.id);

/* ─────────────────────────── Demo data set ──────────────────────────── */

export interface DemoRecord {
  id: string;
  label: string;
  kind:
    | "company"
    | "api_client"
    | "api_event"
    | "request"
    | "readiness_blocker"
    | "audit_trail";
  isDemo: true;
  notes: string;
}

export const DEMO_RECORDS: DemoRecord[] = [
  { id: "demo-co-za-01", label: "South Africa company (UAT)", kind: "company", isDemo: true, notes: "Public profile demo." },
  { id: "demo-co-ng-01", label: "Nigeria company (UAT)", kind: "company", isDemo: true, notes: "Coverage demo." },
  { id: "demo-co-imported-01", label: "Imported unverified company (UAT)", kind: "company", isDemo: true, notes: "Search demo." },
  { id: "demo-co-claimable-01", label: "Claimable company (UAT)", kind: "company", isDemo: true, notes: "Claim start demo." },
  { id: "demo-co-claim-approved-01", label: "Claim-approved company (UAT)", kind: "company", isDemo: true, notes: "Approved claim demo." },
  { id: "demo-co-authority-approved-01", label: "Authority-approved company (UAT)", kind: "company", isDemo: true, notes: "Authority demo." },
  { id: "demo-co-bank-captured-01", label: "Bank captured, not verified (UAT)", kind: "company", isDemo: true, notes: "Fake bank values." },
  { id: "demo-co-verification-requested-01", label: "Verification requested (UAT)", kind: "company", isDemo: true, notes: "Simulation only." },
  { id: "demo-co-final-verified-01", label: "Final verified where gate permits (UAT)", kind: "company", isDemo: true, notes: "Gate-permitted demo." },
  { id: "demo-co-expired-01", label: "Expired verification (UAT)", kind: "company", isDemo: true, notes: "Returns not verified." },
  { id: "demo-co-disputed-01", label: "Disputed verification (UAT)", kind: "company", isDemo: true, notes: "Returns not verified." },
  { id: "demo-co-revoked-01", label: "Revoked verification (UAT)", kind: "company", isDemo: true, notes: "Returns not verified." },
  { id: "demo-api-sandbox-01", label: "API client — sandbox (UAT)", kind: "api_client", isDemo: true, notes: "Fake key only." },
  { id: "demo-api-prod-pending-01", label: "API client — production pending (UAT)", kind: "api_client", isDemo: true, notes: "Approval checklist demo." },
  { id: "demo-api-suspended-01", label: "API client — suspended (UAT)", kind: "api_client", isDemo: true, notes: "Suspension demo." },
  { id: "demo-api-blocked-req-01", label: "Blocked API request (UAT)", kind: "api_event", isDemo: true, notes: "Scope/country block." },
  { id: "demo-api-rate-limited-01", label: "Rate-limited API request (UAT)", kind: "api_event", isDemo: true, notes: "Quota demo." },
  { id: "demo-correction-01", label: "Correction request (UAT)", kind: "request", isDemo: true, notes: "Review-gated." },
  { id: "demo-dispute-01", label: "Dispute (UAT)", kind: "request", isDemo: true, notes: "Review-gated." },
  { id: "demo-revocation-01", label: "Revocation request (UAT)", kind: "request", isDemo: true, notes: "Consequence-gated." },
  { id: "demo-readiness-blocker-01", label: "Readiness blocker (UAT)", kind: "readiness_blocker", isDemo: true, notes: "Live provider not enabled." },
  { id: "demo-audit-trail-01", label: "Audit activity trail (UAT)", kind: "audit_trail", isDemo: true, notes: "Safe redacted events." },
];

/* ─────────────────────── Client-safe limitations ────────────────────── */

export const CLIENT_SAFE_LIMITATIONS = [
  "Live provider verification is not enabled.",
  "Production API access is disabled by default.",
  "Imported registry data requires provenance and freshness controls.",
  "Claim approval does not itself verify the company.",
  "Authority approval does not itself verify the company.",
  "Bank-detail capture does not itself verify the bank details.",
  "Manual verification requires an approved business decision and a compliance gate.",
  "Provider simulation is not real provider verification.",
  "Raw bank details are not exposed through public or API routes.",
  "Country readiness is controlled country-by-country.",
  "Demo/UAT data must not be treated as production data.",
] as const;
