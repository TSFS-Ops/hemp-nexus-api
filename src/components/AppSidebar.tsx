import { Key, Code, Zap, FileCode, Activity, Shield, GitBranch, BookOpen, Handshake, BarChart3, HelpCircle, TestTube2, HeartPulse, AlertOctagon } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
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
}

export function AppSidebar({ activeSection, onSectionChange, isAdmin }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

  const mainItems = [
    { id: "quickstart", title: "Quick Start", icon: BookOpen },
    { id: "docs", title: "Overview", icon: BookOpen },
    { id: "keys", title: "Authentication", icon: Key },
    { id: "test", title: "API Reference", icon: Code },
    { id: "matches", title: "Matches", icon: Handshake },
    { id: "analytics", title: "Analytics", icon: BarChart3 },
    { id: "webhooks", title: "Webhooks", icon: Zap },
    { id: "webhook-debugger", title: "Webhook Debugger", icon: Zap },
    { id: "audit-logs", title: "Logs", icon: Activity },
  ];

  const toolsItems = [
    { id: "data-sources", title: "Data Sources", icon: FileCode },
    { id: "hash-verify", title: "Hash Verifier", icon: Shield },
    { id: "system-health", title: "System Health", icon: HeartPulse },
    { id: "automated-tests", title: "Automated Tests", icon: TestTube2 },
    { id: "error-monitoring", title: "Error Monitoring", icon: AlertOctagon },
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
    <Sidebar className="border-r">
      <SidebarHeader className="border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded bg-primary flex items-center justify-center">
            <Shield className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-semibold text-sm">Compliance Match</h2>
            <p className="text-xs text-muted-foreground font-mono">API v1.0</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3 py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Documentation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    onClick={() => onSectionChange(item.id)}
                    isActive={isActive(item.id)}
                    className="w-full px-3 py-2 text-sm font-medium"
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
          <SidebarGroupLabel className="px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Resources</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {toolsItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    onClick={() => onSectionChange(item.id)}
                    isActive={isActive(item.id)}
                    className="w-full px-3 py-2 text-sm font-medium"
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup className="mt-4">
            <SidebarGroupLabel className="px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => navigate("/admin")}
                    className="w-full px-3 py-2 text-sm font-medium"
                  >
                    <Shield className="h-4 w-4" />
                    <span>Management</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t px-3 py-4">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-sm font-medium"
          onClick={handleSignOut}
        >
          Sign Out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
