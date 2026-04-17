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

// Eagerly loaded - critical path
import Landing from "@/pages/Landing";
import Auth from "@/pages/Auth";

// Lazy loaded - secondary routes (reduces initial bundle ~40%)
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Admin = lazy(() => import("@/pages/Admin"));
const Docs = lazy(() => import("@/pages/Docs"));
const Pricing = lazy(() => import("@/pages/Pricing"));
const Billing = lazy(() => import("@/pages/Billing"));
const WalkthroughReport = lazy(() => import("@/pages/WalkthroughReport"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const Unsubscribe = lazy(() => import("@/pages/Unsubscribe"));
const DeveloperApiKeys = lazy(() => import("@/pages/DeveloperApiKeys"));
const DeveloperWebhooks = lazy(() => import("@/pages/DeveloperWebhooks"));
const GovernanceTriage = lazy(() => import("@/pages/GovernanceTriage"));
const GovernanceAudits = lazy(() => import("@/pages/GovernanceAudits"));
const GovernanceEntities = lazy(() => import("@/pages/GovernanceEntities"));
const GovernanceHealth = lazy(() => import("@/pages/GovernanceHealth"));
const TradeDealWizard = lazy(() => import("@/pages/TradeDealWizard"));
const Welcome = lazy(() => import("@/pages/Welcome"));
const Desk = lazy(() => import("@/pages/Desk"));
const DeveloperCenter = lazy(() => import("@/pages/DeveloperCenter"));
const HQ = lazy(() => import("@/pages/HQ"));

/**
 * Root element that renders based on host type:
 * - Public domain: Landing page
 * - Console domain: Redirect to Dashboard
 * - Preview: Landing page (for testing)
 */
function RootElement() {
  const hostType = getHostType();
  
  if (hostType === 'console') {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }
  
  return <Landing />;
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
                  {/* Billing now nested under dashboard */}
                  <Route path="/billing" element={<Navigate to="/dashboard/billing" replace />} />
                  <Route path={`${ROUTES.DASHBOARD}/*`} element={<Dashboard />} />
                  <Route path="/desk/*" element={<Desk />} />
                  {/* Legacy /admin/* — every section now lives under /hq.
                      We map sub-routes to their HQ tab equivalent so old
                      bookmarks, audit logs, and outbound links keep working. */}
                  <Route path="/admin" element={<Navigate to="/hq/users" replace />} />
                  <Route path="/admin/users" element={<Navigate to="/hq/users" replace />} />
                  <Route path="/admin/orgs" element={<Navigate to="/hq/organisations" replace />} />
                  <Route path="/admin/entities" element={<Navigate to="/hq/organisations" replace />} />
                  <Route path="/admin/compliance" element={<Navigate to="/hq/disputes" replace />} />
                  <Route path="/admin/deals" element={<Navigate to="/hq/disputes" replace />} />
                  <Route path="/admin/settings" element={<Navigate to="/hq/settings" replace />} />
                  <Route path="/admin/data-governance" element={<Navigate to="/hq/settings" replace />} />
                  <Route path="/admin/overrides" element={<Navigate to="/hq/settings" replace />} />
                  {/* Catch-all: anything else under /admin lands on Users (default tab) */}
                  <Route path="/admin/*" element={<Navigate to="/hq/users" replace />} />
                  <Route path={ROUTES.DOCS} element={<Docs />} />
                  <Route path={ROUTES.WALKTHROUGH} element={<WalkthroughReport />} />
                  <Route path={ROUTES.PRICING} element={<Pricing />} />
                  <Route path="/unsubscribe" element={<Unsubscribe />} />
                  {/* Legacy /developers/* → consolidated /developer Command Center */}
                  <Route path="/developers" element={<Navigate to="/developer/keys" replace />} />
                  <Route path="/developers/keys" element={<Navigate to="/developer/keys" replace />} />
                  <Route path="/developers/webhooks" element={<Navigate to="/developer/webhooks" replace />} />
                  <Route path="/developers/dlq" element={<Navigate to="/developer/webhooks" replace />} />
                  <Route path="/developers/docs" element={<Navigate to="/developer/docs" replace />} />
                  <Route path="/developers/*" element={<Navigate to="/developer/keys" replace />} />
                  <Route path="/developer/*" element={<DeveloperCenter />} />
                  <Route path="/governance/triage" element={<GovernanceTriage />} />
                  <Route path="/governance/audits" element={<GovernanceAudits />} />
                  <Route path="/governance/entities" element={<GovernanceEntities />} />
                  <Route path="/governance/health" element={<GovernanceHealth />} />
                  <Route path="/governance" element={<Navigate to="/governance/triage" replace />} />
                  <Route path="/trade/wizard" element={<TradeDealWizard />} />
                  {/* HQ — Sovereign Network Command Center.
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