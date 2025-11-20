import { Key, Database, Webhook, FileText, BarChart3, Shield, Clock, TestTube, History, BookOpen } from "lucide-react";
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
    { id: "keys", title: "API Keys", icon: Key },
    { id: "test", title: "API Testing", icon: TestTube },
    { id: "webhooks", title: "Webhooks", icon: Webhook },
    { id: "data-sources", title: "Data Sources", icon: Database },
    { id: "analytics", title: "Analytics", icon: BarChart3 },
  ];

  const toolsItems = [
    { id: "docs", title: "Documentation", icon: BookOpen },
    { id: "hash-verify", title: "Hash Verifier", icon: Shield },
    { id: "audit-logs", title: "Audit Logs", icon: History },
    { id: "automation", title: "Automation", icon: Clock },
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
      <SidebarHeader className="border-b p-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <Key className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-semibold text-sm">Compliance API</h2>
            <p className="text-xs text-muted-foreground">Developer Portal</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    onClick={() => onSectionChange(item.id)}
                    isActive={isActive(item.id)}
                    className="w-full"
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Tools & Logs</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {toolsItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    onClick={() => onSectionChange(item.id)}
                    isActive={isActive(item.id)}
                    className="w-full"
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
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => navigate("/admin")}
                    className="w-full"
                  >
                    <Shield className="h-4 w-4" />
                    <span>Admin Panel</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t p-4">
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={handleSignOut}
        >
          <span>Sign Out</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
