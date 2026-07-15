import { ReactNode } from "react";

interface Props {
  title: string;
  description?: string;
  actions?: ReactNode;
  as?: "h2" | "h3";
  className?: string;
}

export function SectionHeading({ title, description, actions, as = "h2", className }: Props) {
  const H = as;
  return (
    <div className={"flex items-start justify-between gap-4 " + (className ?? "")}>
      <div className="min-w-0">
        <H className="text-base font-semibold text-foreground truncate">{title}</H>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
