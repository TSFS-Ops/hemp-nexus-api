import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Menu, X, ChevronDown } from "lucide-react";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { useAuth } from "@/contexts/AuthContext";
import { ROUTES } from "@/lib/constants";

type MegaItem = { label: string; description: string; to: string };
type MegaCategory = { key: string; label: string; items: MegaItem[] };

const MEGA_NAV: MegaCategory[] = [
  {
    key: "products",
    label: "Products",
    items: [
      { label: "Trade Desk", description: "Operational workspace for live deals", to: "/products/trade-desk" },
      { label: "Compliance Engine", description: "KYB, sanctions & jurisdictional gates", to: "/products/compliance-engine" },
      { label: "Audit Ledger", description: "Immutable, tamper-proofally sealed deal records", to: "/products/audit-ledger" },
    ],
  },
  {
    key: "solutions",
    label: "Solutions",
    items: [
      { label: "Commodity Traders & Corporates", description: "Execute cross-border deals with verified counterparties.", to: "/solutions/traders" },
      { label: "Trade Finance & Insurance", description: "De-risk letters of credit with tamper-proofally sealed proof.", to: "/solutions/finance" },
      { label: "Sovereigns & PDBs", description: "Govern institutional trade programmes at scale.", to: "/solutions/sovereigns" },
    ],
  },
  {
    key: "developers",
    label: "Developers",
    items: [
      { label: "Documentation", description: "Guides, concepts & quickstarts", to: "/docs" },
      { label: "API Reference", description: "Full endpoint specification", to: "/docs/api" },
      { label: "Webhooks", description: "Signed callbacks & event catalogue", to: "/docs/webhooks" },
      { label: "System Status", description: "Platform information & support contact", to: "/status" },
    ],
  },
  {
    key: "resources",
    label: "Resources",
    items: [
      { label: "Pricing", description: "Credits & pricing", to: ROUTES.PRICING },
      { label: "Platform Walkthrough", description: "End-to-end product tour", to: ROUTES.WALKTHROUGH },
    ],
  },
];

export function PublicHeader() {
  const { getAuthUrl, getDashboardUrl, isPreview } = useCrossDomainUrls();
  const authUrl = getAuthUrl();
  const dashboardUrl = getDashboardUrl();
  const { isAuthenticated } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);

  const handleEnter = (key: string) => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setOpenMenu(key);
  };
  const handleLeave = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpenMenu(null), 120);
  };

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  const AuthLink = ({ children, className }: { children: React.ReactNode; className?: string }) => {
    if (isPreview) {
      return <Link to="/auth" className={className}>{children}</Link>;
    }
    return <a href={authUrl} className={className}>{children}</a>;
  };

  // Dashboard always lives on the live console (api.trade.izenzo.co.za).
  // In preview we keep relative SPA navigation; in production we hop domains
  // so visitors on www.izenzo.co.za land on the correct authenticated host.
  const DashboardLink = ({ children, className }: { children: React.ReactNode; className?: string }) => {
    if (isPreview) {
      return <Link to="/dashboard" className={className}>{children}</Link>;
    }
    return <a href={dashboardUrl} className={className}>{children}</a>;
  };

  return (
    <>
    <nav className="fixed top-0 inset-x-0 z-40 bg-card/80 backdrop-blur-md border-b border-border transition-all duration-300">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group shrink-0">
          <div className="w-8 h-8 rounded-md flex items-center justify-center bg-emerald-950">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="text-[17px] font-semibold tracking-tight text-foreground">Izenzo</span>
        </Link>

        {/* Desktop mega-menu */}
        <div className="hidden lg:flex items-center gap-1 h-full">
          {MEGA_NAV.map((category) => (
            <div
              key={category.key}
              className="relative h-full flex items-center"
              onMouseEnter={() => handleEnter(category.key)}
              onMouseLeave={handleLeave}
            >
              <button
                className="inline-flex items-center gap-1 px-3 h-10 text-sm font-medium text-muted-foreground rounded-md hover:text-foreground hover:bg-muted transition-colors"
                aria-expanded={openMenu === category.key}
              >
                {category.label}
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform duration-200 ${openMenu === category.key ? "rotate-180" : ""}`}
                />
              </button>

              {openMenu === category.key && (
                <div
                  className="absolute left-1/2 -translate-x-1/2 top-full pt-2 z-50"
                  onMouseEnter={() => handleEnter(category.key)}
                  onMouseLeave={handleLeave}
                >
                  <div className="w-[480px] rounded-xl border border-border bg-card shadow-xl p-3 grid grid-cols-1 gap-1">
                    {category.items.map((item) => (
                      <Link
                        key={item.label}
                        to={item.to}
                        className="group flex items-start gap-3 rounded-lg p-3 hover:bg-muted transition-colors"
                        onClick={() => setOpenMenu(null)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-foreground group-hover:text-foreground">
                            {item.label}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                            {item.description}
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all mt-0.5 shrink-0" />
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Desktop CTAs */}
        <div className="hidden lg:flex items-center gap-2">
          {isAuthenticated ? (
            <DashboardLink className="inline-flex items-center gap-1.5 px-4 h-9 text-sm font-medium rounded-md text-white bg-emerald-950 shadow-sm hover:shadow transition-all">
              Dashboard
              <ArrowRight className="h-3.5 w-3.5" />
            </DashboardLink>
          ) : (
            <>
              <AuthLink className="inline-flex items-center px-3 h-9 text-sm font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Log In
              </AuthLink>
              <AuthLink className="inline-flex items-center gap-1.5 px-4 h-9 text-sm font-semibold rounded-md text-white bg-emerald-950 shadow-sm hover:shadow-md hover:bg-emerald-900 transition-all">
                Create Account
                <ArrowRight className="h-3.5 w-3.5" />
              </AuthLink>
            </>
          )}
        </div>

        {/* Mobile actions */}
        <div className="lg:hidden flex items-center gap-1.5">
          {isAuthenticated ? (
            <DashboardLink className="inline-flex items-center gap-1 px-3 h-10 min-h-[44px] text-sm font-medium rounded-md text-white bg-emerald-950">
              Dashboard
            </DashboardLink>
          ) : (
            <AuthLink className="inline-flex items-center gap-1 px-3 h-10 min-h-[44px] text-sm font-semibold rounded-md text-white bg-emerald-950">
              Log In
            </AuthLink>
          )}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        // Header is `h-20` (5rem) - the dropdown's max-height must subtract the
        // *actual* header height, not 4rem, otherwise the last item is clipped
        // below the fold on short viewports (e.g. iPhone SE landscape).
        <div className="lg:hidden border-t border-border bg-card max-h-[calc(100dvh-5rem)] overflow-y-auto">
          <div className="px-4 py-4 space-y-5">
            {MEGA_NAV.map((category) => (
              <div key={category.key}>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-1">
                  {category.label}
                </div>
                <div className="space-y-0.5">
                  {category.items.map((item) => (
                    <Link
                      key={item.label}
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                      className="block px-2 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            {!isAuthenticated && (
              <div className="pt-3 border-t border-border">
                <AuthLink className="w-full inline-flex items-center justify-center gap-1.5 px-4 h-10 text-sm font-semibold rounded-md text-white bg-emerald-950">
                  Create Account
                  <ArrowRight className="h-3.5 w-3.5" />
                </AuthLink>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
    {/* Spacer to offset the fixed header height (h-20 = 5rem) */}
    <div aria-hidden className="h-20" />
    </>
  );
}
