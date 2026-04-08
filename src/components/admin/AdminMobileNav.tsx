import { Link, useLocation } from "react-router-dom";
import { Activity, GitCompare, Users, Scale, Shield, MoreHorizontal, Server, Database, Key, Wrench, Settings } from "lucide-react";
import { ROUTES } from "@/lib/constants";
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const primaryItems = [
  { path: ROUTES.ADMIN, label: "Overview", icon: Activity, exact: true },
  { path: ROUTES.ADMIN_DEALS, label: "Deals", icon: GitCompare },
  { path: ROUTES.ADMIN_USERS_ORGS, label: "Users", icon: Users },
  { path: ROUTES.ADMIN_COMPLIANCE, label: "Compliance", icon: Scale },
];

const moreItems = [
  { path: ROUTES.ADMIN_AUDIT, label: "Audit", icon: Shield },
  { path: ROUTES.ADMIN_INFRASTRUCTURE, label: "Infrastructure", icon: Server },
  { path: ROUTES.ADMIN_DATA_GOVERNANCE, label: "Data Governance", icon: Database },
  { path: ROUTES.ADMIN_API_KEYS, label: "API Keys", icon: Key },
  { path: ROUTES.ADMIN_OVERRIDES, label: "Overrides", icon: Wrench },
  { path: ROUTES.ADMIN_SETTINGS, label: "Settings", icon: Settings },
];

export function AdminMobileNav() {
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
        {primaryItems.map((item) => {
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
              <SheetTitle>Admin Sections</SheetTitle>
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
