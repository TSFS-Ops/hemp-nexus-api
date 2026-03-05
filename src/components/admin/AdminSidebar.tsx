import {
  Activity,
  Key,
  Users,
  Settings,
  Shield,
  GitCompare,
  Scale,
} from "lucide-react";
import { useLocation, Link } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from "@/components/ui/sidebar";

const sidebarItems = [
  { title: "Overview", url: "/admin", icon: Activity, exact: true },
  { title: "Deals", url: "/admin/deals", icon: GitCompare },
  { title: "Users & Orgs", url: "/admin/users-orgs", icon: Users },
  { title: "Compliance", url: "/admin/compliance", icon: Scale },
  { title: "Audit", url: "/admin/audit", icon: Shield },
  { title: "API Keys", url: "/admin/api-keys", icon: Key },
  { title: "Settings", url: "/admin/settings", icon: Settings },
];

export function AdminSidebar() {
  const location = useLocation();
  const currentPath = location.pathname;

  const isActive = (url: string, exact?: boolean) => {
    if (exact) return currentPath === url;
    return currentPath.startsWith(url);
  };

  return (
    <Sidebar className="w-60" collapsible="icon">
      <SidebarHeader className="border-b border-border px-4 py-3">
        <Link to="/admin" className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded bg-foreground flex items-center justify-center">
            <span className="text-background font-bold text-[10px]">TI</span>
          </div>
          <div>
            <h2 className="font-semibold text-sm text-foreground">Trade.Izenzo</h2>
            <p className="text-xs text-muted-foreground">Admin</p>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-2 py-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {sidebarItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <Link
                      to={item.url}
                      className={`flex items-center gap-2 ${
                        isActive(item.url, item.exact)
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
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
