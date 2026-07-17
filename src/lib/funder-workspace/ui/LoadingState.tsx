import { Loader2 } from "lucide-react";

interface Props {
  label?: string;
  className?: string;
}

export function LoadingState({ label = "Loading...", className }: Props) {
  return (
    <div
      className={
        "flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center " +
        (className ?? "")
      }
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
