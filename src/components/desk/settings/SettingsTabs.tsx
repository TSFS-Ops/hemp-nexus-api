import { NavLink } from "react-router-dom";

const TABS = [
  { to: "/desk/settings", label: "My Profile", end: true },
  { to: "/desk/settings/company", label: "Company Identity (KYB)" },
  { to: "/desk/settings/notifications", label: "Notification Rules" },
  { to: "/desk/settings/balance", label: "Credit Balance" },
  { to: "/desk/settings/security", label: "Security" },
  { to: "/desk/settings/data-export", label: "My Data" },
  { to: "/desk/settings/data-residency", label: "Data Residency" },
];

export function SettingsTabs() {
  return (
    <nav className="border-b border-border mb-8 md:mb-12 -mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto scrollbar-hide">
      <ul className="flex items-center gap-5 md:gap-10 min-w-max">
        {TABS.map((tab) => (
          <li key={tab.to}>
            <NavLink
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                [
                  "inline-block py-4 text-sm whitespace-nowrap transition-colors relative",
                  isActive
                    ? "text-foreground font-medium after:absolute after:left-0 after:right-0 after:-bottom-px after:h-0.5 after:bg-primary"
                    : "text-muted-foreground hover:text-foreground",
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
