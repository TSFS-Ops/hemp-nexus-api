/**
 * ShellBreadcrumb — persona-agnostic contextual breadcrumb.
 *
 * Renders: <Group> · <Item> · <sub-segment> · … · <leaf>
 *
 * Works for AdminShell and FunderShell. Sub-segments beyond the matched
 * nav item are humanised from the URL so nested navigation always updates
 * (e.g. `/hq/compliance/cases/CASE-123` now shows the trailing reference
 * instead of freezing on "Compliance Workbench").
 *
 * Long paths gracefully truncate: on narrow viewports we collapse middle
 * segments to an ellipsis while keeping the group, item, and leaf visible.
 * The leaf itself uses CSS truncation so a single very long token can never
 * push the header off screen.
 */
import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { ShellNavGroup, ShellNavItem } from "./shell-nav";

interface ShellBreadcrumbProps {
  nav: ShellNavGroup[];
  /** Optional override, defaults to current location. */
  pathname?: string;
}

function isItemActive(pathname: string, item: ShellNavItem): boolean {
  if (item.match === "exact") return pathname === item.to || pathname === `${item.to}/`;
  return (
    pathname === item.to ||
    pathname.startsWith(`${item.to}/`) ||
    pathname.startsWith(`${item.to}?`)
  );
}

function humaniseSegment(seg: string): string {
  try {
    seg = decodeURIComponent(seg);
  } catch {
    /* keep raw */
  }
  // Preserve identifier-looking tokens (case refs, UUIDs, numeric ids) as-is.
  if (/^[A-Z0-9][A-Z0-9._-]{2,}$/.test(seg)) return seg;
  if (/^\d+$/.test(seg)) return seg;
  return seg
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Crumb {
  label: string;
  href?: string;
  isLeaf?: boolean;
}

function buildCrumbs(nav: ShellNavGroup[], pathname: string): Crumb[] {
  for (const group of nav) {
    for (const item of group.items) {
      if (!isItemActive(pathname, item)) continue;
      const crumbs: Crumb[] = [
        { label: group.label },
        { label: item.label, href: item.to },
      ];
      const suffix = pathname.slice(item.to.length).replace(/^\/+|\/+$/g, "");
      if (suffix) {
        const parts = suffix.split("/").filter(Boolean);
        let acc = item.to;
        parts.forEach((p, i) => {
          acc = `${acc}/${p}`;
          crumbs.push({
            label: humaniseSegment(p),
            href: i < parts.length - 1 ? acc : undefined,
            isLeaf: i === parts.length - 1,
          });
        });
      } else {
        crumbs[crumbs.length - 1].isLeaf = true;
        crumbs[crumbs.length - 1].href = undefined;
      }
      return crumbs;
    }
  }
  return [];
}

/** Collapse middle crumbs to a single ellipsis when there are too many for
 *  the available width. Keeps group, item, and leaf visible. */
function collapseCrumbs(crumbs: Crumb[], maxVisible: number): Crumb[] {
  if (crumbs.length <= maxVisible) return crumbs;
  const first = crumbs[0];
  const last = crumbs[crumbs.length - 1];
  const keptTail = crumbs.slice(-Math.max(1, maxVisible - 2));
  return [first, { label: "…" }, ...keptTail.filter((c) => c !== first)];
}

export function ShellBreadcrumb({ nav, pathname }: ShellBreadcrumbProps) {
  const location = useLocation();
  const path = pathname ?? location.pathname;
  const crumbs = buildCrumbs(nav, path);
  if (crumbs.length === 0) return null;

  // Desktop shows up to 6 crumbs; medium shows 4; small screens fall back to
  // just the leaf (parent chrome shown separately by the shell).
  const desktop = collapseCrumbs(crumbs, 6);
  const compact = collapseCrumbs(crumbs, 4);
  const leaf = crumbs[crumbs.length - 1];

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center text-xs text-muted-foreground"
    >
      {/* Desktop (lg+): full path */}
      <ol className="hidden lg:flex min-w-0 items-center gap-1">
        {desktop.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden />}
            <CrumbLabel crumb={c} isLast={i === desktop.length - 1} />
          </li>
        ))}
      </ol>
      {/* Tablet (md–lg): collapsed */}
      <ol className="hidden md:flex lg:hidden min-w-0 items-center gap-1">
        {compact.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden />}
            <CrumbLabel crumb={c} isLast={i === compact.length - 1} />
          </li>
        ))}
      </ol>
      {/* Small: leaf only, truncated */}
      <div className="md:hidden min-w-0 flex-1">
        <span className="block truncate text-foreground/80">{leaf.label}</span>
      </div>
    </nav>
  );
}

function CrumbLabel({ crumb, isLast }: { crumb: Crumb; isLast: boolean }) {
  const base = "truncate max-w-[10rem]";
  if (isLast || !crumb.href) {
    return (
      <span
        className={`${base} ${isLast ? "text-foreground/90 font-medium" : ""}`}
        aria-current={isLast ? "page" : undefined}
        title={crumb.label}
      >
        {crumb.label}
      </span>
    );
  }
  return (
    <Link
      to={crumb.href}
      className={`${base} hover:text-foreground transition-colors`}
      title={crumb.label}
    >
      {crumb.label}
    </Link>
  );
}

export default ShellBreadcrumb;
