import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import AuditLogViewer from "@/components/AuditLogViewer";
import { SectionHeader } from "@/components/ui/section-header";

interface AuditLogsSectionProps {
  apiKeyId?: string;
}

export function AuditLogsSection({ apiKeyId }: AuditLogsSectionProps) {
  return (
    <div className="space-y-5 sm:space-y-6">
      <SectionHeader
        title="Logs"
        description="Audit trail of all API operations"
      />
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
