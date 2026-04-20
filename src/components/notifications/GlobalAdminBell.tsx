import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "react-router-dom";
import { NotificationBell } from "./NotificationBell";

/**
 * GlobalAdminBell — A small, unobtrusive notification affordance for platform
 * admins on surfaces that don't already render a bell inline.
 *
 * Design intent:
 *   - Sits flush in the top-right, sized to match a normal icon button.
 *   - No heavy chrome — uses the app's neutral muted palette so it disappears
 *     into any header (light or dark) until it has unread items.
 *   - Suppressed on every layout that already mounts NotificationBell inline
 *     (Dashboard, Billing, HQ admin header, Desk, Governance, Developer).
 *     This avoids the "double bell" we previously had.
 */

// Routes where the bell is suppressed:
//   - public marketing / auth surfaces (admin shouldn't be "working" there)
//   - layouts that already render an inline NotificationBell in their header
const SUPPRESSED_PREFIXES = [
  // Public / auth
  "/auth",
  "/reset-password",
  "/welcome",
  "/unsubscribe",
  "/landing",
  "/pricing",
  "/products",
  "/solutions",
  "/docs",
  "/developers",
  "/status",
  "/walkthrough-report",
  // Layouts that already render an inline bell:
  "/dashboard",
  "/billing",
  "/hq",
];

function isSuppressedRoute(pathname: string): boolean {
  if (pathname === "/") return true;
  return SUPPRESSED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function GlobalAdminBell() {
  const { user, isAdmin } = useAuth();
  const location = useLocation();

  if (!user || !isAdmin) return null;
  if (isSuppressedRoute(location.pathname)) return null;

  return (
    <div
      className="fixed top-2 right-2 z-50"
      data-testid="global-admin-bell"
    >
      <NotificationBell />
    </div>
  );
}
