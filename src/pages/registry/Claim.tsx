/**
 * Batch 1 — Claim workflow placeholder (M004 not_started).
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";

export default function RegistryClaim() {
  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Claim your company</h1>
      <ReadinessBanner state="not_started" moduleCode="M004" />
      <Card>
        <CardHeader><CardTitle className="text-base">Coming in a later batch</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The claim workflow, evidence capture, review queue and authority-to-act sequence
            will be built in subsequent batches under their own recorded business decisions.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
