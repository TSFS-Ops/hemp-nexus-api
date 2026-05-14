import { Search, Handshake, Settings, ShieldCheck, Building2, LayoutDashboard, BookOpen, Coins, Landmark } from "lucide-react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { ROUTES } from "@/lib/constants";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AppSidebarProps {
  isAdmin?: boolean;
}

const mainNavItems = [
  { path: ROUTES.DASHBOARD, title: "Desk", icon: LayoutDashboard },
  { path: ROUTES.DASHBOARD_SEARCH, title: "Search", icon: Search },
  { path: ROUTES.DASHBOARD_ORDER_BOOK, title: "Order Book", icon: BookOpen },
  { path: ROUTES.DASHBOARD_MATCHES, title: "Trade Requests", icon: Handshake },
];

const settingsNavItems = [
  { path: ROUTES.DASHBOARD_PROGRAMMES, title: "Programmes", icon: Landmark },
  { path: ROUTES.DASHBOARD_SETTINGS, title: "Settings", icon: Settings },
  { path: ROUTES.DASHBOARD_ACCOUNT, title: "Organisation", icon: Building2 },
  { path: ROUTES.DASHBOARD_COMPLIANCE, title: "Compliance", icon: ShieldCheck },
  { path: ROUTES.BILLING, title: "Credits", icon: Coins },
];

export function AppSidebar({ isAdmin }: AppSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === ROUTES.DASHBOARD) return location.pathname === ROUTES.DASHBOARD;
    return location.pathname.startsWith(path);
  };

  const handleSignOut = async () => {
    // Set global flag BEFORE signOut so useDataFetch hooks don't race
    // with a false "session expired" redirect.
    (window as any).__izenzo_signing_out = true;
    const { error } = await supabase.auth.signOut();
    if (error) {
      (window as any).__izenzo_signing_out = false;
      toast.error("Error signing out", { description: error.message });
    } else {
      window.location.href = `${ROUTES.AUTH}?signedOut=1`;
    }
  };

  return (
    <Sidebar className="border-r border-border bg-[hsl(var(--surface-sidebar))] shadow-sm">
      <SidebarHeader className="border-b border-border px-4 py-3">
        <Link to="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <div className="h-7 w-7 rounded flex items-center justify-center" style={{ backgroundColor: 'hsl(160, 84%, 29%)' }}>
            <span className="text-white font-bold text-[10px] font-mono">IZ</span>
          </div>
          <div>
            <h2 className="font-semibold text-sm text-foreground tracking-tight">Izenzo</h2>
            <p className="text-[10px] text-muted-foreground tracking-wider uppercase">Console</p>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs text-muted-foreground px-2 mb-1">Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.path)}
                    className="w-full px-2 py-1.5 text-sm"
                  >
                    <Link to={item.path}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupLabel className="text-xs text-muted-foreground px-2 mb-1">Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsNavItems.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.path)}
                    className="w-full px-2 py-1.5 text-sm"
                  >
                    <Link to={item.path}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup className="mt-4">
            <SidebarGroupLabel className="text-xs text-muted-foreground px-2 mb-1">Platform</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild className="w-full px-2 py-1.5 text-sm">
                    <Link to={ROUTES.ADMIN}>
                      <Settings className="h-4 w-4" />
                      <span>Admin</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-border px-2 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-sm text-muted-foreground hover:text-foreground"
          onClick={handleSignOut}
        >
          Sign out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
