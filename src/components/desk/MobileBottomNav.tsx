/**
 * MobileBottomNav (Desk)
 *
 * Native-app-style bottom navigation for the authenticated Desk workspace.
 * Visible only on mobile (< md). Five equal touch targets with icon-only
 * presentation, an emerald active dot indicator, and a slide-up Sheet for
 * the overflow "Menu" actions (Billing, Settings, Admin escape hatch).
 */
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import {
  LayoutDashboard,
  Search,
  FolderArchive,
  ShieldCheck,
  Menu as MenuIcon,
  Coins,
  Settings,
  Shield,
  LogOut,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";

type Item = { path: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };

const PRIMARY: Item[] = [
  { path: "/desk", label: "Desk", icon: LayoutDashboard, exact: true },
  { path: "/desk/discover", label: "Discover", icon: Search },
  { path: "/desk/deals", label: "Deals", icon: FolderArchive },
  { path: "/desk/compliance", label: "Compliance", icon: ShieldCheck },
];

export function MobileBottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isAdmin, signOut, user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (path: string, exact?: boolean) =>
    exact ? pathname === path : pathname === path || pathname.startsWith(path + "/");

  const overflow: Item[] = [
    { path: "/desk/billing", label: "Billing", icon: Coins },
    { path: "/desk/settings", label: "Settings & Identity", icon: Settings },
  ];

  return (
    <>
      <nav
        className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-card/80 backdrop-blur-md border-t border-border pb-safe"
        aria-label="Desk primary"
      >
        <div className="flex items-center justify-between px-6 h-16">
          {PRIMARY.map((item) => {
            const active = isActive(item.path, item.exact);
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className="relative flex-1 flex flex-col items-center justify-center h-full min-h-[48px]"
              >
                <Icon
                  className={`h-5 w-5 transition-colors ${
                    active ? "text-[hsl(var(--emerald))]" : "text-muted-foreground/70"
                  }`}
                  strokeWidth={active ? 2.25 : 1.75}
                />
                <span
                  className={`mt-1 h-1 w-1 rounded-full transition-opacity ${
                    active ? "bg-[hsl(var(--emerald))] opacity-100" : "opacity-0"
                  }`}
                  aria-hidden
                />
              </Link>
            );
          })}

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <button
                aria-label="More menu"
                className="relative flex-1 flex flex-col items-center justify-center h-full min-h-[48px]"
              >
                <MenuIcon
                  className={`h-5 w-5 transition-colors ${
                    menuOpen ? "text-[hsl(var(--emerald))]" : "text-muted-foreground/70"
                  }`}
                  strokeWidth={menuOpen ? 2.25 : 1.75}
                />
                <span
                  className={`mt-1 h-1 w-1 rounded-full transition-opacity ${
                    menuOpen ? "bg-[hsl(var(--emerald))] opacity-100" : "opacity-0"
                  }`}
                  aria-hidden
                />
              </button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="pb-safe rounded-t-2xl max-h-[85dvh] flex flex-col"
            >
              <SheetHeader className="shrink-0">
                <SheetTitle className="text-left">
                  <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-muted-foreground/70 block mb-1">
                    Workspace
                  </span>
                  More
                </SheetTitle>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto -mx-4 px-4 sm:-mx-6 sm:px-6">
              <div className="grid grid-cols-1 gap-2 py-4">
                {overflow.map((item) => {
                  const active = isActive(item.path);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.path}
                      onClick={() => {
                        setMenuOpen(false);
                        navigate(item.path);
                      }}
                      className={`flex items-center gap-3 p-4 rounded-md border transition-colors min-h-[56px] text-left ${
                        active
                          ? "border-[hsl(var(--emerald)/0.2)] bg-[hsl(var(--emerald-muted))] text-[hsl(var(--emerald))]"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                      <span className="text-sm font-medium">{item.label}</span>
                    </button>
                  );
                })}

                {isAdmin && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      navigate("/hq");
                    }}
                    className="flex items-center gap-3 p-4 rounded-md border border-slate-900 bg-slate-900 text-white min-h-[56px] text-left"
                  >
                    <Shield className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                    <span className="text-sm font-medium">Admin Panel</span>
                  </button>
                )}
              </div>
              </div>

              {/* Account footer - pinned, always visible so sign out is always reachable */}
              <div className="shrink-0 border-t border-border pt-4 mt-2 space-y-3">
                {user?.email && (
                  <p className="text-xs text-muted-foreground/70 font-mono tracking-wide truncate px-1">
                    {user.email}
                  </p>
                )}
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    await signOut();
                  }}
                  className="w-full flex items-center gap-3 p-4 rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors min-h-[56px] text-left"
                >
                  <LogOut className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                  <span className="text-sm font-medium">Sign out</span>
                </button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </>
  );
}
