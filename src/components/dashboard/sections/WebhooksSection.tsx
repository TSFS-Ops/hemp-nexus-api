import { WebhookManagement } from "@/components/dashboard/WebhookManagement";
import WebhookDeliveryLogs from "@/components/WebhookDeliveryLogs";

export function WebhooksSection() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="space-y-1">
        <h1 className="font-bold tracking-tight">Webhooks</h1>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-2xl">
          Real-time event notifications for your integration
        </p>
      </header>
      <WebhookManagement />
      <WebhookDeliveryLogs />
    </div>
  );
}
