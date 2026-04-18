import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
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
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Router>
            <HostnameRouter>
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
                  <Route path="/dashboard" element={<Navigate to="/desk" replace />} />
                  <Route path="/dashboard/matches/:matchId" element={<RedirectDashboardMatch />} />
                  <Route path="/dashboard/matches" element={<Navigate to="/desk" replace />} />
                  <Route path="/dashboard/search" element={<Navigate to="/desk/discover" replace />} />
                  <Route path="/dashboard/order-book" element={<Navigate to="/desk" replace />} />
                  <Route path="/dashboard/settings" element={<Navigate to="/desk/settings" replace />} />
                  <Route path="/dashboard/account" element={<Navigate to="/desk/settings/company" replace />} />
                  <Route path="/dashboard/billing" element={<Navigate to="/desk/billing" replace />} />
                  <Route path="/dashboard/compliance" element={<Navigate to="/desk/compliance" replace />} />
                  <Route path="/dashboard/programmes" element={<Navigate to="/desk" replace />} />
                  {/* Catch-all: any other /dashboard/* path lands on the Desk overview */}
                  <Route path="/dashboard/*" element={<Navigate to="/desk" replace />} />

                  <Route path="/desk/*" element={<Desk />} />
                  {/* Legacy /admin/*, every section now lives under /hq.
                      We map sub-routes to their HQ tab equivalent so old
                      bookmarks, audit logs, and outbound links keep working. */}
                  <Route path="/admin" element={<Navigate to="/hq/users" replace />} />
                  <Route path="/admin/users" element={<Navigate to="/hq/users" replace />} />
                  <Route path="/admin/orgs" element={<Navigate to="/hq/organisations" replace />} />
                  <Route path="/admin/entities" element={<Navigate to="/hq/organisations?sub=entities" replace />} />
                  <Route path="/admin/compliance" element={<Navigate to="/hq/disputes?sub=disputes" replace />} />
                  <Route path="/admin/deals" element={<Navigate to="/hq/disputes?sub=approvals" replace />} />
                  <Route path="/admin/settings" element={<Navigate to="/hq/settings?sub=platform" replace />} />
                  <Route path="/admin/data-governance" element={<Navigate to="/hq/settings?sub=platform" replace />} />
                  <Route path="/admin/overrides" element={<Navigate to="/hq/settings?sub=overrides" replace />} />
                  {/* Catch-all: anything else under /admin lands on Users (default tab) */}
                  <Route path="/admin/*" element={<Navigate to="/hq/users" replace />} />
                  {/* Public docs hub, Stripe-style sidebar layout */}
                  <Route path="/docs" element={<DocsIndex />} />
                  <Route path="/docs/quickstart" element={<DocsQuickstart />} />
                  <Route path="/docs/api" element={<DocsApiReference />} />
                  {/* Legacy /docs/sdks redirects to API reference; the platform is REST-first. */}
                  <Route path="/docs/sdks" element={<Navigate to="/docs/api" replace />} />
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
                  <Route path="/developers/keys" element={<Navigate to="/developer/keys" replace />} />
                  <Route path="/developers/webhooks" element={<Navigate to="/developer/webhooks" replace />} />
                  <Route path="/developers/dlq" element={<Navigate to="/developer/webhooks" replace />} />
                  <Route path="/developers/docs" element={<Navigate to="/developer/docs" replace />} />
                  <Route path="/developers/*" element={<Developers />} />
                  <Route path="/developer/*" element={<DeveloperCenter />} />
                  <Route path="/governance/triage" element={<GovernanceTriage />} />
                  <Route path="/governance/audits" element={<GovernanceAudits />} />
                  <Route path="/governance/entities" element={<GovernanceEntities />} />
                  <Route path="/governance/health" element={<GovernanceHealth />} />
                  <Route path="/governance" element={<Navigate to="/governance/triage" replace />} />
                  {/* Legacy /trade/wizard → consolidated under the Trade Desk shell */}
                  <Route path="/trade/wizard" element={<Navigate to="/desk/wizard" replace />} />
                  {/* Admin Dashboard, Izenzo Platform Administration.
                      Two routes: bare /hq lands on default tab; /hq/:tab deep-links. */}
                  <Route path="/hq" element={<HQ />} />
                  <Route path="/hq/:tab" element={<HQ />} />
                  {/* 404 for unknown routes */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
              <Sonner />
            </HostnameRouter>
          </Router>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;