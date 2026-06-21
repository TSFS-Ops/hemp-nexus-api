/**
 * Phase 1 admin readiness surface — SMS / WhatsApp Notification Channel
 * Readiness Shell. No live sending controls. Status labels only.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  NOTIFICATION_SAFE_LABELS,
  PHASE_1_EVENT_CHANNEL_MATRIX,
  NOTIFICATION_SKIP_REASONS,
} from "@/lib/notification-channel-readiness";

interface ChannelRow {
  id: string;
  channel: string;
  status: string;
  provider_status: string;
  credentials_status: string;
  template_status: string;
  webhook_status: string;
  live_sending_enabled: boolean;
  test_send_enabled: boolean;
  safe_label: string;
}

function StatusChip({ value, ok }: { value: string; ok?: boolean }) {
  return (
    <Badge variant="outline" className={ok ? "border-emerald-500/40 text-emerald-700" : "border-amber-500/40 text-amber-700"}>
      {value.replace(/_/g, " ")}
    </Badge>
  );
}

export default function AdminNotificationChannelReadiness() {
  const [rows, setRows] = useState<ChannelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("notification-channel-readiness-list", { body: {} });
        if (error) throw error;
        if (!cancelled) setRows((data?.channels ?? []) as ChannelRow[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load channel readiness");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-1">Notification channel readiness — Phase 1</h1>
      <p className="text-sm text-muted-foreground mb-4">
        SMS and WhatsApp are <strong>Not Configured / Disabled</strong> in Phase 1. No live messages are sent, no
        provider credentials are stored, no provider webhooks exist, and no test sends are available.
      </p>

      <div className="border border-border bg-muted/40 rounded-md p-3 mb-4 text-sm">
        <strong className="font-medium">Phase 1 control: </strong>
        {NOTIFICATION_SAFE_LABELS.not_configured}
      </div>

      {error && (
        <Card className="mb-4 border-destructive/50">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        {(rows ?? []).map((r) => (
          <Card key={r.id} data-testid={`channel-card-${r.channel}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="uppercase">{r.channel}</span>
                <StatusChip value={r.status} ok={r.status === "active"} />
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-2">
              <p className="text-muted-foreground">{r.safe_label}</p>
              <dl className="grid grid-cols-2 gap-1">
                <dt>Provider</dt><dd><StatusChip value={r.provider_status} /></dd>
                <dt>Credentials</dt><dd><StatusChip value={r.credentials_status} /></dd>
                <dt>Templates</dt><dd><StatusChip value={r.template_status} /></dd>
                <dt>Webhook</dt><dd><StatusChip value={r.webhook_status} /></dd>
                <dt>Live sending</dt><dd><StatusChip value={r.live_sending_enabled ? "enabled" : "disabled"} /></dd>
                <dt>Test send</dt><dd><StatusChip value={r.test_send_enabled ? "enabled" : "disabled"} /></dd>
              </dl>
            </CardContent>
          </Card>
        ))}
        {rows === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      </section>

      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-base">Phase 1 event → channel matrix</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr><th>Event</th><th>In-app</th><th>Email</th><th>SMS</th><th>WhatsApp</th><th>Manual log</th></tr>
            </thead>
            <tbody>
              {PHASE_1_EVENT_CHANNEL_MATRIX.map((row) => (
                <tr key={row.event} className="border-t border-border">
                  <td className="py-1 font-mono">{row.event}</td>
                  <td>{row.in_app ? "✓" : "—"}</td>
                  <td>{row.email ? "✓" : "—"}</td>
                  <td>not allowed</td>
                  <td>not allowed</td>
                  <td>{row.manual_sms_whatsapp_log_allowed ? "admin/support" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Recognised skip reasons</CardTitle></CardHeader>
        <CardContent>
          <ul className="text-xs grid grid-cols-1 md:grid-cols-2 gap-1">
            {NOTIFICATION_SKIP_REASONS.map((r) => (
              <li key={r} className="font-mono">{r}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground mt-3">
            Delivery status in Phase 1 must never read "sent" or "delivered" for SMS or WhatsApp.
            Provider message ID is recorded as <code>not_applicable</code>.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
