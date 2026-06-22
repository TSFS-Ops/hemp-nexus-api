/**
 * Batch 1 — Business Registry module landing (shell only).
 * Batch 22 — Shell-aware internal links so the Trade Desk sidebar is
 * preserved when entered from /desk/registry.
 */
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { useRegistryBase } from "@/lib/use-registry-base";

export default function RegistryLanding() {
  const base = useRegistryBase();
  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Business Registry</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M001" />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Company search</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Search by name, registration number, VAT/tax number, address, country or legal form.
              Partial matches are supported.
            </p>
            <Link to={`${base}/search`} className="text-sm underline" data-testid="registry-search-link">
              Open company search
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">My companies</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              View claims you have started and companies you are authorised to act for.
            </p>
            <Link to={`${base}/my-companies`} className="text-sm underline" data-testid="registry-my-companies-link">
              Open my companies
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
