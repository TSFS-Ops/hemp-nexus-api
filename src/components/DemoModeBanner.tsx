import { Link } from "react-router-dom";

interface DemoModeBannerProps {
  variant?: "compact" | "full";
}

export function DemoModeBanner({ variant = "full" }: DemoModeBannerProps) {
  if (variant === "compact") {
    return (
      <div className="flex items-center gap-3 px-3 py-2 bg-muted/50 border border-border rounded-md">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sandbox</span>
        <span className="text-xs text-muted-foreground">Results are simulated</span>
        <Link to="/auth" className="ml-auto">
          <button className="px-2.5 py-1 text-xs font-medium rounded border border-border bg-background hover:bg-accent transition-colors">
            Sign up
          </button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 p-4 bg-muted/40 border border-border rounded-md">
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground mb-1">Sandbox Mode</p>
        <p className="text-sm text-muted-foreground">
          You are exploring with simulated data. No real matches or evidence records will be created.
          <Link to="/auth" className="text-primary hover:underline ml-1">Sign up</Link> or 
          <Link to="/auth" className="text-primary hover:underline ml-1">log in</Link> for production access.
        </p>
      </div>
    </div>
  );
}