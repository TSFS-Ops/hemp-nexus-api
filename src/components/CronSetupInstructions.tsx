import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Code, Copy, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function CronSetupInstructions() {
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const webhookRetrySql = `SELECT cron.schedule(
  'webhook-retry-job',
  '*/5 * * * *',  -- Every 5 minutes
  $$
  SELECT
    net.http_post(
        url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/webhook-retry',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
        body := '{}'::jsonb
    ) as request_id;
  $$
);`;

  const apiKeyExpirySql = `SELECT cron.schedule(
  'api-key-expiry-job',
  '0 9 * * *',  -- Daily at 9:00 AM UTC
  $$
  SELECT
    net.http_post(
        url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/api-key-expiry',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
        body := '{}'::jsonb
    ) as request_id;
  $$
);`;

  const enableExtensionsSql = `-- Enable pg_cron extension for scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;`;

  const viewJobsSql = `SELECT * FROM cron.job;`;

  const viewLogsSql = `SELECT * FROM cron.job_run_details 
ORDER BY start_time DESC 
LIMIT 10;`;

  const unscheduleSql = `SELECT cron.unschedule('webhook-retry-job');
SELECT cron.unschedule('api-key-expiry-job');`;

  return (
    <div className="space-y-4">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <strong>Important:</strong> These automated jobs require setup in your Supabase SQL Editor. 
          Replace <code>YOUR_ANON_KEY</code> with your actual anon key before running.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="enable" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="enable">1. Enable Extensions</TabsTrigger>
          <TabsTrigger value="schedule">2. Schedule Jobs</TabsTrigger>
          <TabsTrigger value="manage">3. Manage Jobs</TabsTrigger>
        </TabsList>

        <TabsContent value="enable" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Enable Required Extensions</CardTitle>
              <CardDescription>
                Run this SQL in your Supabase SQL Editor to enable pg_cron and pg_net
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                  <code>{enableExtensionsSql}</code>
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(enableExtensionsSql, "SQL")}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Webhook Retry Automation</CardTitle>
              <CardDescription>
                Runs every 5 minutes to retry failed webhook deliveries
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <Code className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Schedule: <code>*/5 * * * *</code> (Every 5 minutes)
                </AlertDescription>
              </Alert>
              <div className="relative">
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                  <code>{webhookRetrySql}</code>
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(webhookRetrySql, "Webhook retry SQL")}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>API Key Expiry Automation</CardTitle>
              <CardDescription>
                Runs daily at 9 AM UTC to check for expiring/expired keys
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <Code className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Schedule: <code>0 9 * * *</code> (Daily at 9:00 AM UTC)
                </AlertDescription>
              </Alert>
              <div className="relative">
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                  <code>{apiKeyExpirySql}</code>
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(apiKeyExpirySql, "API key expiry SQL")}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manage" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>View Scheduled Jobs</CardTitle>
              <CardDescription>Check which cron jobs are active</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                  <code>{viewJobsSql}</code>
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(viewJobsSql, "View jobs SQL")}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>View Job Execution Logs</CardTitle>
              <CardDescription>Check the last 10 job runs and their status</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                  <code>{viewLogsSql}</code>
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(viewLogsSql, "View logs SQL")}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Unschedule Jobs</CardTitle>
              <CardDescription>Remove cron jobs if needed</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                  <code>{unscheduleSql}</code>
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(unscheduleSql, "Unschedule SQL")}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Cron Expression Reference</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-lg text-xs overflow-x-auto">
{`┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday to Saturday)
│ │ │ │ │
│ │ │ │ │
* * * * *

Examples:
  */5 * * * *     Every 5 minutes
  0 * * * *       Every hour
  0 9 * * *       Daily at 9 AM
  0 0 * * 0       Weekly on Sunday at midnight
  0 0 1 * *       Monthly on the 1st at midnight`}
          </pre>
        </CardContent>
      </Card>

      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertDescription>
          <strong>Success indicators:</strong> After setup, check the <code>cron.job_run_details</code> table 
          for successful executions. Jobs should show <code>status = 'succeeded'</code>.
        </AlertDescription>
      </Alert>
    </div>
  );
}
