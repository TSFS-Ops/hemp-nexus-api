/**
 * AdminShell — single persistent chrome for every platform-admin surface.
 *
 * Replaces the previous "many islands" model where /hq/*, /admin/*,
 * /admin/funder-workspace/*, /admin/p5-batch{2..8}/* and /admin/registry/*
 * each rendered as bare pages with no shared navigation. This shell:
 *
 *   • provides one collapsible sidebar grouping every admin surface;
 *   • pins a sticky top bar with sidebar trigger, contextual breadcrumb,
 *     notification bell and sign-out;
 *   • renders route children through <Outlet /> so pages stay purely
 *     content-focused and never need to reconstruct chrome themselves.
 *
 * Wrapped at the route table in App.tsx around every /admin/* and /hq/*
 * route so navigation between them feels like one product, not many.
 */
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ADMIN_SHELL_NAV, type ShellNavItem } from "./shell-nav";

function isItemActive(pathname: string, item: ShellNavItem): boolean {
  if (item.match === "exact") return pathname === item.to || pathname === `${item.to}/`;
  return pathname === item.to || pathname.startsWith(`${item.to}/`) || pathname.startsWith(`${item.to}?`);
}

/** Breadcrumb derived from the active nav item — one label, no synthetic
 *  path splitting, so it never lies about hierarchy. */
function ShellBreadcrumb({ pathname }: { pathname: string }) {
  for (const group of ADMIN_SHELL_NAV) {
    for (const item of group.items) {
      if (isItemActive(pathname, item)) {
        return (
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            <span className="uppercase tracking-wider text-[10px] font-medium">
              {group.label}
            </span>
            <span aria-hidden>·</span>
            <span className="truncate text-foreground/80">{item.label}</span>
          </div>
        );
      }
    }
  }
  return null;
}

function AdminSidebar() {
  const { pathname } = useLocation();
  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-[hsl(var(--surface-sidebar))]">
      <SidebarHeader className="border-b border-border px-3 py-3">
        <Link to="/hq" className="flex items-center gap-2.5 min-w-0">
          <div
            className="h-7 w-7 rounded flex items-center justify-center shrink-0"
            style={{ backgroundColor: "hsl(160, 84%, 29%)" }}
          >
            <span className="text-white font-bold text-[10px] font-mono">IZ</span>
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <h2 className="font-semibold text-sm text-foreground tracking-tight truncate">Izenzo</h2>
            <p className="text-[10px] text-muted-foreground tracking-wider uppercase">Admin Console</p>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-1 py-2">
        {ADMIN_SHELL_NAV.map((group) => (
          <SidebarGroup key={group.label} className="mt-1">
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground px-2">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isItemActive(pathname, item);
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.label}
                        className="text-sm"
                      >
                        <NavLink to={item.to}>
                          <Icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-border px-3 py-2">
        <Link
          to="/desk"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors group-data-[collapsible=icon]:hidden"
        >
          ← Return to Desk
        </Link>
      </SidebarFooter>
    </Sidebar>
  );
}

export function AdminShell() {
  const { pathname } = useLocation();
  const { user } = useAuth();

  const handleSignOut = async () => {
    (window as any).__izenzo_signing_out = true;
    const { error } = await supabase.auth.signOut();
    if (error) {
      (window as any).__izenzo_signing_out = false;
      toast.error("Error signing out", { description: error.message });
    } else {
      window.location.href = "/auth?signedOut=1";
    }
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AdminSidebar />
        <main className="flex-1 flex flex-col min-w-0">
          <header
            className={cn(
              "sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm",
            )}
          >
            <div className="flex h-12 items-center gap-3 px-3 sm:px-4">
              <SidebarTrigger />
              <div className="hidden md:flex flex-1 min-w-0">
                <ShellBreadcrumb pathname={pathname} />
              </div>
              <div className="md:hidden text-sm font-semibold text-foreground truncate flex-1">
                Izenzo · Admin
              </div>
              <div className="flex items-center gap-1">
                <NotificationBell />
                <div className="hidden lg:flex items-center gap-2 pl-2 border-l border-border ml-1">
                  <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                    {user?.email}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={handleSignOut}
                  >
                    <LogOut className="h-3.5 w-3.5 mr-1" />
                    Sign out
                  </Button>
                </div>
              </div>
            </div>
          </header>
          <div className="flex-1 min-w-0">
            <Outlet />
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

export default AdminShell;
