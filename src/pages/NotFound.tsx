import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { ArrowLeft } from "lucide-react";

/**
 * Lightweight 404 page — shown for unknown routes instead of silently
 * redirecting to /, which hides navigation errors from both users and developers.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="text-center max-w-sm">
        <p className="text-6xl font-bold text-muted-foreground/30 mb-4">404</p>
        <h1 className="text-xl font-semibold text-foreground mb-2">Page not found</h1>
        <p className="text-sm text-muted-foreground mb-6">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button asChild>
            <Link to={ROUTES.DASHBOARD}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go to Dashboard
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to={ROUTES.ROOT}>Home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
