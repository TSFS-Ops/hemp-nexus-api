import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "react-router-dom";
import { NotificationBell } from "./NotificationBell";

/**
 * GlobalAdminBell — A floating, persistent notification bell pinned to the
 * top-right of every authenticated surface for platform admins.
 *
 * Why this exists:
 *   Admins must NEVER miss an outreach opportunity (new POI engagements,
 *   stale reminders, dispute escalations). The bell previously only rendered
 *   inside DashboardLayout, which meant admins working in /hq, /desk,
 *   /governance, or /developer surfaces had no live notification channel.
 *
 * Behaviour:
 *   - Only renders for users with platform admin role (isAdmin === true).
 *   - Hidden on the public landing, /auth, /unsubscribe, marketing/docs pages
 *     — anywhere a logged-in admin shouldn't be "working".
 *   - Hidden on /dashboard/* and /billing because those pages already render
 *     the bell inline via DashboardLayout — avoids a double bell.
 *   - Fixed position so it stays in view as the admin scrolls long admin
 *     tables (Pending Engagements, Audit Logs, etc.).
 */

// Routes where the bell is suppressed (either public or already-rendered).
const SUPPRESSED_PREFIXES = [
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
  // DashboardLayout already renders an inline bell on these:
  "/dashboard",
  "/billing",
];

function isSuppressedRoute(pathname: string): boolean {
  if (pathname === "/") return true; // public landing
  return SUPPRESSED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function GlobalAdminBell() {
  const { user, isAdmin } = useAuth();
  const location = useLocation();

  if (!user || !isAdmin) return null;
  if (isSuppressedRoute(location.pathname)) return null;

  return (
    <div
      className="fixed top-3 right-3 z-[60] rounded-full bg-background/95 backdrop-blur-sm border border-border shadow-lg"
      data-testid="global-admin-bell"
    >
      <NotificationBell />
    </div>
  );
}
