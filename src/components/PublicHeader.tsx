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
      { label: "Audit Ledger", description: "Immutable, cryptographically sealed deal records", to: "/products/audit-ledger" },
    ],
  },
  {
    key: "solutions",
    label: "Solutions",
    items: [
      { label: "Commodity Traders & Corporates", description: "Execute cross-border deals with verified counterparties.", to: "/solutions/traders" },
      { label: "Trade Finance & Insurance", description: "De-risk letters of credit with cryptographically sealed proof.", to: "/solutions/finance" },
      { label: "Sovereigns & PDBs", description: "Govern institutional trade programmes at scale.", to: "/solutions/sovereigns" },
    ],
  },
  {
    key: "developers",
    label: "Developers",
    items: [
      { label: "Documentation", description: "Guides, concepts & quickstarts", to: "/developers" },
      { label: "API Reference", description: "Full endpoint specification", to: "/developers" },
      { label: "SDKs & Libraries", description: "TypeScript SDK, code samples & client libs", to: "/developers" },
      { label: "System Status", description: "Live platform health & uptime", to: "/developers" },
    ],
  },
  {
    key: "resources",
    label: "Resources",
    items: [
      { label: "Pricing", description: "Token economics & plan tiers", to: ROUTES.PRICING },
      { label: "Platform Walkthrough", description: "End-to-end product tour", to: ROUTES.WALKTHROUGH },
      { label: "Case Studies", description: "Outcomes from live programmes", to: ROUTES.DOCS },
    ],
  },
];

export function PublicHeader() {
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  const authUrl = getAuthUrl();
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

  return (
    <nav
      className="sticky top-0 z-50 bg-white border-b border-slate-200"
      style={{ fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}
    >
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
          <span className="text-[17px] font-semibold tracking-tight text-slate-900">Izenzo</span>
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
                className="inline-flex items-center gap-1 px-3 h-10 text-sm font-medium text-slate-700 rounded-md hover:text-slate-900 hover:bg-slate-50 transition-colors"
                aria-expanded={openMenu === category.key}
              >
                {category.label}
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform duration-200 ${openMenu === category.key ? "rotate-180" : ""}`}
                />
              </button>

              {openMenu === category.key && (
                <div
                  className="absolute left-1/2 -translate-x-1/2 top-full pt-2"
                  onMouseEnter={() => handleEnter(category.key)}
                  onMouseLeave={handleLeave}
                >
                  <div className="w-[480px] rounded-xl border border-slate-200 bg-white shadow-xl p-3 grid grid-cols-1 gap-1">
                    {category.items.map((item) => (
                      <Link
                        key={item.label}
                        to={item.to}
                        className="group flex items-start gap-3 rounded-lg p-3 hover:bg-slate-50 transition-colors"
                        onClick={() => setOpenMenu(null)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-slate-900 group-hover:text-slate-950">
                            {item.label}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                            {item.description}
                          </div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-slate-700 group-hover:translate-x-0.5 transition-all mt-0.5 shrink-0" />
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
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 px-4 h-9 text-sm font-medium rounded-md text-white bg-emerald-950 shadow-sm hover:shadow transition-all"
            >
              Dashboard
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <>
              <AuthLink className="inline-flex items-center px-3 h-9 text-sm font-medium rounded-md text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition-colors">
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
        <div className="lg:hidden flex items-center gap-2">
          {isAuthenticated ? (
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1 px-3 h-9 text-sm font-medium rounded-md text-white bg-emerald-950"
            >
              Dashboard
            </Link>
          ) : (
            <AuthLink className="inline-flex items-center gap-1 px-3 h-9 text-sm font-semibold rounded-md text-white bg-emerald-950">
              Log In
            </AuthLink>
          )}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 rounded-md text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-slate-200 bg-white max-h-[calc(100vh-4rem)] overflow-y-auto">
          <div className="px-4 py-4 space-y-5">
            {MEGA_NAV.map((category) => (
              <div key={category.key}>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 px-2 mb-1">
                  {category.label}
                </div>
                <div className="space-y-0.5">
                  {category.items.map((item) => (
                    <Link
                      key={item.label}
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                      className="block px-2 py-2 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            {!isAuthenticated && (
              <div className="pt-3 border-t border-slate-200">
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
  );
}
