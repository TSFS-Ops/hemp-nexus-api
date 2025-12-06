import { Key, Code, FileText, Activity, GitBranch, BookOpen, Handshake, BarChart3, HelpCircle, TestTube2, HeartPulse, AlertOctagon, Store, TrendingUp, Package, LayoutGrid, Search, Lock, LogIn, Database, User } from "lucide-react";
import { useLocation, useNavigate, Link } from "react-router-dom";
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
import { useToast } from "@/hooks/use-toast";

interface AppSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  isAdmin?: boolean;
  isDemoMode?: boolean;
}

export function AppSidebar({ activeSection, onSectionChange, isAdmin, isDemoMode }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

  const mainItems = [
    { id: "search", title: "Search", icon: Search },
    { id: "docs", title: "Overview", icon: BookOpen },
    { id: "keys", title: "API Keys", icon: Key, requiresAuth: true },
    { id: "test", title: "Reference", icon: Code },
    { id: "sdk", title: "SDKs", icon: Package },
    { id: "embed", title: "Embed", icon: LayoutGrid },
    { id: "matches", title: "Matches", icon: Handshake, requiresAuth: true },
    { id: "analytics", title: "Analytics", icon: BarChart3, requiresAuth: true },
    { id: "webhooks", title: "Webhooks", icon: Database, requiresAuth: true },
    { id: "webhook-debugger", title: "Debugger", icon: Code, requiresAuth: true },
    { id: "audit-logs", title: "Logs", icon: Activity, requiresAuth: true },
  ];

  const marketplaceItems = [
    { id: "marketplace", title: "Marketplace", icon: Store, route: "/marketplace" },
    { id: "global-analytics", title: "Network", icon: TrendingUp, route: "/analytics" },
  ];

  const accountItems = [
    { id: "my-activity", title: "My Activity", icon: User, route: "/activity", requiresAuth: true },
  ];

  const toolsItems = [
    { id: "data-sources", title: "Data Sources", icon: FileText },
    { id: "hash-verify", title: "Hash Verifier", icon: Key },
    { id: "system-health", title: "System Health", icon: HeartPulse },
    { id: "automated-tests", title: "Tests", icon: TestTube2 },
    { id: "error-monitoring", title: "Errors", icon: AlertOctagon },
    { id: "troubleshooting", title: "Troubleshooting", icon: HelpCircle },
    { id: "automation", title: "Changelog", icon: GitBranch },
  ];

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast({
        variant: "destructive",
        title: "Error signing out",
        description: error.message,
      });
    } else {
      navigate("/auth");
    }
  };

  const isActive = (id: string) => activeSection === id;

  return (
    <Sidebar className="border-r border-border">
      <SidebarHeader className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded bg-foreground flex items-center justify-center">
            <span className="text-background font-bold text-[10px]">CM</span>
          </div>
          <div>
            <h2 className="font-semibold text-sm text-foreground">Compliance Match</h2>
            <p className="text-xs text-muted-foreground font-mono">v1.0</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupLabel className="px-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            API
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    onClick={() => onSectionChange(item.id)}
                    isActive={isActive(item.id)}
                    className="w-full px-2 py-1.5 text-sm"
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                    {isDemoMode && item.requiresAuth && (
                      <Lock className="h-3 w-3 ml-auto text-muted-foreground" />
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupLabel className="px-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Tools
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {toolsItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    onClick={() => onSectionChange(item.id)}
                    isActive={isActive(item.id)}
                    className="w-full px-2 py-1.5 text-sm"
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupLabel className="px-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Network
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {marketplaceItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    onClick={() => item.route ? navigate(item.route) : onSectionChange(item.id)}
                    isActive={item.route ? location.pathname === item.route : isActive(item.id)}
                    className="w-full px-2 py-1.5 text-sm"
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {!isDemoMode && (
          <SidebarGroup className="mt-4">
            <SidebarGroupLabel className="px-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Account
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {accountItems.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      onClick={() => item.route ? navigate(item.route) : onSectionChange(item.id)}
                      isActive={item.route ? location.pathname === item.route : isActive(item.id)}
                      className="w-full px-2 py-1.5 text-sm"
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {isAdmin && (
          <SidebarGroup className="mt-4">
            <SidebarGroupLabel className="px-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => navigate("/admin")}
                    className="w-full px-2 py-1.5 text-sm"
                  >
                    <Key className="h-4 w-4" />
                    <span>Management</span>
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