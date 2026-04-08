import { Link, useLocation } from "react-router-dom";
import { Activity, GitCompare, Scale, Shield, MoreHorizontal, Users, Building2, Key, Webhook, Terminal, Database, Settings, Wrench, BookOpen, Blocks } from "lucide-react";
import { ROUTES } from "@/lib/constants";
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const primaryItems = [
  { path: ROUTES.ADMIN, label: "Overview", icon: Activity, exact: true },
  { path: ROUTES.ADMIN_DEALS, label: "Deals", icon: GitCompare },
  { path: ROUTES.ADMIN_COMPLIANCE, label: "Compliance", icon: Scale },
  { path: ROUTES.ADMIN_AUDIT, label: "Audit", icon: Shield },
];

const moreGroups = [
  {
    label: "OPERATIONS",
    items: [
      { path: ROUTES.ADMIN_ORDER_BOOK, label: "Order Book", icon: BookOpen },
      { path: ROUTES.ADMIN_LEDGER, label: "Evidence Ledger", icon: Blocks },
    ],
  },
  {
    label: "ENTITIES",
    items: [
      { path: ROUTES.ADMIN_USERS, label: "Users", icon: Users },
      { path: ROUTES.ADMIN_ORGS, label: "Organisations", icon: Building2 },
    ],
  },
  {
    label: "DEVELOPER",
    items: [
      { path: ROUTES.ADMIN_API_KEYS, label: "API Keys", icon: Key },
      { path: ROUTES.ADMIN_WEBHOOKS, label: "Webhooks", icon: Webhook },
      { path: ROUTES.ADMIN_SYSTEM_LOGS, label: "System Logs", icon: Terminal },
    ],
  },
  {
    label: "GOVERNANCE",
    items: [
      { path: ROUTES.ADMIN_DATA_GOVERNANCE, label: "Data Retention", icon: Database },
      { path: ROUTES.ADMIN_SETTINGS, label: "Policy Settings", icon: Settings },
      { path: ROUTES.ADMIN_OVERRIDES, label: "Overrides", icon: Wrench },
    ],
  },
];

const allMorePaths = moreGroups.flatMap(g => g.items.map(i => i.path));

export function AdminMobileNav() {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return pathname === path;
    return pathname.startsWith(path);
  };

  const moreIsActive = allMorePaths.some((p) => isActive(p));

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
          <SheetContent side="bottom" className="pb-safe max-h-[80vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Admin Sections</SheetTitle>
            </SheetHeader>
            <div className="py-4 space-y-4">
              {moreGroups.map((group) => (
                <div key={group.label}>
                  <p className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground/70 uppercase px-1 mb-1.5">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {group.items.map((item) => {
                      const active = isActive(item.path);
                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          onClick={() => setMoreOpen(false)}
                          className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                            active
                              ? "bg-foreground/10 text-foreground font-medium"
                              : "text-muted-foreground hover:bg-muted/50"
                          }`}
                        >
                          <item.icon className="h-4 w-4" />
                          <span className="text-sm">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
