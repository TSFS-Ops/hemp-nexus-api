import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Public header for izenzo.co.za.
 * Nav: How it Works | Signals | Developer Access | Sign In | Create Account
 * Logged-in: replaces Create Account with "Go to Dashboard"
 */
export function PublicHeader() {
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  const authUrl = getAuthUrl();
  const { isAuthenticated } = useAuth();

  const AuthLink = ({ children, className }: { children: React.ReactNode; className?: string }) => {
    if (isPreview) {
      return <Link to="/auth" className={className}>{children}</Link>;
    }
    return <a href={authUrl} className={className}>{children}</a>;
  };

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <nav className="border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Wordmark */}
        <Link to="/" className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-[10px] tracking-tight">IZ</span>
          </div>
          <span className="font-semibold text-sm tracking-tight text-foreground">Izenzo</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          <button
            onClick={() => scrollTo("how-it-works")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            How it Works
          </button>
          <button
            onClick={() => scrollTo("signals")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Signals
          </button>
          <Link
            to="/docs"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Developer Access
          </Link>
        </div>

        {/* Auth actions */}
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Go to Dashboard
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <>
              <AuthLink className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:inline-flex">
                Sign In
              </AuthLink>
              <AuthLink className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                Create Account
                <ArrowRight className="h-3.5 w-3.5" />
              </AuthLink>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
