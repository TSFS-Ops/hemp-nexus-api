/**
 * Renders on every legacy /funder/p5-batch* and /funder/evidence-pack
 * page so pilot users can tell at a glance they are not in the canonical
 * Funder Workspace. Non-blocking, deep-linkable, keeps functionality.
 */
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

interface Props {
  /** Short human name for what this page used to be. */
  surface?: string;
  /** Deep-link target inside the canonical workspace, when there is one. */
  canonicalHref?: string;
  canonicalLabel?: string;
}

export function LegacyBanner({
  surface,
  canonicalHref = "/funder/workspace",
  canonicalLabel = "Go to Funder Workspace",
}: Props) {
  return (
    <Alert className="mb-4 border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>Internal / legacy view</AlertTitle>
      <AlertDescription className="text-sm">
        <p>
          {surface
            ? `The ${surface} surface is retained for compliance/history.`
            : "This screen is retained for compliance/history."}
          {" "}
          It is not part of the primary funder workflow. Some data here is
          internal or prototype and may not match what a funder sees in the
          canonical workspace.
        </p>
        <p className="mt-2">
          <Link to={canonicalHref} className="underline font-medium">
            {canonicalLabel}
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  );
}
