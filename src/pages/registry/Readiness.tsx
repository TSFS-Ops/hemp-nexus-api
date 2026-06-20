/**
 * Batch 1 — Client-safe readiness summary placeholder (M017 not_started).
 * Full client-facing readiness dashboard is deferred to a later batch.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";

export default function RegistryReadiness() {
  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Module readiness</h1>
      <ReadinessBanner state="not_started" moduleCode="M017" />
      <Card>
        <CardHeader><CardTitle className="text-base">Coming in a later batch</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The client-safe readiness summary will be built once the underlying readiness
            truth layer is populated for each module and country. Internal readiness can
            be reviewed today under the admin registry area.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
