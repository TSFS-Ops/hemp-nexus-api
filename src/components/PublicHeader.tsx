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
    <nav className="border-b border-border bg-background sticky top-0 z-50">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-11 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-1.5">
          <span className="text-[14px] font-bold tracking-tighter text-foreground">IZENZO</span>
          <span className="text-[10px] font-mono font-medium text-muted-foreground tracking-widest uppercase">API</span>
        </Link>

        {/* Center nav */}
        <div className="hidden md:flex items-center gap-6">
          <button
            onClick={() => scrollTo("how-it-works")}
            className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            How it Works
          </button>
          <button
            onClick={() => scrollTo("signals")}
            className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            Signals
          </button>
          <Link
            to="/docs"
            className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            Developer Access
          </Link>
        </div>

        {/* Auth */}
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 px-3 h-7 text-[11px] font-mono uppercase tracking-widest font-medium bg-primary text-primary-foreground shadow-inner-metallic hover:opacity-90 transition-opacity"
            >
              Dashboard
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : (
            <>
              <AuthLink className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors hidden sm:inline-flex">
                Sign In
              </AuthLink>
              <AuthLink className="inline-flex items-center gap-1 px-3 h-7 text-[11px] font-mono uppercase tracking-widest font-medium border border-border text-foreground hover:bg-accent transition-colors">
                Create Account
              </AuthLink>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
