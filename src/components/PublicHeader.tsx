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
    <nav className="border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group">
          <span className="text-[14px] font-bold tracking-tighter text-foreground transition-colors">IZENZO</span>
          <span className="text-[9px] font-mono font-medium text-muted-foreground tracking-widest uppercase border border-border px-1.5 py-0.5 group-hover:border-primary/30 transition-colors">
            API
          </span>
        </Link>

        {/* Center nav — with subtle hover underlines */}
        <div className="hidden md:flex items-center gap-8">
          <Link
            to="/docs"
            className="relative text-[11px] font-mono uppercase tracking-widest text-muted-foreground
                     hover:text-foreground transition-colors py-1
                     after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px
                     after:bg-primary after:scale-x-0 after:transition-transform after:duration-300
                     hover:after:scale-x-100 after:origin-left"
          >
            Developer Access
          </Link>
        </div>

        {/* Auth */}
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 px-3.5 h-8 text-[11px] font-mono uppercase tracking-widest font-medium
                       bg-primary text-primary-foreground shadow-inner-metallic
                       hover:opacity-90 transition-all active:scale-[0.98]"
            >
              Dashboard
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : (
            <>
              <AuthLink className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors hidden sm:inline-flex">
                Sign In
              </AuthLink>
              <AuthLink className="inline-flex items-center gap-1.5 px-3.5 h-8 text-[11px] font-mono uppercase tracking-widest font-medium
                                 border border-border text-foreground hover:bg-accent hover:border-foreground/15 transition-all active:scale-[0.98]">
                Create Account
              </AuthLink>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
