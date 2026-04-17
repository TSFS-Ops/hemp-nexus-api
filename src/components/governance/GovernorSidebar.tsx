/**
 * GovernorSidebar, dedicated navigation rail for the Governance persona.
 * Izenzo aesthetic: white surface, hairline borders, JetBrains Mono
 * for IDs and certification status. Footer carries the Governor's official ID
 * and certification grade so it reads like an institutional control room.
 */

import { Link, NavLink } from "react-router-dom";
import { Inbox, FileSearch, ShieldCheck, Activity, Settings, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ContextSwitcher } from "@/components/layout/ContextSwitcher";

const NAV = [
  { to: "/governance/triage", label: "Triage Queue", icon: Inbox, end: true },
  { to: "/governance/audits", label: "Active Audits", icon: FileSearch },
  { to: "/governance/entities", label: "Entity Verification", icon: ShieldCheck },
  { to: "/governance/health", label: "System Health", icon: Activity },
];

export function GovernorSidebar() {
  const { signOut, user } = useAuth();

  // Deterministic Governor identifier derived from the user id (last 8 chars).
  const officialId = user?.id
    ? `GOV-${user.id.replace(/-/g, "").slice(-8).toUpperCase()}`
    : "GOV-PENDING";

  return (
    <aside className="hidden md:flex w-[260px] shrink-0 flex-col bg-white border-r border-slate-200">
      {/* Wordmark */}
      <div className="px-6 pt-8 pb-4">
        <h2 className="font-mono text-xs font-medium tracking-[0.25em] text-slate-900 uppercase">
          Izenzo
        </h2>
        <p className="mt-1 text-[10px] tracking-[0.2em] text-slate-400 font-mono uppercase">
          Governance Console
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
                        ? "bg-slate-50 text-slate-900 font-medium"
                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-50",
                    ].join(" ")
                  }
                >
                  <Icon className="h-4 w-4" strokeWidth={1.5} />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Governor identity & certification footer */}
      <div className="px-6 py-6 border-t border-slate-200 space-y-4">
        <div>
          <p className="text-[10px] tracking-[0.25em] uppercase text-slate-400 font-mono mb-1.5">
            Officer ID
          </p>
          <p className="text-xs text-slate-900 font-mono tracking-wider">
            {officialId}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500 font-mono truncate">
            {user?.email}
          </p>
        </div>

        <div>
          <p className="text-[10px] tracking-[0.25em] uppercase text-slate-400 font-mono mb-1.5">
            Certification
          </p>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden />
            <p className="text-[11px] text-slate-700 font-mono tracking-wide">
              FATF · Tier II · Active
            </p>
          </div>
          <p className="mt-1 text-[10px] text-slate-400 font-mono">
            Expires 2027-03-31
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Link
            to="/dashboard/settings"
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 transition-colors"
          >
            <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
            Settings
          </Link>
          <span className="text-slate-300">·</span>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}