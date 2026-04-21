import { Link, NavLink, useLocation } from "react-router-dom";
import { Briefcase, Search, Files, ShieldCheck, Receipt, Settings, LogOut, ExternalLink } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ContextSwitcher } from "@/components/layout/ContextSwitcher";
import { SidebarNotificationItem } from "@/components/notifications/SidebarNotificationItem";

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
    <aside className="hidden md:flex w-[250px] shrink-0 flex-col bg-card border-r border-border">
      {/* Wordmark */}
      <div className="px-6 pt-8 pb-4">
        <h2 className="font-mono text-xs font-medium tracking-[0.25em] text-foreground uppercase">
          Izenzo
        </h2>
        <p className="mt-1 text-[10px] tracking-wider text-muted-foreground/70 font-mono uppercase">
          Deal Desk
        </p>
      </div>

      {/* Workspace switcher (Command Bridge) */}
      <div className="px-4 pb-6">
        <ContextSwitcher tone="light" />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-4">
        <ul className="space-y-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    [
                      "flex items-center gap-3 px-4 py-3 rounded-md text-sm transition-colors",
                      isActive
                        ? "bg-muted text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted",
                    ].join(" ")
                  }
                >
                  <Icon className="h-4 w-4" strokeWidth={1.5} />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            );
          })}
          <li>
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
