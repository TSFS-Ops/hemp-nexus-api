import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiKeysSection } from "@/components/dashboard/sections/ApiKeysSection";
import { WebhooksSection } from "@/components/dashboard/sections/WebhooksSection";
import { UsageBillingSection } from "@/components/dashboard/sections/UsageBillingSection";

/**
 * Unified settings page: API Keys, Webhooks, and Usage & Billing in tabs.
 */
export function DashboardSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your API keys, webhooks, and billing.</p>
      </div>

      <Tabs defaultValue="keys" className="w-full">
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
