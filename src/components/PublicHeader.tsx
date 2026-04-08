import { Link } from "react-router-dom";
import { ArrowRight, Globe, HelpCircle } from "lucide-react";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { useAuth } from "@/contexts/AuthContext";

export function PublicHeader() {
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  const authUrl = getAuthUrl();
  const { isAuthenticated } = useAuth();

  const AuthLink = ({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) => {
    if (isPreview) {
      return <Link to="/auth" className={className} style={style}>{children}</Link>;
    }
    return <a href={authUrl} className={className} style={style}>{children}</a>;
  };

  return (
    <nav
      className="sticky top-0 z-50 backdrop-blur-md"
      style={{
        backgroundColor: 'rgba(10, 14, 23, 0.85)',
        borderBottom: '1px solid var(--lt-border)',
      }}
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Logo + tagline */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ backgroundColor: 'var(--lt-emerald-dark)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight" style={{ color: 'var(--lt-text)' }}>Izenzo</span>
          </div>
          <div className="hidden sm:block h-5 w-px" style={{ backgroundColor: 'var(--lt-border)' }} />
          <span className="hidden sm:block text-xs font-medium" style={{ color: 'var(--lt-text-muted)' }}>
            Governed infrastructure for trade and compliance
          </span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <button className="w-9 h-9 rounded-md flex items-center justify-center transition-colors duration-200 hover:bg-white/5" style={{ color: 'var(--lt-text-muted)' }}>
            <Globe className="h-4 w-4" />
          </button>
          <button className="w-9 h-9 rounded-md flex items-center justify-center transition-colors duration-200 hover:bg-white/5" style={{ color: 'var(--lt-text-muted)' }}>
            <HelpCircle className="h-4 w-4" />
          </button>

          <div className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--lt-border)' }} />

          {isAuthenticated ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 px-4 h-8 text-xs font-mono font-medium rounded-md transition-all duration-200"
              style={{ backgroundColor: 'var(--lt-emerald-dark)', color: 'white' }}
            >
              Dashboard
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : (
            <>
              <AuthLink className="hidden sm:inline-flex items-center px-3 h-8 text-xs font-medium rounded-md transition-all duration-200 hover:bg-white/5"
                        style={{ color: 'var(--lt-text-muted)' }}>
                Log In
              </AuthLink>
              <AuthLink className="inline-flex items-center gap-1.5 px-4 h-8 text-xs font-semibold rounded-md transition-all duration-200 hover:opacity-90"
                        style={{ backgroundColor: 'var(--lt-emerald-dark)', color: 'white' }}>
                Create Account
                <ArrowRight className="h-3 w-3" />
              </AuthLink>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
