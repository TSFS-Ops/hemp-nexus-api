/**
 * SectionHeader — Single source of truth for page/section title blocks.
 *
 * Replaces the 15+ scattered patterns of:
 *   <header className="space-y-1">
 *     <h1 className="text-2xl font-bold tracking-tight">Title</h1>
 *     <p className="text-muted-foreground text-sm">Description</p>
 *   </header>
 *
 * Usage:
 *   <SectionHeader title="Matches" description="View and manage trade matches" />
 *   <SectionHeader title="Webhooks" description="..." action={<Button>Refresh</Button>} />
 */

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  description?: string;
  /** Optional action element (e.g. a refresh button) aligned to the right */
  action?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, description, action, className }: SectionHeaderProps) {
  return (
    <header className={cn("flex items-start justify-between gap-4", className)}>
      <div className="space-y-1 min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
