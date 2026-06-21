import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HostnameRouter } from "@/components/HostnameRouter";
import { getHostType } from "@/lib/hostname";
import { ROUTES } from "@/lib/constants";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import { LegacyRedirect } from "@/components/LegacyRedirect";
import { LegacyRedirectBanner } from "@/components/LegacyRedirectBanner";
import { AuthRedirectNoticeBanner } from "@/components/AuthRedirectNoticeBanner";
import { RequireAuth } from "@/components/RequireAuth";
import { TestModeBanner } from "@/components/TestModeBanner";
import { DemoModeBanner } from "@/components/ops/DemoModeBanner";
import { MaintenanceBanner } from "@/components/MaintenanceBanner";
import { MaintenancePage, MAINTENANCE_MODE } from "@/components/MaintenancePage";
import { SessionExpiredModal } from "@/components/SessionExpiredModal";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { CrossTabCacheBridge } from "@/lib/cross-tab-bus";

/** Roles permitted to enter the Governance Console (matches ContextSwitcher matrix). */
const GOVERNANCE_ROLES = ["platform_admin", "auditor", "org_admin"] as const;

/** Roles permitted to enter the authenticated Developer Center (API keys, webhooks, schema explorer). */
const DEVELOPER_ROLES = ["platform_admin", "org_admin"] as const;

// Eagerly loaded - critical path
import Landing from "@/pages/Landing";
import Auth from "@/pages/Auth";

