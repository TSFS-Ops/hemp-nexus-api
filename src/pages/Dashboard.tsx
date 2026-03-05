import { Loader2 } from "lucide-react";
import { Routes, Route, Navigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/contexts/AuthContext";
import { ConsoleWelcome } from "@/components/ConsoleWelcome";
import { ConsoleOverview } from "@/components/dashboard/ConsoleOverview";
import { SearchSection } from "@/components/dashboard/sections/SearchSection";
import { MatchesSection } from "@/components/dashboard/sections/MatchesSection";
import { DashboardSettings } from "@/components/dashboard/DashboardSettings";

export default function Dashboard() {
  const { session, isLoading, isAdmin } = useAuth();
  const isDemoMode = !session;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isDemoMode) {
    return <ConsoleWelcome />;
  }

  return (
    <DashboardLayout isAdmin={isAdmin} isDemoMode={false}>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<ConsoleOverview />} />
          <Route path="/search" element={<SearchSection />} />
          <Route path="/matches" element={<MatchesSection isDemoMode={false} />} />
          <Route path="/matches/:matchId" element={<MatchesSection isDemoMode={false} />} />
          <Route path="/settings" element={<DashboardSettings />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </ErrorBoundary>
    </DashboardLayout>
  );
}
