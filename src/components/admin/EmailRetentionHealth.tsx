/**
 * EmailRetentionHealth — admin-only surface confirming the 90-day
 * email_send_log purge is live and recently executed.
 *
 * Backed by RPC `get_email_retention_health` (SECURITY DEFINER, admin-gated).
 * Fails closed: if the cron hasn't run in >26h, status flips to "stalled" so
 * the absence of a recent purge is visible rather than silent.
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ShieldCheck, AlertTriangle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface RetentionHealth {
  retention_days: number;
  last_run_at: string | null;
  last_run_rows_deleted: number | null;
  hours_since_last_run: number | null;
  cron_active: boolean;
  cron_schedule: string | null;
  current_row_count: number;
  oldest_row_at: string | null;
  healthy: boolean;
  suppressed_emails_note: string;
}

export function EmailRetentionHealth() {
  const [data, setData] = useState<RetentionHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: result, error: rpcError } = await supabase.rpc("get_email_retention_health");
      if (cancelled) return;
      if (rpcError) {
        setError(rpcError.message);
      } else {
        setData(result as unknown as RetentionHealth);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking email retention status…
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-6">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Unable to load email retention status. {error ?? "Unknown error."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const lastRunLabel = data.last_run_at
    ? new Date(data.last_run_at).toLocaleString()
    : "Never executed";
  const hoursLabel =
    data.hours_since_last_run == null
      ? "—"
      : `${data.hours_since_last_run.toFixed(1)} h ago`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              Email log retention (PII purge)
            </CardTitle>
            <CardDescription>
              Recipient email addresses in the send log are hard-deleted after{" "}
              {data.retention_days} days. Required for POPIA/GDPR data minimisation.
            </CardDescription>
          </div>
          <Badge variant={data.healthy ? "default" : "destructive"}>
            {data.healthy ? "Enforced" : "Stalled"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Last purge run
            </div>
            <div className="font-medium">{lastRunLabel}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> {hoursLabel}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Rows deleted (last run)
            </div>
            <div className="font-medium">
              {data.last_run_rows_deleted ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Cron schedule
            </div>
            <div className="font-medium">
              {data.cron_active ? data.cron_schedule ?? "active" : "Inactive"}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Current send-log size
            </div>
            <div className="font-medium">
              {data.current_row_count.toLocaleString()} rows
            </div>
          </div>
        </div>

        {!data.healthy && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Retention purge has not run in the last 26 hours, or the cron job is
              inactive. PII may be retained beyond the {data.retention_days}-day
              policy window. Investigate the <code>purge-email-send-log-daily</code>{" "}
              cron job.
            </AlertDescription>
          </Alert>
        )}

        <p className="text-xs text-muted-foreground border-t pt-3">
          Note: the <code>suppressed_emails</code> table is intentionally exempt
          from this purge — bounce and complaint records must persist permanently
          to protect sender reputation.
        </p>
      </CardContent>
    </Card>
  );
}
