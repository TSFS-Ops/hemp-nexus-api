import { Activity, Key, Users, FileText, Settings, Shield, GitCompare, Radio, Brain, MousePointer, ScrollText } from "lucide-react";
import { useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const adminItems = [
  { title: "Overview", url: "/admin", icon: Activity, exact: true },
  { title: "Matches", url: "/admin/matches", icon: GitCompare },
  { title: "Signals", url: "/admin/signals", icon: Radio },
  { title: "Coherence Engine", url: "/admin/coherence", icon: Brain },
  { title: "Behavioral Analytics", url: "/admin/behavioral", icon: MousePointer },
  { title: "Audit Logs", url: "/admin/audit", icon: ScrollText },
  { title: "API Logs", url: "/admin/logs", icon: FileText },
  { title: "Users & Organizations", url: "/admin/users-orgs", icon: Users },
  { title: "API Keys", url: "/admin/api-keys", icon: Key },
  { title: "Risk Management", url: "/admin/risk", icon: Shield },
  { title: "Settings", url: "/admin/settings", icon: Settings },
];

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const currentPath = location.pathname;

  const isActive = (url: string, exact?: boolean) => {
    if (exact) return currentPath === url;
    return currentPath.startsWith(url);
  };

  return (
    <Sidebar className={collapsed ? "w-14" : "w-60"} collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Admin Console</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <a
                      href={item.url}
                      className={`flex items-center gap-2 ${
                        isActive(item.url, item.exact)
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
