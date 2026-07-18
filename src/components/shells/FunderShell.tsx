/**
 * FunderShell — single persistent chrome for every /funder/* surface.
 *
 * Previously funders navigated across three different bespoke shells
 * (FunderWorkspaceShell, P5B3FunderShell, P5B4FunderShell) plus several
 * bare pages. This shell consolidates all authorised funder surfaces
 * (workspace overview, deals, requests, cases, finality, exceptions,
 * evidence packs) into one collapsible sidebar with a sticky top bar so
 * the experience feels like one product, not four.
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
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { FUNDER_SHELL_NAV, type ShellNavItem } from "./shell-nav";
import { ShellBreadcrumb } from "./ShellBreadcrumb";

function isItemActive(pathname: string, item: ShellNavItem): boolean {
  if (item.match === "exact") return pathname === item.to || pathname === `${item.to}/`;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function FunderSidebar() {
  const { pathname } = useLocation();
  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-[hsl(var(--surface-sidebar))]">
      <SidebarHeader className="border-b border-border px-3 py-3">
        <Link to="/funder/workspace" className="flex items-center gap-2.5 min-w-0">
          <div
            className="h-7 w-7 rounded flex items-center justify-center shrink-0"
            style={{ backgroundColor: "hsl(160, 84%, 29%)" }}
          >
            <span className="text-white font-bold text-[10px] font-mono">IZ</span>
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <h2 className="font-semibold text-sm text-foreground tracking-tight truncate">Izenzo</h2>
            <p className="text-[10px] text-muted-foreground tracking-wider uppercase">Funder Workspace</p>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-1 py-2">
        {FUNDER_SHELL_NAV.map((group) => (
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

      <SidebarFooter className="border-t border-border px-3 py-2 group-data-[collapsible=icon]:hidden">
        <p className="text-[10px] text-muted-foreground leading-snug">
          Released for authorised funder review only. Decisions here do not affect
          other funders.
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}

export function FunderShell({ children }: { children?: import("react").ReactNode }) {
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
        <FunderSidebar />
        <main className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
            <div className="flex h-12 items-center gap-3 px-3 sm:px-4">
              <SidebarTrigger />
              <div className="hidden md:flex flex-1 min-w-0">
                <ShellBreadcrumb nav={FUNDER_SHELL_NAV} pathname={pathname} />
              </div>
              <div className="md:hidden text-sm font-semibold text-foreground truncate flex-1">
                Izenzo · Funder
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
            {children ?? <Outlet />}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

export default FunderShell;
