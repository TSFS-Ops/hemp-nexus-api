import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import AuditLogViewer from "@/components/AuditLogViewer";

interface AuditLogsSectionProps {
  apiKeyId?: string;
}

export function AuditLogsSection({ apiKeyId }: AuditLogsSectionProps) {
  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="space-y-1">
        <h1 className="font-bold tracking-tight">Logs</h1>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-2xl">
          Audit trail of all API operations
        </p>
      </header>
      {apiKeyId ? (
        <AuditLogViewer apiKey={apiKeyId} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">No API Keys</CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              Create an API key first to view audit logs
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
