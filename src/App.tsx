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
                  <Route path="/reset-password" element={<ResetPassword />} />
                  {/* Billing now nested under dashboard */}
                  <Route path="/billing" element={<Navigate to="/dashboard/billing" replace />} />
                  <Route path={`${ROUTES.DASHBOARD}/*`} element={<Dashboard />} />
                  <Route path={`${ROUTES.ADMIN}/*`} element={<Admin />} />
                  <Route path={ROUTES.DOCS} element={<Docs />} />
                  <Route path={ROUTES.WALKTHROUGH} element={<WalkthroughReport />} />
                  <Route path={ROUTES.PRICING} element={<Pricing />} />
                  <Route path="/unsubscribe" element={<Unsubscribe />} />
                  <Route path="/developers/keys" element={<DeveloperApiKeys />} />
                  <Route path="/developers/webhooks" element={<DeveloperWebhooks />} />
                  <Route path="/developers" element={<Navigate to="/developers/keys" replace />} />
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