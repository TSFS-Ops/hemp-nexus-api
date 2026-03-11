import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HostnameRouter } from "@/components/HostnameRouter";
import { getHostType } from "@/lib/hostname";
import { ROUTES } from "@/lib/constants";
import Landing from "@/pages/Landing";
import Demo from "@/pages/Demo";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Admin from "@/pages/Admin";
import Docs from "@/pages/Docs";
import Pricing from "@/pages/Pricing";
import Billing from "@/pages/Billing";
import WalkthroughReport from "@/pages/WalkthroughReport";
import ResetPassword from "@/pages/ResetPassword";
import NotFound from "@/pages/NotFound";

/**
 * Root element that renders based on host type:
 * - Public domain: Landing page with embedded demo search
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
              <Routes>
                <Route path={ROUTES.ROOT} element={<RootElement />} />
                {/* Canonical redirect: /landing → / */}
                <Route path="/landing" element={<Navigate to="/" replace />} />
                <Route path={ROUTES.DEMO} element={<Demo />} />
                <Route path={ROUTES.AUTH} element={<Auth />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path={ROUTES.BILLING} element={<Billing />} />
                <Route path={`${ROUTES.DASHBOARD}/*`} element={<Dashboard />} />
                <Route path={`${ROUTES.ADMIN}/*`} element={<Admin />} />
                <Route path={ROUTES.DOCS} element={<Docs />} />
                <Route path={ROUTES.WALKTHROUGH} element={<WalkthroughReport />} />
                <Route path={ROUTES.PRICING} element={<Pricing />} />
                {/* 404 for unknown routes — visible to users and developers */}
                <Route path="*" element={<NotFound />} />
              </Routes>
              <Sonner />
            </HostnameRouter>
          </Router>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
