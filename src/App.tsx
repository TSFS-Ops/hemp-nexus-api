import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HostnameRouter } from "@/components/HostnameRouter";
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Router>
            <HostnameRouter>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/demo" element={<Demo />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/dashboard/matches/:matchId" element={<MatchDetails />} />
                <Route path="/activity" element={<MyActivity />} />
                <Route path="/marketplace" element={<Marketplace />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/docs" element={<Docs />} />
                <Route path="/admin/*" element={<Admin />} />
              </Routes>
              <Toaster />
              <Sonner />
            </HostnameRouter>
          </Router>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;