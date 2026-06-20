/**
 * Batch 1 — Public company search shell.
 * No records may be returned from this shell; M002 is not_started.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";

export default function RegistrySearch() {
  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Company search</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M002" />
      <Card>
        <CardHeader><CardTitle className="text-base">Search shell</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Company name or registration number" disabled />
          <Button disabled>Search</Button>
          <p className="text-xs text-muted-foreground" data-testid="search-empty-state">
            No records are loaded. The search interface and results layer will be enabled
            in a later batch once a recorded data-source decision is in place.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
