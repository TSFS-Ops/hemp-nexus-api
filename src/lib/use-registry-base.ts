/**
 * Batch 22 — Trade Desk shell-aware registry base path.
 *
 * Returns the route prefix that registry pages must use for their
 * internal links so that the Trading Desk shell (sidebar + layout) is
 * preserved when the user entered the registry from the Trade Desk.
 *
 *   /desk/registry/*       → "/desk/registry"
 *   anywhere else (/registry/*, public surfaces) → "/registry"
 *
 * Use this anywhere a registry page emits an internal navigation link,
 * including the no-result CTA, "open profile", "claim this company",
 * and the my-companies dashboard cross-links.
 */
import { useLocation } from "react-router-dom";

export type RegistryBase = "/desk/registry" | "/registry";

export function useRegistryBase(): RegistryBase {
  const { pathname } = useLocation();
  return pathname.startsWith("/desk/registry") ? "/desk/registry" : "/registry";
}

/**
 * Rewrite a profile_link / claim_link returned by the registry edge
 * functions (always `/registry/...`) onto the active shell base. Safe
 * to pass any string — non-`/registry/` strings are returned unchanged.
 */
export function rebaseRegistryPath(
  path: string,
  base: RegistryBase,
): string {
  if (base === "/registry") return path;
  if (path.startsWith("/registry/")) return path.replace("/registry", "/desk/registry");
  if (path === "/registry") return "/desk/registry";
  return path;
}
