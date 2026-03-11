import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { useAuth } from "@/contexts/AuthContext";

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
    <nav className="border-b border-border bg-background/98 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight text-foreground">Izenzo</span>
          <span className="text-[10px] font-medium text-muted-foreground tracking-wide uppercase">API</span>
        </Link>

        <div className="hidden md:flex items-center gap-5">
          <button
            onClick={() => scrollTo("how-it-works")}
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            How it Works
          </button>
          <button
            onClick={() => scrollTo("signals")}
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Signals
          </button>
          <Link
            to="/docs"
            className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Developer Access
          </Link>
        </div>

        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium rounded-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Dashboard
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : (
            <>
              <AuthLink className="text-[13px] text-muted-foreground hover:text-foreground transition-colors hidden sm:inline-flex">
                Sign In
              </AuthLink>
              <AuthLink className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium rounded-sm border border-border text-foreground hover:bg-muted transition-colors">
                Create Account
              </AuthLink>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
