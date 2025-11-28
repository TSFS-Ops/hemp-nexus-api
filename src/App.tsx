import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Admin from "@/pages/Admin";
import MatchDetails from "@/pages/MatchDetails";
import Marketplace from "@/pages/Marketplace";
import Analytics from "@/pages/Analytics";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/dashboard/matches/:matchId" element={<MatchDetails />} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/admin/*" element={<Admin />} />
          </Routes>
          <Toaster />
          <Sonner />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
