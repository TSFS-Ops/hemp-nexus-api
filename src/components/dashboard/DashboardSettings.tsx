import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiKeysSection } from "@/components/dashboard/sections/ApiKeysSection";
import { WebhooksSection } from "@/components/dashboard/sections/WebhooksSection";
import { UsageBillingSection } from "@/components/dashboard/sections/UsageBillingSection";
import { useUrlTab } from "@/hooks/use-url-tab";

/**
 * Unified settings page: API Keys, Webhooks, and Usage & Billing.
 * 
 * "purchase" tab now redirects to /billing (canonical credit purchase route).
 * Tab state synced to ?tab= query param for deep-linking.
 */
export function DashboardSettings() {
  const [tab, setTab] = useUrlTab("tab", "keys", ["keys", "webhooks", "billing"]);
  const navigate = useNavigate();

  // Redirect legacy ?tab=purchase links to the canonical /billing route
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "purchase") {
      navigate("/billing", { replace: true });
    }
  }, [navigate]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your API keys, webhooks, and usage.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="billing">Usage & Billing</TabsTrigger>
        </TabsList>
        <TabsContent value="keys" className="mt-4">
          <ApiKeysSection />
        </TabsContent>
        <TabsContent value="webhooks" className="mt-4">
          <WebhooksSection />
        </TabsContent>
        <TabsContent value="billing" className="mt-4">
          <UsageBillingSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
