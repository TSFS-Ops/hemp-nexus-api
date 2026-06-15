import { Link, NavLink } from "react-router-dom";
import { Briefcase, Search, Files, ShieldCheck, Receipt, Settings, LogOut, ExternalLink } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ContextSwitcher } from "@/components/layout/ContextSwitcher";
import { SidebarNotificationItem } from "@/components/notifications/SidebarNotificationItem";
import { ActiveOrgIndicator } from "@/components/desk/ActiveOrgIndicator";

const NAV = [
  { to: "/desk", label: "Overview", icon: Briefcase, end: true },
  { to: "/desk/discover", label: "Find Counterparties", icon: Search },
  { to: "/desk/deals", label: "My Trades", icon: Files },
  { to: "/desk/compliance", label: "Compliance", icon: ShieldCheck },
  { to: "/desk/billing", label: "Billing", icon: Receipt },
  { to: "/desk/settings", label: "Settings", icon: Settings },
];

export function DeskSidebar() {
  const { signOut, user } = useAuth();

  return (
    <aside className="hidden md:flex w-[248px] shrink-0 flex-col bg-[hsl(var(--surface-sidebar))] border-r border-border">
      {/* Wordmark */}
      <div className="px-5 pt-6 pb-5">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Izenzo
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Trade Desk
        </p>
      </div>

      {/* Workspace switcher */}
      <div className="px-4 pb-3">
        <ContextSwitcher tone="light" />
      </div>

      {/* Active org */}
      <div className="px-4 pb-4 border-b border-border/60">
        <ActiveOrgIndicator />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 pt-4">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    [
                      "relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                      isActive
                        ? "bg-card text-foreground font-medium border border-border/60"
                        : "text-muted-foreground hover:text-foreground hover:bg-card/60",
                    ].join(" ")
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span
                          aria-hidden
                          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-primary"
                        />
                      )}
                      <Icon
                        className={`h-4 w-4 ${isActive ? "text-primary" : ""}`}
                        strokeWidth={isActive ? 2 : 1.5}
                      />
                      <span>{item.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
          <li className="pt-1">
            <SidebarNotificationItem tone="light" />
          </li>
        </ul>
      </nav>

      {/* User footer */}
      <div className="px-5 py-5 border-t border-border space-y-2.5">
        <p className="text-xs text-muted-foreground truncate">
          {user?.email}
        </p>

        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
          View public site
        </a>

        <div className="flex items-center gap-3">
          <Link
            to="/desk/settings"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
            Settings
          </Link>
          <span className="text-muted-foreground/50">·</span>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
