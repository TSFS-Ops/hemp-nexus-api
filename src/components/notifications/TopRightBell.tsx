import { NotificationBell } from "./NotificationBell";

interface TopRightBellProps {
  /** "light" (default): for light page backgrounds. "dark": for dark headers. */
  tone?: "light" | "dark";
}

/**
 * Global floating notification bell, fixed to the top-right of the viewport.
 * No wrapper, no background — pure naked icon button positioned absolutely.
 */
export function TopRightBell({ tone = "light" }: TopRightBellProps = {}) {
  const iconClassName =
    tone === "dark"
      ? "text-slate-300 hover:text-white"
      : "text-slate-700 hover:text-slate-900";
  return (
    <div className="fixed top-6 right-6 z-[100]">
      <NotificationBell iconClassName={iconClassName} />
    </div>
  );
}
