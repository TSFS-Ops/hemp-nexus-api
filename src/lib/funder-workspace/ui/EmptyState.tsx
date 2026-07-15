import { ReactNode } from "react";
import { Inbox } from "lucide-react";

interface Props {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  testId?: string;
}

export function EmptyState({ title, description, icon, action, className, testId }: Props) {
  return (
    <div
      className={
        "flex flex-col items-center justify-center text-center py-10 px-4 " +
        (className ?? "")
      }
      data-testid={testId}
    >
      <div className="text-muted-foreground mb-3" aria-hidden="true">
        {icon ?? <Inbox className="h-8 w-8" />}
      </div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description && (
        <p className="text-sm text-muted-foreground mt-1 max-w-md">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
