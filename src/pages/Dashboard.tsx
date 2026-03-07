import { Routes, Route, Link } from "react-router-dom";
import { ROUTES } from "@/lib/constants";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { ConsoleOverview } from "@/components/dashboard/ConsoleOverview";
import { SearchSection } from "@/components/dashboard/sections/SearchSection";
import { MatchesSection } from "@/components/dashboard/sections/MatchesSection";
import { DashboardSettings } from "@/components/dashboard/DashboardSettings";
import { AccountSection } from "@/components/dashboard/AccountSection";
import { ComplianceSection } from "@/components/dashboard/sections/ComplianceSection";
import MatchDetails from "@/pages/MatchDetails";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

function DashboardNotFound() {
  return (
    <div className="text-center py-16">
      <p className="text-4xl font-bold text-muted-foreground/30 mb-3">404</p>
      <h2 className="text-lg font-semibold text-foreground mb-1">Page not found</h2>
      <p className="text-sm text-muted-foreground mb-4">This console page doesn't exist.</p>
      <Button variant="outline" size="sm" asChild>
        <Link to={ROUTES.DASHBOARD}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Overview
        </Link>
      </Button>
    </div>
  );
}

export default function Dashboard() {
  const { isAdmin } = useAuth();

  return (
    <RequireAuth>
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
            <Route path="*" element={<DashboardNotFound />} />
          </Routes>
        </ErrorBoundary>
      </DashboardLayout>
    </RequireAuth>
  );
}
