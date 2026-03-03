import { Key, Code, FileText, Activity, BookOpen, Handshake, BarChart3, Package, Search, Lock, LogIn, Database, User, Coins, Settings, HelpCircle, Mail, CreditCard, Shield } from "lucide-react";
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

  // Core developer console sections - Stripe-like organization
  const overviewItems = [
    { id: "docs", title: "Overview", icon: BookOpen },
  ];

  const apiItems = [
    { id: "keys", title: "API Keys", icon: Key, requiresAuth: true },
    { id: "test", title: "API Reference", icon: Code },
    { id: "sdk", title: "SDKs", icon: Package },
  ];

  const dataItems = [
    { id: "search", title: "Search", icon: Search },
    { id: "invites", title: "Invites", icon: Mail, requiresAuth: true, isLink: true, linkTo: "/invites" },
    { id: "matches", title: "Evidence Packs", icon: Handshake, requiresAuth: true },
    { id: "due-diligence", title: "Due Diligence", icon: Shield, requiresAuth: true, isLink: true, linkTo: "/due-diligence" },
    { id: "audit-logs", title: "Logs", icon: Activity, requiresAuth: true },
  ];

  const configItems = [
    { id: "webhooks", title: "Webhooks", icon: Database, requiresAuth: true },
    { id: "analytics", title: "Analytics", icon: BarChart3, requiresAuth: true },
    { id: "usage", title: "Usage & Billing", icon: Coins, requiresAuth: true },
  ];

  const supportItems = [
    { id: "pricing", title: "Pricing", icon: CreditCard, isLink: true, linkTo: "/pricing" },
    { id: "troubleshooting", title: "Help", icon: HelpCircle },
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

  const renderMenuItems = (items: typeof supportItems) => (
    <SidebarMenu>
      {items.map((item) => (
        <SidebarMenuItem key={item.id}>
          {'isLink' in item && item.isLink ? (
            <SidebarMenuButton asChild className="w-full px-2 py-1.5 text-sm">
              <Link to={item.linkTo}>
                <item.icon className="h-4 w-4" />
                <span>{item.title}</span>
              </Link>
            </SidebarMenuButton>
          ) : (
            <SidebarMenuButton
              onClick={() => onSectionChange(item.id)}
              isActive={isActive(item.id)}
              className="w-full px-2 py-1.5 text-sm"
            >
              <item.icon className="h-4 w-4" />
              <span>{item.title}</span>
              {isDemoMode && 'requiresAuth' in item && item.requiresAuth && (
                <Lock className="h-3 w-3 ml-auto text-muted-foreground" />
              )}
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );

  return (
    <Sidebar className="border-r border-border">
      <SidebarHeader className="border-b border-border px-4 py-3">
        <Link to="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <div className="h-7 w-7 rounded bg-foreground flex items-center justify-center">
            <span className="text-background font-bold text-[10px]">CM</span>
          </div>
          <div>
            <h2 className="font-semibold text-sm text-foreground">Compliance Matching</h2>
            <p className="text-xs text-muted-foreground font-mono">API Console</p>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            {renderMenuItems(overviewItems)}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupLabel className="px-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            API
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderMenuItems(apiItems)}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupLabel className="px-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Data
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderMenuItems(dataItems)}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupLabel className="px-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Configure
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {renderMenuItems(configItems)}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          <SidebarGroupContent>
            {renderMenuItems(supportItems)}
          </SidebarGroupContent>
        </SidebarGroup>

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
                    <Settings className="h-4 w-4" />
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
