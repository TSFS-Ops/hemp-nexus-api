import { Link } from "react-router-dom";

interface DemoModeBannerProps {
  variant?: "compact" | "full";
}

export function DemoModeBanner({ variant = "full" }: DemoModeBannerProps) {
  if (variant === "compact") {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/50 border border-border rounded-lg mb-6">
        <span className="text-xs font-medium text-muted-foreground">Demo mode</span>
        <span className="text-xs text-muted-foreground">— Results are simulated. No real evidence records created.</span>
        <Link to="/auth" className="ml-auto">
          <button className="px-3 py-1 text-xs font-medium rounded border border-border bg-background hover:bg-accent transition-colors">
            Sign up
          </button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 p-4 bg-muted/30 border border-border rounded-lg mb-6">
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground mb-1">Demo mode</p>
        <p className="text-sm text-muted-foreground">
          You are exploring with simulated data. No real evidence records are created.{" "}
          <Link to="/auth" className="text-primary hover:underline">Sign up</Link> or{" "}
          <Link to="/auth" className="text-primary hover:underline">log in</Link> for production access.
        </p>
      </div>
    </div>
  );
}
