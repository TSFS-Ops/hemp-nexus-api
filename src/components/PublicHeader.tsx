import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Menu, X } from "lucide-react";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { useAuth } from "@/contexts/AuthContext";
import { ROUTES } from "@/lib/constants";

const PUBLIC_NAV = [
  { label: "Pricing", to: ROUTES.PRICING },
  { label: "Docs", to: ROUTES.DOCS },
  { label: "Walkthrough", to: ROUTES.WALKTHROUGH },
];

export function PublicHeader() {
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  const authUrl = getAuthUrl();
  const { isAuthenticated } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const AuthLink = ({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) => {
    if (isPreview) {
      return <Link to="/auth" className={className} style={style}>{children}</Link>;
    }
    return <a href={authUrl} className={className} style={style}>{children}</a>;
  };

  return (
    <nav
      className="sticky top-0 z-50"
      style={{
        backgroundColor: '#0A0E17',
        borderBottom: '1px solid var(--lt-border)',
      }}
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ backgroundColor: 'var(--lt-emerald-dark)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight" style={{ color: 'var(--lt-text)' }}>Izenzo</span>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden sm:flex items-center gap-4">
          {PUBLIC_NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="text-xs font-medium transition-colors hover:opacity-80"
              style={{ color: '#F1F5F9' }}
            >
              {item.label}
            </Link>
          ))}

          <div className="h-4 w-px" style={{ backgroundColor: 'var(--lt-border)' }} />

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
               <AuthLink className="inline-flex items-center px-3 h-8 text-xs font-medium rounded-md transition-all duration-200 hover:bg-white/10"
                        style={{ color: '#F1F5F9' }}>
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

        {/* Mobile hamburger */}
        <div className="sm:hidden flex items-center gap-2">
          {isAuthenticated ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1 px-3 h-8 text-xs font-medium rounded-md"
              style={{ backgroundColor: 'var(--lt-emerald-dark)', color: 'white' }}
            >
              Dashboard
            </Link>
          ) : (
            <AuthLink className="inline-flex items-center gap-1 px-3 h-8 text-xs font-semibold rounded-md"
                      style={{ backgroundColor: 'var(--lt-emerald-dark)', color: 'white' }}>
              Log In
            </AuthLink>
          )}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 rounded-md transition-colors hover:bg-white/5"
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <X className="h-5 w-5" style={{ color: 'var(--lt-text)' }} />
            ) : (
              <Menu className="h-5 w-5" style={{ color: 'var(--lt-text)' }} />
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div
          className="sm:hidden border-t px-4 py-3 space-y-1"
          style={{ borderColor: 'var(--lt-border)', backgroundColor: 'rgba(10, 14, 23, 0.95)' }}
        >
          {PUBLIC_NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className="block px-3 py-2.5 rounded-md text-sm font-medium transition-colors hover:bg-white/5"
              style={{ color: 'var(--lt-text-muted)' }}
            >
              {item.label}
            </Link>
          ))}
          {!isAuthenticated && (
            <AuthLink
              className="block px-3 py-2.5 rounded-md text-sm font-medium transition-colors hover:bg-white/5"
              style={{ color: 'var(--lt-text-muted)' }}
            >
              Create Account
            </AuthLink>
          )}
        </div>
      )}
    </nav>
  );
}
