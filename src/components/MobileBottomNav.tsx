/**
 * MobileBottomNav, Persona-aware bottom tab bar (< md).
 *
 * Resolves the active persona from the current route + user roles:
 *   - /governance/*  → Governor nav  (Triage / Audits / Entities / Profile)
 *   - /developer/*   → Developer nav (Keys / Webhooks / Schema / Profile)
 *   - default        → Trader nav    (Home / Search / Deals / Profile)
 *
 * Visual: pure white surface, 1px top border (dark theme on the developer
 * surface), active tab in institutional emerald (or terminal green).
 * Icons-only with micro labels, full-width touch targets (>= 48px).
 */
import { Link, useLocation } from "react-router-dom";
import { useState, useMemo } from "react";
import {
  LayoutDashboard,
  Search,
  Handshake,
  User,
  Shield,
  ClipboardCheck,
  Building2,
  Activity,
  KeyRound,
  Radio,
  Database,
  BookOpen,
  Settings,
  Coins,
  ShieldCheck,
} from "lucide-react";
import { ROUTES } from "@/lib/constants";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";

type NavItem = { path: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };
type PersonaKey = "trader" | "governor" | "developer";

const TRADER_NAV: NavItem[] = [
  { path: ROUTES.DASHBOARD, label: "Desk", icon: LayoutDashboard, exact: true },
  { path: ROUTES.DASHBOARD_SEARCH, label: "Search", icon: Search },
  { path: ROUTES.DASHBOARD_MATCHES, label: "Trades", icon: Handshake },
];

const GOVERNOR_NAV: NavItem[] = [
  { path: "/governance/triage", label: "Triage", icon: Shield },
  { path: "/governance/audits", label: "Audits", icon: ClipboardCheck },
  { path: "/governance/entities", label: "Entities", icon: Building2 },
];

const DEVELOPER_NAV: NavItem[] = [
  { path: "/developer/keys", label: "Keys", icon: KeyRound },
  { path: "/developer/webhooks", label: "Webhooks", icon: Radio },
  { path: "/developer/schema", label: "Schema", icon: Database },
];

/* Profile sheet contents per persona */
const TRADER_PROFILE: NavItem[] = [
  { path: ROUTES.DASHBOARD_ACCOUNT, label: "Organisation", icon: Building2 },
  { path: ROUTES.DASHBOARD_SETTINGS, label: "Settings", icon: Settings },
  { path: ROUTES.DASHBOARD_COMPLIANCE, label: "Compliance", icon: ShieldCheck },
  { path: ROUTES.DASHBOARD_BILLING, label: "Credits", icon: Coins },
  { path: "/governance/triage", label: "Governance Console", icon: Shield },
  { path: "/developer/keys", label: "Developer Terminal", icon: KeyRound },
];

const GOVERNOR_PROFILE: NavItem[] = [
  { path: "/governance/health", label: "System Health", icon: Activity },
  { path: ROUTES.DASHBOARD, label: "Desk", icon: LayoutDashboard },
  { path: "/developer/keys", label: "Developer Terminal", icon: KeyRound },
  { path: ROUTES.DASHBOARD_SETTINGS, label: "Settings", icon: Settings },
];

const DEVELOPER_PROFILE: NavItem[] = [
  { path: "/developer/docs", label: "Integration Docs", icon: BookOpen },
  { path: ROUTES.DASHBOARD, label: "Desk", icon: LayoutDashboard },
  { path: "/governance/triage", label: "Governance Console", icon: Shield },
  { path: ROUTES.DASHBOARD_SETTINGS, label: "Settings", icon: Settings },
];

function resolvePersona(pathname: string): PersonaKey {
  if (pathname.startsWith("/governance")) return "governor";
  if (pathname.startsWith("/developer")) return "developer";
  return "trader";
}

export function MobileBottomNav() {
  const { pathname } = useLocation();
  const { isAdmin } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);

  const persona = useMemo<PersonaKey>(() => resolvePersona(pathname), [pathname]);

  const { primary, profile, isDark } = useMemo(() => {
    if (persona === "governor")
      return { primary: GOVERNOR_NAV, profile: GOVERNOR_PROFILE, isDark: false };
    if (persona === "developer")
      return { primary: DEVELOPER_NAV, profile: DEVELOPER_PROFILE, isDark: true };
    return { primary: TRADER_NAV, profile: TRADER_PROFILE, isDark: false };
  }, [persona]);

  // Hide cross-persona shortcuts in profile sheet for users without admin rights.
  const profileItems = useMemo(() => {
    if (isAdmin) return profile;
    return profile.filter(
      (i) => !i.path.startsWith("/governance") && !i.path.startsWith("/developer"),
    );
  }, [profile, isAdmin]);

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return pathname === path;
    return pathname === path || pathname.startsWith(path + "/");
  };

  // Theme tokens
  const surface = isDark
    ? "bg-slate-950/95 border-t border-slate-800 text-slate-300"
    : "bg-white border-t border-slate-200 text-slate-600";
  const activeText = isDark ? "text-green-400" : "text-emerald-700";
  const activeBar = isDark ? "bg-green-400" : "bg-emerald-700";

  return (
    <nav
      className={`md:hidden fixed bottom-0 inset-x-0 z-40 backdrop-blur-sm safe-area-bottom ${surface}`}
      aria-label="Primary"
    >
      <div
        className="flex items-stretch"
        style={{ height: "calc(3.5rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {primary.map((item) => {
          const active = isActive(item.path, item.exact);
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`relative flex-1 flex flex-col items-center justify-center gap-1 min-h-[48px] transition-colors ${
                active ? `${activeText} font-medium` : ""
              }`}
              aria-current={active ? "page" : undefined}
            >
              {/* Active indicator hairline */}
              {active && (
                <span
                  className={`absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 ${activeBar}`}
                  aria-hidden
                />
              )}
              <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} />
              <span className="text-[10px] tracking-tight leading-none">{item.label}</span>
            </Link>
          );
        })}

        {/* Profile / More */}
        <Sheet open={profileOpen} onOpenChange={setProfileOpen}>
          <SheetTrigger asChild>
            <button
              className={`flex-1 flex flex-col items-center justify-center gap-1 min-h-[48px] transition-colors ${
                profileOpen ? activeText : ""
              }`}
              aria-label="Profile menu"
            >
              <User className="h-5 w-5" strokeWidth={1.75} />
              <span className="text-[10px] tracking-tight leading-none">Profile</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="pb-safe">
            <SheetHeader>
              <SheetTitle className="text-left">
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground block mb-1">
                  Persona · {persona}
                </span>
                Account & switching
              </SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-2 gap-2 py-4">
              {profileItems.map((item) => {
                const active = isActive(item.path);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setProfileOpen(false)}
                    className={`flex items-center gap-3 p-3 rounded-sm border transition-colors min-h-[48px] ${
                      active
                        ? "border-primary/40 bg-primary/5 text-primary font-medium"
                        : "border-border text-foreground/80 hover:bg-muted/40"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    <span className="text-sm truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
