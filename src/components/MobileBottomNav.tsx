import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Search, Handshake, BookOpen, MoreHorizontal } from "lucide-react";
import { ROUTES } from "@/lib/constants";
import { useState } from "react";
import { Settings, Building2, ShieldCheck, Coins } from "lucide-react";
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
  { path: ROUTES.BILLING, label: "Credits", icon: Coins },
];

/**
 * Bottom tab bar for dashboard on small screens (< md).
 * Hidden on md+ where the sidebar is visible.
 */
export function MobileBottomNav() {
  const { pathname } = useLocation();

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return pathname === path;
    return pathname.startsWith(path);
  };

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
                active
                  ? "text-primary font-medium"
                  : "text-muted-foreground"
              }`}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
