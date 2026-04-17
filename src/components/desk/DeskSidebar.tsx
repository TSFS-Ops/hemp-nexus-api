import { Link, NavLink, useLocation } from "react-router-dom";
import { Briefcase, Search, Files, ShieldCheck, Receipt, Settings, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

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
    <aside className="hidden md:flex w-[250px] shrink-0 flex-col bg-white border-r border-slate-200">
      {/* Wordmark */}
      <div className="px-8 pt-10 pb-12">
        <h2 className="font-mono text-xs font-medium tracking-[0.25em] text-slate-900 uppercase">
          Izenzo
        </h2>
        <p className="mt-1 text-[10px] tracking-wider text-slate-400 font-mono uppercase">
          Deal Desk
        </p>
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

      {/* User footer */}
      <div className="px-6 py-6 border-t border-slate-200">
        <p className="text-xs text-slate-400 font-mono tracking-wide truncate mb-3">
          {user?.email}
        </p>
        <button
          onClick={signOut}
          className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-900 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
