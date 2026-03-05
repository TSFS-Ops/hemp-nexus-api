import { Search, Handshake, Settings, LogIn } from "lucide-react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
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
  isDemoMode?: boolean;
}

const navItems = [
  { path: "/dashboard", title: "Overview", icon: Search },
  { path: "/dashboard/search", title: "Search", icon: Search },
  { path: "/dashboard/matches", title: "Matches", icon: Handshake },
  { path: "/dashboard/settings", title: "Settings", icon: Settings },
];

export function AppSidebar({ isAdmin, isDemoMode }: AppSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === "/dashboard") return location.pathname === "/dashboard";
    return location.pathname.startsWith(path);
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Error signing out", { description: error.message });
    } else {
      navigate("/auth");
    }
  };

  return (
    <Sidebar className="border-r border-border">
      <SidebarHeader className="border-b border-border px-4 py-3">
        <Link to="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <div className="h-7 w-7 rounded bg-foreground flex items-center justify-center">
            <span className="text-background font-bold text-[10px]">TI</span>
          </div>
          <div>
            <h2 className="font-semibold text-sm text-foreground">Trade.Izenzo</h2>
            <p className="text-xs text-muted-foreground">Console</p>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
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
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild className="w-full px-2 py-1.5 text-sm">
                    <Link to="/admin">
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
        {isDemoMode ? (
          <Link to="/auth" className="w-full">
            <Button
              size="sm"
              className="w-full justify-start text-sm bg-foreground text-background hover:bg-foreground/90"
            >
              <LogIn className="h-4 w-4 mr-2" />
              Sign in
            </Button>
          </Link>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sm text-muted-foreground hover:text-foreground"
            onClick={handleSignOut}
          >
            Sign out
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
