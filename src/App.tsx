import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HostnameRouter } from "@/components/HostnameRouter";
import { getHostType } from "@/lib/hostname";
import PublicSearch from "@/pages/PublicSearch";
import Landing from "@/pages/Landing";
import Demo from "@/pages/Demo";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Billing from "@/pages/Billing";
import Admin from "@/pages/Admin";
import MatchDetails from "@/pages/MatchDetails";
import Marketplace from "@/pages/Marketplace";
import Analytics from "@/pages/Analytics";
import Docs from "@/pages/Docs";
import MyActivity from "@/pages/MyActivity";
import Invites from "@/pages/Invites";
import Pricing from "@/pages/Pricing";

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
    return <Navigate to="/dashboard" replace />;
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
                <Route path="/" element={<RootElement />} />
                <Route path="/landing" element={<Landing />} />
                <Route path="/demo" element={<Demo />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/dashboard/matches/:matchId" element={<MatchDetails />} />
                <Route path="/activity" element={<MyActivity />} />
                <Route path="/invites" element={<Invites />} />
                <Route path="/marketplace" element={<Marketplace />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/docs" element={<Docs />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/admin/*" element={<Admin />} />
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