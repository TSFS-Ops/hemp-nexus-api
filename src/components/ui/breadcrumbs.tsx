import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

/**
 * Lightweight breadcrumb trail for deep drill-down areas.
 */
export function Breadcrumbs({ items, className = "" }: BreadcrumbsProps) {
  if (items.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className={`flex items-center gap-1 text-sm text-muted-foreground ${className}`}>
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          {item.href && i < items.length - 1 ? (
            <Link
              to={item.href}
              className="hover:text-foreground transition-colors truncate max-w-[160px]"
            >
              {item.label}
            </Link>
          ) : (
            <span className={i === items.length - 1 ? "text-foreground font-medium truncate max-w-[200px]" : "truncate max-w-[160px]"}>
              {item.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
