import { WebhookManagement } from "@/components/dashboard/WebhookManagement";
import WebhookDeliveryLogs from "@/components/WebhookDeliveryLogs";
import { SectionHeader } from "@/components/ui/section-header";

export function WebhooksSection() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <SectionHeader
        title="Webhooks"
        description="Real-time event notifications for your integration"
      />
      <WebhookManagement />
      <WebhookDeliveryLogs />
    </div>
  );
}
