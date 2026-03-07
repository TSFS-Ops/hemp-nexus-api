import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiKeysSection } from "@/components/dashboard/sections/ApiKeysSection";
import { WebhooksSection } from "@/components/dashboard/sections/WebhooksSection";
import { UsageBillingSection } from "@/components/dashboard/sections/UsageBillingSection";
import { BillingCheckout } from "@/components/dashboard/sections/BillingCheckout";
import { useUrlTab } from "@/hooks/use-url-tab";

/**
 * Unified settings page: API Keys, Webhooks, Usage & Billing, and Credit Purchase in tabs.
 * Tab state synced to ?tab= query param for deep-linking.
 */
export function DashboardSettings() {
  const [tab, setTab] = useUrlTab("tab", "keys", ["keys", "webhooks", "billing", "purchase"]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your API keys, webhooks, billing, and purchase credits.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="billing">Usage & Billing</TabsTrigger>
          <TabsTrigger value="purchase">Buy Credits</TabsTrigger>
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
        <TabsContent value="purchase" className="mt-4">
          <BillingCheckout />
        </TabsContent>
      </Tabs>
    </div>
  );
}
