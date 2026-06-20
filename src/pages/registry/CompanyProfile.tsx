/**
 * Batch 1 — Company profile shell (M003 not_started).
 */
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";

export default function CompanyProfile() {
  const { id } = useParams();
  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Company profile</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M003" />
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-mono text-xs">Record ID: {id}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="profile-empty-state">
            No company record has been loaded for this identifier. The profile data model,
            claim status, authority status and bank-detail status sections will appear here
            once the underlying source data layer is recorded and approved.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
