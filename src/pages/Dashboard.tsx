import { useState, useEffect, lazy, Suspense } from "react";
import { Routes, Route, Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ROUTES } from "@/lib/constants";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { ConsoleOverview } from "@/components/dashboard/ConsoleOverview";
import { SearchSection } from "@/components/dashboard/sections/SearchSection";
import { MatchesSection } from "@/components/dashboard/sections/MatchesSection";
import { OrderBookSection } from "@/components/dashboard/sections/OrderBookSection";
import { DashboardSettings } from "@/components/dashboard/DashboardSettings";
import { AccountSection } from "@/components/dashboard/AccountSection";
import { ComplianceSection } from "@/components/dashboard/sections/ComplianceSection";
import { ProgrammesSection } from "@/components/dashboard/sections/ProgrammesSection";
import MatchDetails from "@/pages/MatchDetails";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { FullPageLoader } from "@/components/ui/full-page-loader";

const Billing = lazy(() => import("@/pages/Billing"));

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

function AccessDeniedBanner() {
  const [searchParams] = useSearchParams();
  const [dismissed, setDismissed] = useState(false);
  const denied = searchParams.get("denied") === "1";

  // Fire a persistent toast on mount so the user cannot miss the explanation
  useEffect(() => {
    if (denied) {
      toast.error(
        "You don't have permission to access that page. You've been redirected to the console.",
        { duration: Infinity }
      );
    }
  }, [denied]);

  if (!denied || dismissed) return null;

  return (
    <Alert variant="destructive" className="mb-4">
      <ShieldAlert className="h-4 w-4" />
      <AlertDescription>
        You were redirected because you don't have permission to access that page.
        If you believe this is an error, contact your organisation admin or{" "}
        <a href="mailto:support@izenzo.co.za" className="underline font-medium">support@izenzo.co.za</a>.
        <Button
          variant="ghost"
          size="sm"
          className="ml-2 h-6 text-xs"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export default function Dashboard() {
  const { isAdmin } = useAuth();

  return (
    <RequireAuth>
      <DashboardLayout isAdmin={isAdmin}>
        <AccessDeniedBanner />
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<ConsoleOverview />} />
            <Route path="/search" element={<SearchSection />} />
            <Route path="/order-book" element={<OrderBookSection />} />
            <Route path="/matches" element={<MatchesSection />} />
            <Route path="/matches/:matchId" element={<MatchDetails />} />
            <Route path="/settings" element={<DashboardSettings />} />
            <Route path="/account" element={
              <ErrorBoundary fallback={
                <div className="text-center py-12 space-y-3">
                  <p className="text-lg font-semibold text-foreground">Couldn't load your organisation</p>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    We had trouble loading your organisation profile. This may be a temporary issue - try refreshing. If the problem persists, contact{" "}
                    <a href="mailto:support@izenzo.co.za" className="underline font-medium">support@izenzo.co.za</a>.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                    Refresh page
                  </Button>
                </div>
              }>
                <AccountSection />
              </ErrorBoundary>
            } />
            <Route path="/billing" element={
              <Suspense fallback={<FullPageLoader />}>
                <Billing />
              </Suspense>
            } />
            <Route path="/compliance" element={<ComplianceSection />} />
            <Route path="/programmes" element={<ProgrammesSection />} />
            <Route path="*" element={<DashboardNotFound />} />
          </Routes>
        </ErrorBoundary>
      </DashboardLayout>
    </RequireAuth>
  );
}
