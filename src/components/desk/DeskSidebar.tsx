import { Link, NavLink } from "react-router-dom";
import { Briefcase, Search, Files, ShieldCheck, Receipt, Settings, LogOut, ExternalLink, Building2, Keyboard } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ContextSwitcher } from "@/components/layout/ContextSwitcher";
import { SidebarNotificationItem } from "@/components/notifications/SidebarNotificationItem";
import { ActiveOrgIndicator } from "@/components/desk/ActiveOrgIndicator";
import { useDeskShortcuts, type DeskShortcut } from "./useDeskShortcuts";
import { DeskShortcutsDialog, Kbd } from "./DeskShortcutsDialog";

// Two-key Gmail-style shortcuts. Keys chosen so the leading "g" never
// collides with a typing target and the second key is mnemonic.
const NAV: Array<{
  to: string;
  label: string;
  icon: typeof Briefcase;
  end?: boolean;
  shortcut: string;
}> = [
  { to: "/desk", label: "Overview", icon: Briefcase, end: true, shortcut: "o" },
  { to: "/desk/discover", label: "Counterparties", icon: Search, shortcut: "c" },
  { to: "/desk/registry", label: "Company Register", icon: Building2, shortcut: "r" },
  { to: "/desk/deals", label: "My Trades", icon: Files, shortcut: "t" },
  { to: "/desk/compliance", label: "Compliance", icon: ShieldCheck, shortcut: "k" },
  { to: "/desk/billing", label: "Billing", icon: Receipt, shortcut: "b" },
  { to: "/desk/settings", label: "Settings", icon: Settings, shortcut: "s" },
];

const SHORTCUTS: DeskShortcut[] = NAV.map((n) => ({
  key: n.shortcut,
  to: n.to,
  label: n.label,
}));

export function DeskSidebar() {
  const { signOut, user } = useAuth();
  const { helpOpen, setHelpOpen } = useDeskShortcuts(SHORTCUTS);

  return (
    <aside
      aria-label="Trade Desk sidebar"
      className="hidden md:flex w-[248px] shrink-0 flex-col bg-[hsl(var(--surface-sidebar))] border-r border-border"
    >

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
      <nav aria-label="Trade Desk primary navigation" className="flex-1 px-3 pt-4">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const hint = `Shortcut: g then ${item.shortcut}`;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  title={hint}
                  className={({ isActive }) =>
                    [
                      "group relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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
                      <span className="flex-1">{item.label}</span>
                      <span
                        aria-hidden
                        data-shortcut-hint={item.shortcut}
                        className="hidden lg:inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
                      >
                        <Kbd>g</Kbd>
                        <Kbd>{item.shortcut}</Kbd>
                      </span>
                      <span className="sr-only"> ({hint})</span>
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

        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          aria-haspopup="dialog"
          className="mt-3 w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="flex items-center gap-2">
            <Keyboard className="h-3.5 w-3.5" strokeWidth={1.5} />
            Keyboard shortcuts
          </span>
          <Kbd>?</Kbd>
        </button>
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

      <DeskShortcutsDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        shortcuts={SHORTCUTS}
      />
    </aside>
  );
}
