import { useState, useEffect, useMemo, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { QuickstartGuide } from "@/components/dashboard/QuickstartGuide";
import { SdkDocumentation } from "@/components/SdkDocumentation";
import Troubleshooting from "@/components/Troubleshooting";
import OnboardingWizard from "@/components/OnboardingWizard";
import { SandboxIndicator } from "@/components/SandboxIndicator";
import { DemoModeBanner } from "@/components/DemoModeBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ConsoleWelcome } from "@/components/ConsoleWelcome";

// Import modular section components
import {
  SearchSection,
  MatchesSection,
  AnalyticsSection,
  DocsSection,
  ApiKeysSection,
  TestSection,
  WebhooksSection,
  UsageBillingSection,
  LogsSection,
} from "@/components/dashboard/sections";
import { ConsoleOverview } from "@/components/dashboard/ConsoleOverview";

interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  status: string;
}

export default function Dashboard() {
  const { session, isLoading, isAdmin } = useAuth();
  
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [activeSection, setActiveSection] = useState(() => {
    return localStorage.getItem("dashboard_active_section") || "overview";
  });
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Demo mode is active when user is not authenticated
  const isDemoMode = !session;

  const fetchApiKeys = useCallback(async () => {
    // SECURITY: Explicitly select only safe columns to avoid exposing key_hash
    // Never request key_hash or key_history from the api_keys table
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, name, scopes, status, created_at, last_used_at, expires_at")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Error fetching API keys", { description: error.message });
      return;
    }

    setApiKeys(data || []);
  }, [toast]);

  useEffect(() => {
    if (session) {
      fetchApiKeys();
      
      // Check if this is the first time the user is visiting
      const hasCompletedOnboarding = localStorage.getItem("onboarding_completed");
      if (!hasCompletedOnboarding) {
        setShowOnboarding(true);
      }
    }
  }, [session, fetchApiKeys]);

  // Persist active section to localStorage
  useEffect(() => {
    localStorage.setItem("dashboard_active_section", activeSection);
  }, [activeSection]);

  // Memoized content renderer for better performance
  const content = useMemo(() => {
    switch (activeSection) {
      case "overview":
        return <ConsoleOverview />;

      case "quickstart":
        return <QuickstartGuide onStartWizard={() => setShowOnboarding(true)} onSectionChange={setActiveSection} />;

      case "search":
        return <SearchSection />;

      case "matches":
        return <MatchesSection isDemoMode={isDemoMode} />;

      case "analytics":
        return <AnalyticsSection />;

      case "docs":
        return <DocsSection />;

      case "keys":
        return <ApiKeysSection />;

      case "test":
        return <TestSection />;

      case "sdk":
        return (
          <div className="space-y-6">
            <SdkDocumentation />
          </div>
        );

      case "webhooks":
        return <WebhooksSection />;

      case "audit-logs":
        return <LogsSection />;

      case "usage":
        return <UsageBillingSection />;

      case "troubleshooting":
        return <Troubleshooting />;

      default:
        return null;
    }
  }, [activeSection, isDemoMode, apiKeys]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Unauthenticated: show welcome interstitial instead of empty dashboard
  if (isDemoMode) {
    return <ConsoleWelcome />;
  }

  return (
    <>
      <OnboardingWizard 
        open={showOnboarding} 
        onClose={() => setShowOnboarding(false)} 
      />
      <DashboardLayout 
        activeSection={activeSection} 
        onSectionChange={setActiveSection}
        isAdmin={isAdmin}
        isDemoMode={false}
      >
        <SandboxIndicator isSandbox={true} />
        <ErrorBoundary>
          {content}
        </ErrorBoundary>
      </DashboardLayout>
    </>
  );
}