// Lazy loaded - secondary routes (reduces initial bundle ~40%)
// Dashboard page deleted, every /dashboard/* path now redirects into /desk (see RedirectDashboardMatch + routes below).
// Admin lazy import removed, /admin/* now redirects to /hq tabs (see routes below).
const Docs = lazy(() => import("@/pages/Docs"));
const Pricing = lazy(() => import("@/pages/Pricing"));
const Billing = lazy(() => import("@/pages/Billing"));
const WalkthroughReport = lazy(() => import("@/pages/WalkthroughReport"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const Unsubscribe = lazy(() => import("@/pages/Unsubscribe"));
// DeveloperApiKeys / DeveloperWebhooks pages were removed, superseded by DeveloperCenter.
const GovernanceTriage = lazy(() => import("@/pages/GovernanceTriage"));
const GovernanceAudits = lazy(() => import("@/pages/GovernanceAudits"));
const GovernanceEntities = lazy(() => import("@/pages/GovernanceEntities"));
const GovernanceHealth = lazy(() => import("@/pages/GovernanceHealth"));
// TradeDealWizard now mounted inside the Desk shell at /desk/wizard.
const Welcome = lazy(() => import("@/pages/Welcome"));
const Desk = lazy(() => import("@/pages/Desk"));
const DeveloperCenter = lazy(() => import("@/pages/DeveloperCenter"));
const HQ = lazy(() => import("@/pages/HQ"));
const TradeDeskProductPage = lazy(() => import("@/pages/products/TradeDesk"));
const ComplianceEngineProductPage = lazy(() => import("@/pages/products/ComplianceEngine"));
const AuditLedgerProductPage = lazy(() => import("@/pages/products/AuditLedger"));
const TradersSolutionsPage = lazy(() => import("@/pages/solutions/Traders"));
const FinanceSolutionsPage = lazy(() => import("@/pages/solutions/Finance"));
const SovereignsSolutionsPage = lazy(() => import("@/pages/solutions/Sovereigns"));
const Developers = lazy(() => import("@/pages/Developers"));
const DocsIndex = lazy(() => import("@/pages/docs/Index"));
const DocsQuickstart = lazy(() => import("@/pages/docs/Quickstart"));
const DocsApiReference = lazy(() => import("@/pages/docs/ApiReference"));
const DocsAuthentication = lazy(() => import("@/pages/docs/Authentication"));
const DocsWebhooks = lazy(() => import("@/pages/docs/Webhooks"));
const DocsMatches = lazy(() => import("@/pages/docs/Matches"));
const DocsCounterparties = lazy(() => import("@/pages/docs/Counterparties"));
const DocsEvidence = lazy(() => import("@/pages/docs/Evidence"));
const DocsErrors = lazy(() => import("@/pages/docs/Errors"));
const DocsCounterpartyRatingMethodology = lazy(() => import("@/pages/docs/CounterpartyRatingMethodology"));
const Status = lazy(() => import("@/pages/Status"));
const Trust = lazy(() => import("@/pages/Trust"));

// Batch 1 — Business Registry shell (M001) + admin readiness (M019) + decisions (M018)
const RegistryLanding = lazy(() => import("@/pages/registry/Landing"));
const RegistrySearch = lazy(() => import("@/pages/registry/Search"));
const RegistryCompanyProfile = lazy(() => import("@/pages/registry/CompanyProfile"));
const RegistryNewCompanyRequest = lazy(() => import("@/pages/registry/NewCompanyRequest"));
const RegistryClaim = lazy(() => import("@/pages/registry/Claim"));
const RegistryClaimsList = lazy(() => import("@/pages/registry/ClaimsList"));
const RegistryClaimStatus = lazy(() => import("@/pages/registry/ClaimStatus"));
const AdminRegistryClaimsReview = lazy(() => import("@/pages/admin/registry/ClaimsReview"));
const RegistryReadiness = lazy(() => import("@/pages/registry/Readiness"));
const AdminRegistryIndex = lazy(() => import("@/pages/admin/registry/Index"));
const AdminRegistryReadiness = lazy(() => import("@/pages/admin/registry/Readiness"));
const AdminRegistryDecisions = lazy(() => import("@/pages/admin/registry/Decisions"));
// Batch 2 — M010 provenance / M011 country coverage / M012 import batches
const AdminRegistryProvenance = lazy(() => import("@/pages/admin/registry/Provenance"));
const AdminRegistryCoverage = lazy(() => import("@/pages/admin/registry/Coverage"));
const AdminRegistryImports = lazy(() => import("@/pages/admin/registry/Imports"));
// Batch 3 — M004 admin claims queue
const AdminRegistryClaims = lazy(() => import("@/pages/admin/registry/Claims"));
// Batch 4 — M005 / M006 / M007 authority + bank-detail pages
const RegistryAuthority = lazy(() => import("@/pages/registry/Authority"));
const RegistryBankDetails = lazy(() => import("@/pages/registry/BankDetails"));
const AdminRegistryAuthority = lazy(() => import("@/pages/admin/registry/Authority"));
const AdminRegistryBankDetails = lazy(() => import("@/pages/admin/registry/BankDetails"));
// Batch 13B — Consent-based bank-detail submission/review UI
const BankDetailSubmit = lazy(() => import("@/pages/registry/BankDetailSubmit"));
const BankDetailStatus = lazy(() => import("@/pages/registry/BankDetailStatus"));
const AdminBankDetailQueue = lazy(() =>
  import("@/pages/admin/registry/BankDetailReview").then((m) => ({ default: m.AdminBankDetailQueue })),
);
const AdminBankDetailReview = lazy(() =>
  import("@/pages/admin/registry/BankDetailReview").then((m) => ({ default: m.AdminBankDetailReview })),
);
// Batch 14B — Bank verification admin UI (separate from B13B review)
const AdminBankVerificationQueue = lazy(() =>
  import("@/pages/admin/registry/BankVerificationReview").then((m) => ({ default: m.AdminBankVerificationQueue })),
);
const AdminBankVerificationReview = lazy(() =>
  import("@/pages/admin/registry/BankVerificationReview").then((m) => ({ default: m.AdminBankVerificationReview })),
);
// Batch 5 — M008 / M009 / M016 institutional API management
const AdminRegistryApi = lazy(() => import("@/pages/admin/registry/Api"));
// Batch 15B — Institutional API admin UI
const AdminApiClientsList = lazy(() => import("@/pages/admin/registry/ApiClientsList"));
const AdminApiClientDetail = lazy(() => import("@/pages/admin/registry/ApiClientDetail"));
const AdminApiUsage = lazy(() => import("@/pages/admin/registry/ApiUsage"));
const AdminApiTestConsole = lazy(() => import("@/pages/admin/registry/ApiTestConsole"));
// Batch 6 — M013 / M014 / M015 / M017 operations + outreach + readiness
const AdminRegistryOperations = lazy(() => import("@/pages/admin/registry/Operations"));
// Batch 17 — Registry Admin Operations Centre
const AdminRegistryOpsCentre = lazy(() => import("@/pages/admin/registry/operations/Centre"));
const AdminRegistryOpsQueue = lazy(() => import("@/pages/admin/registry/operations/Queue"));
const AdminRegistryOpsSlas = lazy(() => import("@/pages/admin/registry/operations/Slas"));
const AdminRegistryOpsRisk = lazy(() => import("@/pages/admin/registry/operations/Risk"));
const AdminRegistryOpsReadiness = lazy(() => import("@/pages/admin/registry/operations/Readiness"));
const AdminRegistryOpsAudit = lazy(() => import("@/pages/admin/registry/operations/Audit"));
const AdminRegistryOutreachDrafts = lazy(() => import("@/pages/admin/registry/OutreachDrafts"));
const AdminRegistryOutreachApprovals = lazy(() => import("@/pages/admin/registry/OutreachApprovals"));
const AdminRegistryDoNotContact = lazy(() => import("@/pages/admin/registry/DoNotContact"));
// Batch 7 — new-company requests, correction requests, claim conflicts
const AdminRegistryNewCompanyRequests = lazy(() => import("@/pages/admin/registry/NewCompanyRequests"));
const AdminRegistryCorrectionRequests = lazy(() => import("@/pages/admin/registry/CorrectionRequests"));
const AdminRegistryClaimConflicts = lazy(() => import("@/pages/admin/registry/ClaimConflicts"));
const AdminRegistryBatch7AuditLog = lazy(() => import("@/pages/admin/registry/Batch7AuditLog"));
const AdminRegistryRecords = lazy(() => import("@/pages/admin/registry/Records"));
// Batch 10 — claim activation & record lifecycle controls
const AdminRegistryClaimActivation = lazy(() => import("@/pages/admin/registry/ClaimActivation"));
// Batch 12 — Authority-to-Act request, status, review
const RegistryAuthorityList = lazy(() => import("@/pages/registry/AuthorityList"));
const RegistryAuthorityStatus = lazy(() => import("@/pages/registry/AuthorityStatus"));
const AdminRegistryAuthorityReview = lazy(() => import("@/pages/admin/registry/AuthorityReview"));
// Phase 1 — SMS / WhatsApp Notification Channel Readiness Shell
const AdminNotificationChannelReadiness = lazy(() => import("@/pages/admin/notifications/ChannelReadiness"));
// Batch 16 — Company Portal Guided Journey
const RegistryMyCompanies = lazy(() => import("@/pages/registry/MyCompanies"));
const RegistryMyCompanyDetail = lazy(() => import("@/pages/registry/MyCompanyDetail"));
const RegistryMyCompanyEvidence = lazy(() => import("@/pages/registry/MyCompanyEvidence"));
const RegistryMyCompanyCorrections = lazy(() => import("@/pages/registry/MyCompanyCorrections"));
const RegistryMyCompanyDisputes = lazy(() => import("@/pages/registry/MyCompanyDisputes"));
const RegistryMyCompanyRevocations = lazy(() => import("@/pages/registry/MyCompanyRevocations"));
// Batch 18 — Release gate, demo pack and UAT scenarios (read-only admin)
const AdminRegistryReleaseGate = lazy(() => import("@/pages/admin/registry/ReleaseGate"));
const AdminRegistryDemoPack = lazy(() => import("@/pages/admin/registry/DemoPack"));
const AdminRegistryUatScenarios = lazy(() => import("@/pages/admin/registry/UatScenarios"));

/**
 * Root element that renders based on host type:
 * - Public domain: Landing page
 * - Console domain: Redirect to Trade Desk
 * - Preview: Landing page (for testing)
 */
function RootElement() {
  const hostType = getHostType();

  if (hostType === 'console') {
    return <Navigate to="/desk" replace />;
  }

  return <Landing />;
}

/**
 * Legacy /dashboard/matches/:matchId → /desk/match/:matchId.
 * Uses LegacyRedirect so the user sees a one-shot explanation toast.
 */
function RedirectDashboardMatch() {
  return (
    <LegacyRedirect
      to="/desk/match"
      label="Match Details"
      resolveTo={(p) => `/desk/match/${p.matchId ?? ""}`}
    />
  );
}

function App() {
  if (MAINTENANCE_MODE) {
    return <MaintenancePage />;
  }
  return (
    <QueryClientProvider client={queryClient}>
      {/* UI-007: subscribe this tab to cross-tab cache invalidation events. */}
      <CrossTabCacheBridge queryClient={queryClient} />
      <AuthProvider>
        <TooltipProvider>
          <Router>
            <HostnameRouter>
              <MaintenanceBanner />
              <TestModeBanner />
              <DemoModeBanner />
              <LegacyRedirectBanner />
              <AuthRedirectNoticeBanner />
              <RouteErrorBoundary>
                <Suspense fallback={<FullPageLoader />}>
                <Routes>
                  <Route path={ROUTES.ROOT} element={<RootElement />} />
                  {/* Canonical redirect: /landing → / */}
                  <Route path="/landing" element={<Navigate to="/" replace />} />
                  <Route path={ROUTES.AUTH} element={<Auth />} />
                  <Route path="/welcome" element={<Welcome />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/trust" element={<Trust />} />
                  {/* Billing now lives under the Trade Desk shell */}
                  <Route path="/billing" element={<Navigate to="/desk/billing" replace />} />

                  {/* ─── Legacy /dashboard/* → /desk redirect map ───
                      The Dashboard page has been retired. Every legacy sub-route
                      forwards to its closest Trade Desk equivalent so existing
                      bookmarks, notification deep-links, and audit trails keep
                      working. */}
                  <Route path="/dashboard" element={<LegacyRedirect to="/desk" label="Dashboard" />} />
                  <Route path="/dashboard/matches/:matchId" element={<RedirectDashboardMatch />} />
                  <Route path="/dashboard/matches" element={<LegacyRedirect to="/desk" label="Matches" />} />
                  <Route path="/dashboard/search" element={<LegacyRedirect to="/desk/discover" label="Search" />} />
                  <Route path="/dashboard/order-book" element={<LegacyRedirect to="/desk" label="Order Book" />} />
                  <Route path="/dashboard/settings" element={<LegacyRedirect to="/desk/settings" label="Settings" />} />
                  <Route path="/dashboard/account" element={<LegacyRedirect to="/desk/settings/company" label="Account" />} />
                  <Route path="/dashboard/billing" element={<LegacyRedirect to="/desk/billing" label="Billing" />} />
                  <Route path="/dashboard/compliance" element={<LegacyRedirect to="/desk/compliance" label="Compliance" />} />
                  <Route path="/dashboard/programmes" element={<LegacyRedirect to="/desk" label="Programmes" />} />
                  {/* Catch-all: any other /dashboard/* path lands on the Desk overview */}
                  <Route path="/dashboard/*" element={<LegacyRedirect to="/desk" label="Dashboard" />} />

                  <Route path="/desk/*" element={<Desk />} />
                  {/* Batch 1 — Business Registry shell (M001) */}
                  <Route path="/registry" element={<RegistryLanding />} />
                  <Route path="/registry/search" element={<RegistrySearch />} />
                  <Route path="/registry/new-company-request" element={<RegistryNewCompanyRequest />} />
                  <Route path="/registry/company/:id" element={<RegistryCompanyProfile />} />
                  <Route path="/registry/claim" element={<RegistryClaim />} />
                  <Route path="/registry/company/:id/claim" element={<RegistryClaim />} />
                  <Route path="/registry/claims" element={<RequireAuth><RegistryClaimsList /></RequireAuth>} />
                  <Route path="/registry/claims/:claimId" element={<RequireAuth><RegistryClaimStatus /></RequireAuth>} />
                  <Route path="/admin/registry/claims-review" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryClaimsReview /></RequireAuth>} />
                  <Route path="/registry/readiness" element={<RegistryReadiness />} />
                  {/* Batch 16 — Company Portal Guided Journey */}
                  <Route path="/registry/my-companies" element={<RequireAuth><RegistryMyCompanies /></RequireAuth>} />
                  <Route path="/registry/my-companies/:companyId" element={<RequireAuth><RegistryMyCompanyDetail /></RequireAuth>} />
                  <Route path="/registry/my-companies/:companyId/claim" element={<RequireAuth><RegistryClaimStatus /></RequireAuth>} />
                  <Route path="/registry/my-companies/:companyId/authority" element={<RequireAuth><RegistryAuthorityList /></RequireAuth>} />
                  <Route path="/registry/my-companies/:companyId/bank-details" element={<RequireAuth><BankDetailSubmit /></RequireAuth>} />
                  <Route path="/registry/my-companies/:companyId/verification" element={<RequireAuth><BankDetailStatus /></RequireAuth>} />
                  <Route path="/registry/my-companies/:companyId/evidence" element={<RequireAuth><RegistryMyCompanyEvidence /></RequireAuth>} />
                  <Route path="/registry/my-companies/:companyId/corrections" element={<RequireAuth><RegistryMyCompanyCorrections /></RequireAuth>} />
                  <Route path="/registry/my-companies/:companyId/disputes" element={<RequireAuth><RegistryMyCompanyDisputes /></RequireAuth>} />
                  <Route path="/registry/my-companies/:companyId/revocations" element={<RequireAuth><RegistryMyCompanyRevocations /></RequireAuth>} />
                  {/* Batch 1 — Admin registry area (M015 shell, M018 decisions, M019 readiness) */}
                  <Route path="/admin/registry" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryIndex /></RequireAuth>} />
                  <Route path="/admin/registry/readiness" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryReadiness /></RequireAuth>} />
                  <Route path="/admin/registry/decisions" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryDecisions /></RequireAuth>} />
                  {/* Batch 2 — Provenance / Country Coverage / Import Batches */}
                  <Route path="/admin/registry/provenance" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryProvenance /></RequireAuth>} />
                  <Route path="/admin/registry/coverage" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryCoverage /></RequireAuth>} />
                  <Route path="/admin/registry/imports" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryImports /></RequireAuth>} />
                  {/* Batch 3 — Claims queue */}
                  <Route path="/admin/registry/claims" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryClaims /></RequireAuth>} />
                  {/* Batch 4 — Authority + Bank Details */}
                  <Route path="/registry/company/:id/authority" element={<RegistryAuthority />} />
                  <Route path="/registry/company/:id/bank-details" element={<RegistryBankDetails />} />
                  <Route path="/admin/registry/authority" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryAuthority /></RequireAuth>} />
                  {/* Batch 12 — Authority-to-Act request, status, review */}
                  <Route path="/registry/authority" element={<RequireAuth><RegistryAuthorityList /></RequireAuth>} />
                  <Route path="/registry/authority/:authorityRequestId" element={<RequireAuth><RegistryAuthorityStatus /></RequireAuth>} />
                  <Route path="/admin/registry/authority/:authorityRequestId" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryAuthorityReview /></RequireAuth>} />
                  <Route path="/admin/registry/bank-details" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryBankDetails /></RequireAuth>} />
                  {/* Batch 13B — Consent-based bank-detail submission and review UI */}
                  <Route path="/registry/bank-details" element={<RequireAuth><BankDetailSubmit /></RequireAuth>} />
                  <Route path="/registry/bank-details/:bankDetailSubmissionId" element={<RequireAuth><BankDetailStatus /></RequireAuth>} />
                  <Route path="/registry/company/:id/bank-details/submit" element={<RequireAuth><BankDetailSubmit /></RequireAuth>} />
                  <Route path="/admin/registry/bank-details/queue" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminBankDetailQueue /></RequireAuth>} />
                  <Route path="/admin/registry/bank-details/submissions/:bankDetailSubmissionId" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminBankDetailReview /></RequireAuth>} />
                  {/* Batch 14B — Bank verification admin UI */}
                  <Route path="/admin/registry/bank-verification" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminBankVerificationQueue /></RequireAuth>} />
                  <Route path="/admin/registry/bank-verification/:bankDetailSubmissionId" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminBankVerificationReview /></RequireAuth>} />
                  <Route path="/admin/registry/api" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryApi /></RequireAuth>} />
                  {/* Batch 15B — Institutional API hardening admin UI */}
                  <Route path="/admin/registry/api-clients" element={<AdminApiClientsList />} />
                  <Route path="/admin/registry/api-clients/:clientId" element={<AdminApiClientDetail />} />
                  <Route path="/admin/registry/api-usage" element={<AdminApiUsage />} />
                  <Route path="/admin/registry/api-test-console" element={<AdminApiTestConsole />} />
                  {/* Batch 6 — Operations, Outreach, DNC */}
                  <Route path="/admin/registry/operations" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryOpsCentre /></RequireAuth>} />
                  {/* Batch 17 — Operations Centre sub-routes */}
                  <Route path="/admin/registry/operations/queue" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryOpsQueue /></RequireAuth>} />
                  <Route path="/admin/registry/operations/slas" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryOpsSlas /></RequireAuth>} />
                  <Route path="/admin/registry/operations/risk" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryOpsRisk /></RequireAuth>} />
                  <Route path="/admin/registry/operations/readiness" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryOpsReadiness /></RequireAuth>} />
                  <Route path="/admin/registry/operations/audit" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryOpsAudit /></RequireAuth>} />
                  {/* Batch 18 — Release gate, demo pack, UAT scenarios (read-only) */}
                  <Route path="/admin/registry/release-gate" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryReleaseGate /></RequireAuth>} />
                  <Route path="/admin/registry/demo-pack" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryDemoPack /></RequireAuth>} />
                  <Route path="/admin/registry/uat-scenarios" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryUatScenarios /></RequireAuth>} />

                  <Route path="/admin/registry/operations/legacy" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryOperations /></RequireAuth>} />
                  <Route path="/admin/registry/outreach-drafts" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryOutreachDrafts /></RequireAuth>} />
                  <Route path="/admin/registry/outreach-approvals" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryOutreachApprovals /></RequireAuth>} />
                  <Route path="/admin/registry/do-not-contact" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryDoNotContact /></RequireAuth>} />
                  {/* Batch 7 — claim rules hardening admin queues */}
                  <Route path="/admin/registry/new-company-requests" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryNewCompanyRequests /></RequireAuth>} />
                  <Route path="/admin/registry/correction-requests" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryCorrectionRequests /></RequireAuth>} />
                  <Route path="/admin/registry/claim-conflicts" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryClaimConflicts /></RequireAuth>} />
                  <Route path="/admin/registry/claim-activation" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryClaimActivation /></RequireAuth>} />
                  <Route path="/admin/registry/batch7-audit-log" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryBatch7AuditLog /></RequireAuth>} />
                  {/* Batch 8 — Registry record model + search */}
                  <Route path="/admin/registry/records" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminRegistryRecords /></RequireAuth>} />
                  {/* Phase 1 — SMS / WhatsApp Notification Channel Readiness Shell */}
                  <Route path="/admin/notifications/channel-readiness" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><AdminNotificationChannelReadiness /></RequireAuth>} />





                  {/* Legacy /admin/*, every section now lives under /hq.
                      We map sub-routes to their HQ tab equivalent so old
                      bookmarks, audit logs, and outbound links keep working.
                      Each redirect is wrapped in RequireAuth role="platform_admin"
                      so anonymous and non-admin users never execute the redirect
                      logic - they hit /auth?returnTo=... or /desk?denied=1 first. */}
                  <Route path="/admin" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><LegacyRedirect to="/hq/users" label="Admin Console" /></RequireAuth>} />
                  <Route path="/admin/users" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><LegacyRedirect to="/hq/users" label="Admin Users" /></RequireAuth>} />
                  <Route path="/admin/orgs" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><LegacyRedirect to="/hq/organisations" label="Admin Organisations" /></RequireAuth>} />
                  <Route path="/admin/entities" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><LegacyRedirect to="/hq/organisations?sub=entities" label="Admin Entities" /></RequireAuth>} />
                  <Route path="/admin/compliance" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><LegacyRedirect to="/hq/disputes?sub=disputes" label="Admin Compliance" /></RequireAuth>} />
                  <Route path="/admin/deals" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><LegacyRedirect to="/hq/disputes?sub=approvals" label="Admin Deals" /></RequireAuth>} />
                  <Route path="/admin/settings" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><LegacyRedirect to="/hq/settings?sub=platform" label="Admin Settings" /></RequireAuth>} />
                  <Route path="/admin/data-governance" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><LegacyRedirect to="/hq/settings?sub=platform" label="Data Governance" /></RequireAuth>} />
                  <Route path="/admin/overrides" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><LegacyRedirect to="/hq/settings?sub=overrides" label="Admin Overrides" /></RequireAuth>} />
                  {/* Daniel fixture / outreach links use /admin/engagements?match=…
                      and /admin/engagements?engagement=…. LegacyRedirect preserves
                      query string + hash, and the HQ Engagements panel reads
                      ?match= / ?engagement= to pre-scope the row. */}
                  <Route path="/admin/engagements" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><LegacyRedirect to="/hq/engagements" label="Admin Engagements" /></RequireAuth>} />
                  {/* API Usage Dashboard V1 — Batch 2 stable route alias. */}
                  <Route path="/admin/api/usage" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><LegacyRedirect to="/hq/organisations?sub=api-usage" label="Platform Admin API Usage Dashboard" /></RequireAuth>} />
                  {/* Catch-all: anything else under /admin lands on Users (default tab) */}
                  <Route path="/admin/*" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><LegacyRedirect to="/hq/users" label="Admin Console" /></RequireAuth>} />

                  {/* Public docs hub, Stripe-style sidebar layout */}
                  <Route path="/docs" element={<DocsIndex />} />
                  <Route path="/docs/quickstart" element={<DocsQuickstart />} />
                  <Route path="/docs/authentication" element={<DocsAuthentication />} />
                  <Route path="/docs/webhooks" element={<DocsWebhooks />} />
                  <Route path="/docs/matches" element={<DocsMatches />} />
                  <Route path="/docs/counterparties" element={<DocsCounterparties />} />
                  <Route path="/docs/evidence" element={<DocsEvidence />} />
                  <Route path="/docs/errors" element={<DocsErrors />} />
                  <Route path="/docs/counterparty-rating-methodology" element={<DocsCounterpartyRatingMethodology />} />
                  <Route path="/docs/api" element={<DocsApiReference />} />
                  {/* Legacy /docs/sdks redirects to API reference; the platform is REST-first. */}
                  <Route path="/docs/sdks" element={<LegacyRedirect to="/docs/api" label="SDK documentation" />} />
                  <Route path="/docs/legacy" element={<Docs />} />
                  <Route path="/status" element={<Status />} />
                  <Route path={ROUTES.WALKTHROUGH} element={<WalkthroughReport />} />
                  <Route path={ROUTES.PRICING} element={<Pricing />} />
                  {/* Public product pages */}
                  <Route path="/products/trade-desk" element={<TradeDeskProductPage />} />
                  <Route path="/products/compliance-engine" element={<ComplianceEngineProductPage />} />
                  <Route path="/products/audit-ledger" element={<AuditLedgerProductPage />} />
                  <Route path="/products" element={<Navigate to="/products/trade-desk" replace />} />
                  {/* Public solutions pages, persona-targeted landing pages */}
                  <Route path="/solutions/traders" element={<TradersSolutionsPage />} />
                  <Route path="/solutions/finance" element={<FinanceSolutionsPage />} />
                  <Route path="/solutions/sovereigns" element={<SovereignsSolutionsPage />} />
                  <Route path="/solutions" element={<Navigate to="/solutions/traders" replace />} />
                  <Route path="/unsubscribe" element={<Unsubscribe />} />
                  {/* Public developer hub, landing page for the four dropdown links.
                      Authenticated tooling lives at /developer/* (DeveloperCenter). */}
                  <Route path="/developers" element={<Developers />} />
                  <Route path="/developers/keys" element={<LegacyRedirect to="/developer/keys" label="API keys" />} />
                  <Route path="/developers/webhooks" element={<LegacyRedirect to="/developer/webhooks" label="Webhooks" />} />
                  <Route path="/developers/dlq" element={<LegacyRedirect to="/developer/webhooks" label="Dead-letter queue" />} />
                  <Route path="/developers/docs" element={<LegacyRedirect to="/developer/docs" label="Developer docs" />} />
                  <Route path="/developers/*" element={<Developers />} />
                  {/* Authenticated developer surface. Restricted to platform_admin
                      and org_admin - the Developer Center exposes API keys,
                      webhooks, and a schema explorer, which buyers, suppliers,
                      brokers, org_members, and demo users must not see.
                      Anonymous visitors are redirected to /auth?returnTo=/developer/...;
                      authenticated users without the required role land on
                      /desk?denied=1 via RequireAuth's fallbackRoute. */}
                  <Route path="/developer/*" element={<RequireAuth role={[...DEVELOPER_ROLES]} fallbackRoute="/desk"><DeveloperCenter /></RequireAuth>} />
                  {/* Governance Console, restricted to platform_admin / auditor / org_admin.
                      Unauthorised users are bounced to /desk with denied=1 (see RequireAuth). */}
                  <Route path="/governance/triage" element={<RequireAuth role={[...GOVERNANCE_ROLES]} fallbackRoute="/desk"><GovernanceTriage /></RequireAuth>} />
                  <Route path="/governance/audits" element={<RequireAuth role={[...GOVERNANCE_ROLES]} fallbackRoute="/desk"><GovernanceAudits /></RequireAuth>} />
                  <Route path="/governance/entities" element={<RequireAuth role={[...GOVERNANCE_ROLES]} fallbackRoute="/desk"><GovernanceEntities /></RequireAuth>} />
                  <Route path="/governance/health" element={<RequireAuth role={[...GOVERNANCE_ROLES]} fallbackRoute="/desk"><GovernanceHealth /></RequireAuth>} />
                  <Route path="/governance" element={<Navigate to="/governance/triage" replace />} />
                  {/* Legacy /trade/wizard → consolidated under the Trade Desk shell */}
                  <Route path="/trade/wizard" element={<LegacyRedirect to="/desk/wizard" label="Trade Wizard" />} />
                  {/* Admin Dashboard, Izenzo Platform Administration.
                      Two routes: bare /hq lands on default tab; /hq/:tab deep-links.
                      Defence-in-depth: route-level RequireAuth(platform_admin) AND
                      page-level guard inside HQ.tsx (ForbiddenHQ screen). */}
                  {/* compliance_analyst is allowed to reach /hq solely to operate the
                      Facilitation surface (escalation resolve/reopen, DNC revoke). HQ.tsx
                      restricts that role to the Facilitation tab and hides every other tab. */}
                  <Route path="/hq" element={<RequireAuth role={["platform_admin", "compliance_analyst"]} fallbackRoute="/desk"><HQ /></RequireAuth>} />
                  <Route path="/hq/:tab" element={<RequireAuth role={["platform_admin", "compliance_analyst"]} fallbackRoute="/desk"><HQ /></RequireAuth>} />
                  {/* 404 for unknown routes */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
                </Suspense>
              </RouteErrorBoundary>
              <Sonner />
              <SessionExpiredModal />
            </HostnameRouter>
          </Router>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;