import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import AuditLogViewer from "@/components/AuditLogViewer";

interface AuditLogsSectionProps {
  apiKeyId?: string;
}

export function AuditLogsSection({ apiKeyId }: AuditLogsSectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">Logs</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Audit trail of all API operations
        </p>
      </div>
      {apiKeyId ? (
        <AuditLogViewer apiKey={apiKeyId} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No API Keys</CardTitle>
            <CardDescription>
              Create an API key first to view audit logs
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
