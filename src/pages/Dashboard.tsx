import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { QuickstartGuide } from "@/components/dashboard/QuickstartGuide";
import { SdkDocumentation } from "@/components/SdkDocumentation";
import EmbeddableWidget from "@/components/EmbeddableWidget";
import WebhookDebugger from "@/components/WebhookDebugger";
import HashVerifier from "@/components/HashVerifier";
import CronSetupInstructions from "@/components/CronSetupInstructions";
import SystemHealthMonitor from "@/components/SystemHealthMonitor";
import AutomatedTestSuite from "@/components/AutomatedTestSuite";
import ErrorMonitoringDashboard from "@/components/ErrorMonitoringDashboard";
import Troubleshooting from "@/components/Troubleshooting";
import OnboardingWizard from "@/components/OnboardingWizard";
import { SandboxIndicator } from "@/components/SandboxIndicator";
import { DemoModeBanner } from "@/components/DemoModeBanner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// Import modular section components
import {
  SearchSection,
  MatchesSection,
  AnalyticsSection,
  DocsSection,
  ApiKeysSection,
  TestSection,
  WebhooksSection,
  AuditLogsSection,
} from "@/components/dashboard/sections";

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
  const { toast } = useToast();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [activeSection, setActiveSection] = useState(() => {
    return localStorage.getItem("dashboard_active_section") || "search";
  });
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Demo mode is active when user is not authenticated
  const isDemoMode = !session;

  const fetchApiKeys = useCallback(async () => {
    const { data, error } = await supabase
      .from("api_keys")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      toast({
        variant: "destructive",
        title: "Error fetching API keys",
        description: error.message,
      });
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

      case "embed":
        return (
          <div className="space-y-6">
            <EmbeddableWidget />
          </div>
        );

      case "webhooks":
        return <WebhooksSection />;

      case "webhook-debugger":
        return (
          <div className="space-y-6">
            <WebhookDebugger />
          </div>
        );

      case "audit-logs":
        return <AuditLogsSection apiKeyId={apiKeys[0]?.id} />;

      case "data-sources":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">Data Sources</h1>
              <p className="text-muted-foreground">
                Configure external data integrations
              </p>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Coming Soon</CardTitle>
                <CardDescription>
                  Data source management interface will be available soon
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        );

      case "hash-verify":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">Hash Verifier</h1>
              <p className="text-muted-foreground">
                Cryptographic verification for audit trails
              </p>
            </div>
            <HashVerifier />
          </div>
        );

      case "automation":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">Changelog</h1>
              <p className="text-muted-foreground">
                API updates, improvements, and breaking changes
              </p>
            </div>
            <CronSetupInstructions />
          </div>
        );

      case "system-health":
        return (
          <div className="space-y-6">
            <SystemHealthMonitor />
          </div>
        );

      case "automated-tests":
        return (
          <div className="space-y-6">
            <AutomatedTestSuite />
          </div>
        );

      case "error-monitoring":
        return (
          <div className="space-y-6">
            <ErrorMonitoringDashboard />
          </div>
        );

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

  return (
    <>
      {!isDemoMode && (
        <OnboardingWizard 
          open={showOnboarding} 
          onClose={() => setShowOnboarding(false)} 
        />
      )}
      <DashboardLayout 
        activeSection={activeSection} 
        onSectionChange={setActiveSection}
        isAdmin={isAdmin}
        isDemoMode={isDemoMode}
      >
        {isDemoMode && <DemoModeBanner variant="compact" />}
        {!isDemoMode && <SandboxIndicator isSandbox={true} />}
        {content}
      </DashboardLayout>
    </>
  );
}