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
import { MaintenanceBanner } from "@/components/MaintenanceBanner";
import { MaintenancePage, MAINTENANCE_MODE } from "@/components/MaintenancePage";
import { SessionExpiredModal } from "@/components/SessionExpiredModal";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

/** Roles permitted to enter the Governance Console (matches ContextSwitcher matrix). */
const GOVERNANCE_ROLES = ["platform_admin", "auditor", "org_admin"] as const;

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
const Status = lazy(() => import("@/pages/Status"));

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
      <AuthProvider>
        <TooltipProvider>
          <Router>
            <HostnameRouter>
              <MaintenanceBanner />
              <TestModeBanner />
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
                  {/* Legacy /admin/*, every section now lives under /hq.
                      We map sub-routes to their HQ tab equivalent so old
                      bookmarks, audit logs, and outbound links keep working. */}
                  <Route path="/admin" element={<LegacyRedirect to="/hq/users" label="Admin Console" />} />
                  <Route path="/admin/users" element={<LegacyRedirect to="/hq/users" label="Admin Users" />} />
                  <Route path="/admin/orgs" element={<LegacyRedirect to="/hq/organisations" label="Admin Organisations" />} />
                  <Route path="/admin/entities" element={<LegacyRedirect to="/hq/organisations?sub=entities" label="Admin Entities" />} />
                  <Route path="/admin/compliance" element={<LegacyRedirect to="/hq/disputes?sub=disputes" label="Admin Compliance" />} />
                  <Route path="/admin/deals" element={<LegacyRedirect to="/hq/disputes?sub=approvals" label="Admin Deals" />} />
                  <Route path="/admin/settings" element={<LegacyRedirect to="/hq/settings?sub=platform" label="Admin Settings" />} />
                  <Route path="/admin/data-governance" element={<LegacyRedirect to="/hq/settings?sub=platform" label="Data Governance" />} />
                  <Route path="/admin/overrides" element={<LegacyRedirect to="/hq/settings?sub=overrides" label="Admin Overrides" />} />
                  {/* Catch-all: anything else under /admin lands on Users (default tab) */}
                  <Route path="/admin/*" element={<LegacyRedirect to="/hq/users" label="Admin Console" />} />
                  {/* Public docs hub, Stripe-style sidebar layout */}
                  <Route path="/docs" element={<DocsIndex />} />
                  <Route path="/docs/quickstart" element={<DocsQuickstart />} />
                  <Route path="/docs/authentication" element={<DocsAuthentication />} />
                  <Route path="/docs/webhooks" element={<DocsWebhooks />} />
                  <Route path="/docs/matches" element={<DocsMatches />} />
                  <Route path="/docs/counterparties" element={<DocsCounterparties />} />
                  <Route path="/docs/evidence" element={<DocsEvidence />} />
                  <Route path="/docs/errors" element={<DocsErrors />} />
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
                  {/* Authenticated developer surface. RequireAuth redirects
                      anonymous visitors to /auth?returnTo=/developer/... so the
                      Developer Center UI is never exposed to logged-out users. */}
                  <Route path="/developer/*" element={<RequireAuth><DeveloperCenter /></RequireAuth>} />
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
                  <Route path="/hq" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><HQ /></RequireAuth>} />
                  <Route path="/hq/:tab" element={<RequireAuth role="platform_admin" fallbackRoute="/desk"><HQ /></RequireAuth>} />
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