import { Link, NavLink, useLocation } from "react-router-dom";
import { Briefcase, Search, Files, ShieldCheck, Receipt, Settings, LogOut, ExternalLink } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ContextSwitcher } from "@/components/layout/ContextSwitcher";
import { SidebarNotificationItem } from "@/components/notifications/SidebarNotificationItem";
import { ActiveOrgIndicator } from "@/components/desk/ActiveOrgIndicator";

const NAV = [
  { to: "/desk", label: "Desk", icon: Briefcase, end: true },
  { to: "/desk/discover", label: "Discover Counterparties", icon: Search },
  { to: "/desk/deals", label: "My Deals", icon: Files },
  { to: "/desk/compliance", label: "Compliance Profile", icon: ShieldCheck },
  { to: "/desk/billing", label: "Billing", icon: Receipt },
  { to: "/desk/settings", label: "Settings & Identity", icon: Settings },
];

export function DeskSidebar() {
  const { signOut, user } = useAuth();
  const location = useLocation();

  return (
    <aside className="hidden md:flex w-[260px] shrink-0 flex-col bg-[hsl(var(--surface-sidebar))] border-r border-border shadow-sm">
      {/* Wordmark */}
      <div className="px-6 pt-7 pb-5 border-b border-border/60">
        <h2 className="font-mono text-xs font-medium tracking-[0.25em] text-foreground uppercase">
          Izenzo
        </h2>
        <p className="mt-1 text-[10px] tracking-wider text-muted-foreground/70 font-mono uppercase">
          Deal Desk
        </p>
      </div>

      {/* Workspace switcher (Command Bridge) - interactive surface */}
      <div className="px-4 pt-4 pb-2">
        <p className="px-1 mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">
          Workspace
        </p>
        <ContextSwitcher tone="light" />
      </div>

      {/* Active org indicator - passive identity badge */}
      <div className="px-4 pt-3 pb-4">
        <p className="px-1 mb-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">
          Acting as
        </p>
        <ActiveOrgIndicator />
      </div>

      {/* Section divider */}
      <div className="mx-4 border-t border-border/60" />

      {/* Nav */}
      <nav className="flex-1 px-3 pt-4">
        <p className="px-3 mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/60">
          Navigation
        </p>
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
                      "relative flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-150",
                      isActive
                        ? "bg-card text-foreground font-medium shadow-sm border border-border/60"
                        : "text-muted-foreground hover:text-foreground hover:bg-card/60",
                    ].join(" ")
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span
                          aria-hidden
                          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-primary"
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
      <div className="px-6 py-6 border-t border-border space-y-3">
        <p className="text-xs text-muted-foreground/70 font-mono tracking-wide truncate">
          {user?.email}
        </p>

        {/* Quick escape, public marketing site */}
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-[hsl(var(--emerald))] transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
          View Public Site
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
