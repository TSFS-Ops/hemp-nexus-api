import { NavLink } from "react-router-dom";

const TABS = [
  { to: "/desk/settings", label: "My Profile", end: true },
  { to: "/desk/settings/company", label: "Company Identity (KYB)" },
  { to: "/desk/settings/notifications", label: "Notification Rules" },
  { to: "/desk/settings/balance", label: "Token Balance" },
];

export function SettingsTabs() {
  return (
    <nav className="border-b border-slate-200 mb-12">
      <ul className="flex items-center gap-10">
        {TABS.map((tab) => (
          <li key={tab.to}>
            <NavLink
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                [
                  "inline-block py-4 text-sm transition-colors relative",
                  isActive
                    ? "text-slate-900 font-medium after:absolute after:left-0 after:right-0 after:-bottom-px after:h-0.5 after:bg-primary"
                    : "text-slate-500 hover:text-slate-900",
                ].join(" ")
              }
            >
              {tab.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
