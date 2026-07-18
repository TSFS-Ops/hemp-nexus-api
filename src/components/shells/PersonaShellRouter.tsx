/**
 * PersonaShellRouter — pathname-driven persona shell selector.
 *
 * Wraps <Routes> so the correct chrome (admin sidebar / funder sidebar /
 * bare) is chosen from the URL. Because the shell tree is stable while the
 * user stays inside a persona, the sidebar and top bar do not remount as
 * they navigate — only the page content changes. Crossing personas (rare)
 * naturally remounts the chrome, which is desirable and cheap.
 *
 * Public, unauthenticated and customer-facing (/desk/*) routes render
 * without a shell here; /desk/* still provides its own DeskLayout inside
 * the Desk router, which is intentionally different chrome for customers.
 */
import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { AdminShell } from "./AdminShell";
import { FunderShell } from "./FunderShell";

const ADMIN_PATH_PREFIXES = ["/hq", "/admin"];
const FUNDER_PATH_PREFIXES = ["/funder"];

function matchesAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function PersonaShellRouter({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  if (matchesAny(pathname, ADMIN_PATH_PREFIXES)) {
    return <AdminShell>{children}</AdminShell>;
  }
  if (matchesAny(pathname, FUNDER_PATH_PREFIXES)) {
    return <FunderShell>{children}</FunderShell>;
  }
  return <>{children}</>;
}

export default PersonaShellRouter;
