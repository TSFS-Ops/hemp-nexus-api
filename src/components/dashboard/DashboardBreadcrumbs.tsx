import { useLocation, Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { ROUTES } from "@/lib/constants";

const ROUTE_LABELS: Record<string, string> = {
  [ROUTES.DASHBOARD]: "Desk",
  [ROUTES.DASHBOARD_SEARCH]: "Search",
  [ROUTES.DASHBOARD_ORDER_BOOK]: "Order Book",
  [ROUTES.DASHBOARD_MATCHES]: "Trade Requests",
  [ROUTES.DASHBOARD_SETTINGS]: "Settings",
  [ROUTES.DASHBOARD_ACCOUNT]: "Organisation",
  [ROUTES.DASHBOARD_COMPLIANCE]: "Compliance",
  [ROUTES.DASHBOARD_PROGRAMMES]: "Programmes",
  "/dashboard/billing": "Credits",
};

export function DashboardBreadcrumbs() {
  const { pathname } = useLocation();

  // Don't show on the overview page itself
  if (pathname === ROUTES.DASHBOARD) return null;

  // Find the best matching label
  const matchedRoute = Object.keys(ROUTE_LABELS)
    .filter((r) => pathname.startsWith(r) && r !== ROUTES.DASHBOARD)
    .sort((a, b) => b.length - a.length)[0];

  if (!matchedRoute) return null;

  const label = ROUTE_LABELS[matchedRoute];

  // For match details: /dashboard/matches/:id
  const isMatchDetail = pathname.startsWith(ROUTES.DASHBOARD_MATCHES + "/") && pathname !== ROUTES.DASHBOARD_MATCHES;

  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground mb-3 min-w-0">
      <Link to={ROUTES.DASHBOARD} className="flex items-center gap-1 hover:text-foreground transition-colors">
        <Home className="h-3 w-3" />
        <span>Console</span>
      </Link>
      <ChevronRight className="h-3 w-3" />
      {isMatchDetail ? (
        <>
          <Link to={ROUTES.DASHBOARD_MATCHES} className="hover:text-foreground transition-colors">
            Matches
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground font-medium">Details</span>
        </>
      ) : (
        <span className="text-foreground font-medium">{label}</span>
      )}
    </nav>
  );
}
