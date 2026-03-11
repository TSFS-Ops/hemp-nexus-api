import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FlaskConical } from "lucide-react";

// ── Sandbox Indicator (for authenticated console) ───────────────────────

interface SandboxIndicatorProps {
  isSandbox?: boolean;
}

export function SandboxIndicator({ isSandbox = true }: SandboxIndicatorProps) {
  if (!isSandbox) return null;

  return (
    <div className="mb-6">
      <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950">
        <FlaskConical className="h-4 w-4 text-amber-600 shrink-0" />
        <AlertDescription className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 border-amber-300 shrink-0 w-fit"
          >
            <FlaskConical className="h-3 w-3 mr-1" />
            Sandbox
          </Badge>
          <span className="text-sm text-amber-800 dark:text-amber-200">
            You are using a sandbox environment. Data here is isolated from production.
          </span>
        </AlertDescription>
      </Alert>
    </div>
  );
}
