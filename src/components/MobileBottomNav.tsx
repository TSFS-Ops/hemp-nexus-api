import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Search, Handshake, Settings } from "lucide-react";
import { ROUTES } from "@/lib/constants";

const navItems = [
  { path: ROUTES.DASHBOARD, label: "Overview", icon: LayoutDashboard, exact: true },
  { path: ROUTES.DASHBOARD_SEARCH, label: "Search", icon: Search },
  { path: ROUTES.DASHBOARD_MATCHES, label: "Matches", icon: Handshake },
  { path: ROUTES.DASHBOARD_SETTINGS, label: "Settings", icon: Settings },
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
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-background border-t border-border safe-area-bottom">
      <div className="flex items-stretch h-14">
        {navItems.map((item) => {
          const active = isActive(item.path, item.exact);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
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
