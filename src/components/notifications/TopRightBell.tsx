import { NotificationBell } from "./NotificationBell";

/**
 * Global floating notification bell, fixed to the top-right of the viewport.
 * No wrapper, no background — pure naked icon button positioned absolutely.
 */
export function TopRightBell() {
  return (
    <div className="fixed top-6 right-6 z-[100]">
      <NotificationBell iconClassName="text-slate-700 hover:text-slate-900" />
    </div>
  );
}
