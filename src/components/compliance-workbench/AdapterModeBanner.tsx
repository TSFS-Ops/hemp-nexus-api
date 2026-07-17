import { AlertTriangle, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getAdapterMode, isDevMode } from "@/lib/compliance-workbench";

/**
 * Banner shown whenever the workbench is running against fixture data.
 * In production builds we omit developer-only wording — but keep a subtle
 * "awaiting secure backend enablement" notice so no user is misled into
 * thinking an action persisted.
 */
export function AdapterModeBanner() {
  const mode = getAdapterMode();
  const dev = isDevMode();
  if (mode === "fixture" && dev) {
    return (
      <Alert className="mb-4">
        <Info className="h-4 w-4" />
        <AlertTitle>Development preview data</AlertTitle>
        <AlertDescription>
          This workbench is displaying deterministic fixtures. Actions will
          simulate success locally but do not persist. Switch to live mode from
          the developer switch to exercise the not-implemented pathway.
        </AlertDescription>
      </Alert>
    );
  }
  if (mode === "live") {
    return (
      <Alert variant="destructive" className="mb-4">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Awaiting secure backend enablement</AlertTitle>
        <AlertDescription>
          The Compliance Case Management backend is not yet connected. Reads
          and mutations will return an explicit not-implemented response until
          it is enabled.
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}
