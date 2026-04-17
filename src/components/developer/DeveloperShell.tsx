import { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { KeyRound, Radio, Database, BookOpen, Terminal } from "lucide-react";

/**
 * DeveloperShell — pure dark-mode terminal environment.
 * The ONLY surface in the app that uses true dark mode.
 * Background: slate-950. Sidebar: slate-900. Mono everywhere.
 */

const NAV = [
  { to: "/developer/keys", label: "API Keys", icon: KeyRound },
  { to: "/developer/webhooks", label: "Webhook Logs", icon: Radio },
  { to: "/developer/schema", label: "Schema Explorer", icon: Database },
  { to: "/developer/docs", label: "Integration Docs", icon: BookOpen },
];

export function DeveloperShell({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-100 font-mono antialiased">
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="hidden md:flex w-60 shrink-0 flex-col bg-slate-900 border-r border-slate-800">
          {/* Brand */}
          <div className="px-5 py-5 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                izenzo / dev
              </span>
            </div>
            <div className="mt-2 text-sm text-slate-100">Command Center</div>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-3 py-4 space-y-0.5">
            {NAV.map((item) => {
              const active =
                location.pathname === item.to ||
                location.pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={[
                    "flex items-center gap-2.5 px-3 py-2 text-[13px] rounded-sm transition-colors",
                    active
                      ? "bg-slate-800 text-emerald-300 border-l-2 border-emerald-400"
                      : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border-l-2 border-transparent",
                  ].join(" ")}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span className="tracking-tight">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          {/* System status */}
          <div className="px-5 py-4 border-t border-slate-800">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                System Status
              </span>
            </div>
            <div className="mt-1.5 text-[12px] text-emerald-300">OPTIMAL</div>
            <div className="mt-0.5 text-[10px] text-slate-500">
              p99 84ms · 0 incidents
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
