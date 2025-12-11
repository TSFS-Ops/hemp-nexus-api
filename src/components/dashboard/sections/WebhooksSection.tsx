import { WebhookManagement } from "@/components/dashboard/WebhookManagement";
import WebhookDeliveryLogs from "@/components/WebhookDeliveryLogs";

export function WebhooksSection() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">Webhooks</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Real-time event notifications for your integration
        </p>
      </div>
      <WebhookManagement />
      <WebhookDeliveryLogs />
    </div>
  );
}
