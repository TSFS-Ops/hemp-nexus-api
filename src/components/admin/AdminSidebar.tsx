import {
  Activity,
  Key,
  Users,
  Settings,
  Shield,
  GitCompare,
  Scale,
  Wrench,
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
import { ROUTES } from "@/lib/constants";

const sidebarItems = [
  { title: "Overview", url: ROUTES.ADMIN, icon: Activity, exact: true },
  { title: "Deals", url: ROUTES.ADMIN_DEALS, icon: GitCompare },
  { title: "Users & Orgs", url: ROUTES.ADMIN_USERS_ORGS, icon: Users },
  { title: "Compliance", url: ROUTES.ADMIN_COMPLIANCE, icon: Scale },
  { title: "Audit", url: ROUTES.ADMIN_AUDIT, icon: Shield },
  { title: "API Keys", url: ROUTES.ADMIN_API_KEYS, icon: Key },
  { title: "Overrides", url: ROUTES.ADMIN_OVERRIDES, icon: Wrench },
  { title: "Settings", url: ROUTES.ADMIN_SETTINGS, icon: Settings },
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
        <Link to={ROUTES.ADMIN} className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded bg-foreground flex items-center justify-center">
            <span className="text-background font-bold text-[10px]">CM</span>
          </div>
          <div>
            <h2 className="font-semibold text-sm text-foreground">Compliance Match</h2>
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
