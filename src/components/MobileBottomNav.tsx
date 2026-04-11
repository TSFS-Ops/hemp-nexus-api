import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Search, Handshake, BookOpen, MoreHorizontal, Settings, Building2, ShieldCheck, Coins } from "lucide-react";
import { ROUTES } from "@/lib/constants";
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const navItems = [
  { path: ROUTES.DASHBOARD, label: "Overview", icon: LayoutDashboard, exact: true },
  { path: ROUTES.DASHBOARD_SEARCH, label: "Search", icon: Search },
  { path: ROUTES.DASHBOARD_MATCHES, label: "Matches", icon: Handshake },
  { path: ROUTES.DASHBOARD_ORDER_BOOK, label: "Orders", icon: BookOpen },
];

const moreItems = [
  { path: ROUTES.DASHBOARD_SETTINGS, label: "Settings", icon: Settings },
  { path: ROUTES.DASHBOARD_ACCOUNT, label: "Organisation", icon: Building2 },
  { path: ROUTES.DASHBOARD_COMPLIANCE, label: "Compliance", icon: ShieldCheck },
  { path: ROUTES.DASHBOARD_BILLING, label: "Credits", icon: Coins },
];

/**
 * Bottom tab bar for dashboard on small screens (< md).
 * Hidden on md+ where the sidebar is visible.
 */
export function MobileBottomNav() {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return pathname === path;
    return pathname.startsWith(path);
  };

  const moreIsActive = moreItems.some((item) => isActive(item.path));

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-background/95 backdrop-blur-sm border-t border-border safe-area-bottom">
      <div className="flex items-stretch" style={{ height: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' }}>
        {navItems.map((item) => {
          const active = isActive(item.path, item.exact);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors touch-target ${
                active ? "text-primary font-medium" : "text-muted-foreground"
              }`}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {/* More button → sheet with remaining items */}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild>
            <button
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors touch-target ${
                moreIsActive ? "text-primary font-medium" : "text-muted-foreground"
              }`}
            >
              <MoreHorizontal className="h-5 w-5" />
              <span>More</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="pb-safe">
            <SheetHeader>
              <SheetTitle>More</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-2 gap-2 py-4">
              {moreItems.map((item) => {
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMoreOpen(false)}
                    className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <item.icon className="h-5 w-5" />
                    <span className="text-sm">{item.label}</span>
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
