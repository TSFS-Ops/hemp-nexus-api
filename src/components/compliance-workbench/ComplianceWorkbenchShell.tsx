import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ClipboardList,
  Gavel,
  LayoutGrid,
  ListChecks,
  MessageCircleWarning,
  ShieldAlert,
  Signpost,
  Undo2,
  UserRound,
  PieChart,
  AlertOctagon,
  RefreshCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AdapterModeBanner } from "./AdapterModeBanner";

const NAV = [
  { to: "/hq/compliance", exact: true, label: "Overview", icon: LayoutGrid },
  { to: "/hq/compliance/queue", label: "Case Queue", icon: ListChecks },
  { to: "/hq/compliance/my", label: "My Cases", icon: UserRound },
  { to: "/hq/compliance/unassigned", label: "Unassigned", icon: Signpost },
  { to: "/hq/compliance/approvals", label: "Pending Approvals", icon: Gavel },
  { to: "/hq/compliance/holds", label: "Active Holds", icon: ShieldAlert },
  { to: "/hq/compliance/rfis", label: "Overdue RFIs", icon: MessageCircleWarning },
  { to: "/hq/compliance/provider-exceptions", label: "Provider Exceptions", icon: AlertOctagon },
  { to: "/hq/compliance/periodic-reviews", label: "Periodic Reviews", icon: RefreshCcw },
  { to: "/hq/compliance/appeals", label: "Appeals", icon: Undo2 },
  { to: "/hq/compliance/reports", label: "Reports", icon: PieChart },
];

export function ComplianceWorkbenchShell() {
  const { pathname } = useLocation();
  return (
    <DashboardLayout>
      <div className="space-y-4">
        <header className="rounded-md border border-border bg-card">
          <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-5">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Izenzo · Enterprise Compliance
              </div>
              <h1 className="text-lg font-semibold text-foreground">
                Compliance Case Management Workbench
              </h1>
            </div>
            <Link
              to="/hq"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              ← Back to HQ
            </Link>
          </div>
          <nav aria-label="Compliance workbench sections" className="border-t border-border">
            <ul className="flex gap-1 overflow-x-auto px-2 md:px-4">
              {NAV.map((item) => {
                const active = item.exact
                  ? pathname === item.to || pathname === `${item.to}/`
                  : pathname.startsWith(item.to);
                return (
                  <li key={item.to} className="shrink-0">
                    <NavLink
                      to={item.to}
                      end={item.exact}
                      className={cn(
                        "inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                        active
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-3.5 w-3.5" />
                      {item.label}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </nav>
        </header>

        <AdapterModeBanner />
        <Outlet />
      </div>
    </DashboardLayout>
  );
}

export { ClipboardList };
