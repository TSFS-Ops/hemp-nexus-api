import { Routes, Route, Navigate } from "react-router-dom";
import { ROUTES } from "@/lib/constants";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/contexts/AuthContext";
import { ConsoleWelcome } from "@/components/ConsoleWelcome";
import { ConsoleOverview } from "@/components/dashboard/ConsoleOverview";
import { SearchSection } from "@/components/dashboard/sections/SearchSection";
import { MatchesSection } from "@/components/dashboard/sections/MatchesSection";
import { DashboardSettings } from "@/components/dashboard/DashboardSettings";
import { AccountSection } from "@/components/dashboard/AccountSection";
import { ComplianceSection } from "@/components/dashboard/sections/ComplianceSection";
import MatchDetails from "@/pages/MatchDetails";
import { FullPageLoader } from "@/components/ui/full-page-loader";

export default function Dashboard() {
  const { session, isLoading, isAdmin } = useAuth();
  const isDemoMode = !session;

  if (isLoading) {
    return <FullPageLoader />;
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
          <Route path="/matches/:matchId" element={<MatchDetails />} />
          <Route path="/settings" element={<DashboardSettings />} />
          <Route path="/account" element={<AccountSection />} />
          <Route path="/compliance" element={<ComplianceSection />} />
          <Route path="*" element={<Navigate to={ROUTES.DASHBOARD} replace />} />
        </Routes>
      </ErrorBoundary>
    </DashboardLayout>
  );
}
