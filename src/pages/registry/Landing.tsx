/**
 * Batch 1 — Business Registry module landing (shell only).
 */
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";

export default function RegistryLanding() {
  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Business Registry</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M001" />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Company search</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Shell only — no records have been loaded.
            </p>
            <Link to="/registry/search" className="text-sm underline">Open search shell</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Claim your company</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              The claim workflow is being built in a later batch and is not yet available.
            </p>
            <Link to="/registry/claim" className="text-sm underline">View placeholder</Link>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
