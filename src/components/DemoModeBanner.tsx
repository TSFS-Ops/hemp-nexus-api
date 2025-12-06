import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Play } from "lucide-react";

interface DemoModeBannerProps {
  variant?: "compact" | "full";
}

export function DemoModeBanner({ variant = "full" }: DemoModeBannerProps) {
  if (variant === "compact") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
        <Play className="h-4 w-4 text-amber-600" />
        <span className="text-sm text-amber-700 dark:text-amber-300 font-medium">Demo Mode</span>
        <Link to="/auth" className="ml-auto">
          <Button size="sm" variant="outline" className="h-7 text-xs">
            Sign up for full access
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <Alert className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertTitle className="text-amber-800 dark:text-amber-200">Demo Mode</AlertTitle>
      <AlertDescription className="text-amber-700 dark:text-amber-300">
        You're exploring the API in demo mode. Searches return simulated data and no real proofs will be created.
        <Link to="/auth" className="underline ml-1 font-medium">Sign up</Link> or <Link to="/auth" className="underline font-medium">log in</Link> for full access to live search and verified intent records.
      </AlertDescription>
    </Alert>
  );
}
