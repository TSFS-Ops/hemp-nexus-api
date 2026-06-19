import { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { KeyRound, Radio, Database, BookOpen, Terminal, Settings, LogOut, BarChart3 } from "lucide-react";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { useAuth } from "@/contexts/AuthContext";
import { ContextSwitcher } from "@/components/layout/ContextSwitcher";
import { SidebarNotificationItem } from "@/components/notifications/SidebarNotificationItem";

/**
 * DeveloperShell, pure dark-mode terminal environment.
 * The ONLY surface in the app that uses true dark mode.
 * Background: slate-950. Sidebar: slate-900. Inter for nav, JetBrains Mono for data.
 */

const NAV = [{
  to: "/developer/keys",
  label: "API Keys",
  icon: KeyRound
}, {
  to: "/developer/usage",
  label: "API Usage",
  icon: BarChart3
}, {
  to: "/developer/webhooks",
  label: "Webhook Logs",
  icon: Radio
}, {
  to: "/developer/schema",
  label: "Schema Explorer",
  icon: Database
}, {
  to: "/developer/docs",
  label: "Integration Docs",
  icon: BookOpen
}];

export function DeveloperShell({
  children
}: {
  children: ReactNode;
}) {
  const location = useLocation();
  const {
    user,
    signOut
  } = useAuth();
  const devId = user?.id ? `DEV-${user.id.replace(/-/g, "").slice(-8).toUpperCase()}` : "DEV-PENDING";
  return <div className="min-h-screen w-full bg-slate-950 text-slate-100 antialiased" style={{
    fontFamily: "Inter, sans-serif"
  }}>
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="hidden md:flex w-60 shrink-0 flex-col bg-slate-900 border-r border-slate-800">
          {/* Brand */}
          <div className="px-5 py-5 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-green-500" strokeWidth={1.5} />
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">
                izenzo / dev
              </span>
            </div>
            <div className="mt-2 text-sm text-slate-100">Command Centre</div>
          </div>

          {/* Workspace switcher (Command Bridge) */}
          <div className="px-3 py-3 border-b border-slate-800">
            <ContextSwitcher tone="dark" />
          </div>

          {/* Nav */}
          <nav className="flex-1 px-3 py-4 space-y-0.5">
            {NAV.map(item => {
            const active = location.pathname === item.to || location.pathname.startsWith(item.to + "/");
            const Icon = item.icon;
            return <NavLink key={item.to} to={item.to} className={["flex items-center gap-2.5 px-3 py-2 text-[13px] rounded-sm transition-colors", active ? "bg-slate-800 text-green-400 border-l-2 border-green-500" : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border-l-2 border-transparent"].join(" ")}>
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span className="tracking-tight">{item.label}</span>
                </NavLink>;
          })}
            <SidebarNotificationItem tone="dark" />
          </nav>

          {/* System status, pulsing green LED */}
          <div className="px-5 py-4 border-t border-slate-800">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-green-400">
                SYSTEM_STATUS: OPTIMAL
              </span>
            </div>
            <div className="mt-1.5 font-mono text-[10px] text-slate-400">
              p99 84ms · 0 incidents · 99.992%
            </div>
          </div>

          {/* Identity & exit */}
          <div className="px-5 py-4 border-t border-slate-800 space-y-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">Operator</p>
              <p className="font-mono text-[11px] text-slate-200 tracking-wider">{devId}</p>
              <p className="font-mono text-[10px] text-slate-500 truncate mt-0.5">{user?.email}</p>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <NavLink to="/dashboard/settings" className="flex items-center gap-1.5 font-mono text-[11px] text-slate-400 hover:text-slate-100 transition-colors">
                <Settings className="h-3 w-3" strokeWidth={1.5} />
                Settings
              </NavLink>
              <span className="text-slate-700">·</span>
              <button onClick={signOut} className="flex items-center gap-1.5 font-mono text-[11px] text-slate-400 hover:text-red-400 transition-colors">
                <LogOut className="h-3 w-3" strokeWidth={1.5} />
                Sign out
              </button>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 pb-16 md:pb-0">{children}</main>
      </div>
      <MobileBottomNav />
    </div>;
}