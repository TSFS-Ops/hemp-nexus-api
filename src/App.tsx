import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HostnameRouter } from "@/components/HostnameRouter";
import { getHostType } from "@/lib/hostname";
import { ROUTES } from "@/lib/constants";
import PublicSearch from "@/pages/PublicSearch";
import Landing from "@/pages/Landing";
import Demo from "@/pages/Demo";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";

import Admin from "@/pages/Admin";
import MatchDetails from "@/pages/MatchDetails";
import Marketplace from "@/pages/Marketplace";
import Analytics from "@/pages/Analytics";
import Docs from "@/pages/Docs";
import MyActivity from "@/pages/MyActivity";
import Invites from "@/pages/Invites";
import Pricing from "@/pages/Pricing";
import DueDiligence from "@/pages/DueDiligence";
import Explore from "@/pages/Explore";
import WalkthroughReport from "@/pages/WalkthroughReport";
import ResetPassword from "@/pages/ResetPassword";

/**
 * Root element that renders based on host type:
 * - Public domain: Landing page with embedded demo search
 * - Console domain: Redirect to Dashboard
 * - Preview: Landing page (for testing)
 */
function RootElement() {
  const hostType = getHostType();
  
  // Console domain: immediately navigate to dashboard (internal SPA route)
  if (hostType === 'console') {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }
  
  // Public domain or preview: show landing page with embedded demo
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
                <Route path={ROUTES.LANDING} element={<Landing />} />
                <Route path={ROUTES.DEMO} element={<Demo />} />
                <Route path={ROUTES.AUTH} element={<Auth />} />
                <Route path={`${ROUTES.DASHBOARD}/*`} element={<Dashboard />} />
                <Route path={ROUTES.ACTIVITY} element={<MyActivity />} />
                <Route path={ROUTES.INVITES} element={<Invites />} />
                <Route path={ROUTES.MARKETPLACE} element={<Marketplace />} />
                <Route path={ROUTES.ANALYTICS} element={<Analytics />} />
                <Route path={ROUTES.DOCS} element={<Docs />} />
                <Route path={ROUTES.WALKTHROUGH} element={<WalkthroughReport />} />
                <Route path={ROUTES.PRICING} element={<Pricing />} />
                <Route path={ROUTES.DUE_DILIGENCE} element={<DueDiligence />} />
                <Route path={ROUTES.EXPLORE} element={<Explore />} />
                <Route path={`${ROUTES.ADMIN}/*`} element={<Admin />} />
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