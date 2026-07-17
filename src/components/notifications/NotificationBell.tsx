import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Notification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

interface NotificationBellProps {
  /** Tailwind classes for the icon. Defaults to a light-surface palette. */
  iconClassName?: string;
}

export function NotificationBell({
  iconClassName = "text-slate-500 hover:text-slate-900",
}: NotificationBellProps) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("id, title, body, link, read, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (!cancelled && data) setNotifications(data as Notification[]);
    };

    load();

    const channel = supabase.channel(
      `notifications:${user.id}:${Math.random().toString(36).slice(2)}`,
    );
    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = async () => {
    if (!user || unreadCount === 0) return;
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);
  };

  if (!user) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) markAllRead();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
          className={`relative p-1 transition-colors ${iconClassName}`}
        >
          <Bell size={20} strokeWidth={1.75} />
          {unreadCount > 0 && (
            <span
              className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500"
              aria-hidden="true"
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={16}
        className="w-[min(20rem,calc(100vw-2rem))] p-0"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-slate-500">
            Notifications
          </p>
          {unreadCount > 0 && (
            <span className="font-mono text-[10px] tracking-wider uppercase text-slate-400">
              {unreadCount} unread
            </span>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              No notifications
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {notifications.map((n) => {
                const Body = (
                  <>
                    <p className="text-sm font-medium text-slate-900">
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="mt-1 text-xs text-slate-500 line-clamp-2">
                        {n.body}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <a
                        href={n.link}
                        className="block px-4 py-3 hover:bg-slate-50 transition-colors"
                        onClick={() => setOpen(false)}
                      >
                        {Body}
                      </a>
                    ) : (
                      <div className="px-4 py-3">{Body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
