import {
  Activity,
  Key,
  Users,
  Building2,
  Shield,
  GitCompare,
  Scale,
  Wrench,
  Database,
  BookOpen,
  Webhook,
  Terminal,
  Blocks,
  Settings,
  CheckCircle2,
  Landmark,
  HeartPulse,
  Handshake,
  ChevronRight,
} from "lucide-react";
import { useLocation, Link } from "react-router-dom";
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
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ROUTES } from "@/lib/constants";

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const sidebarGroups: NavGroup[] = [
  {
    label: "TRADES",
    items: [
      { title: "Global Overview", url: ROUTES.ADMIN, icon: Activity, exact: true },
      { title: "Active Requests", url: ROUTES.ADMIN_DEALS, icon: GitCompare },
      { title: "Pending Engagements", url: ROUTES.ADMIN_ENGAGEMENTS, icon: Handshake },
      { title: "Complete Deals", url: ROUTES.ADMIN_ORDER_BOOK, icon: CheckCircle2 },
    ],
  },
  {
    label: "VERIFICATION",
    items: [
      { title: "Partner Checks", url: ROUTES.ADMIN_COMPLIANCE, icon: Scale },
      { title: "Audit Trail", url: ROUTES.ADMIN_AUDIT, icon: Shield },
      { title: "Evidence Ledger", url: ROUTES.ADMIN_LEDGER, icon: Blocks },
    ],
  },
  {
    label: "PARTNERS",
    items: [
      { title: "Users", url: ROUTES.ADMIN_USERS, icon: Users },
      { title: "Organisations", url: ROUTES.ADMIN_ORGS, icon: Building2 },
    ],
  },
  {
    label: "TECHNICAL",
    items: [
      { title: "API Keys", url: ROUTES.ADMIN_API_KEYS, icon: Key },
      { title: "Webhooks", url: ROUTES.ADMIN_WEBHOOKS, icon: Webhook },
      { title: "System Logs", url: ROUTES.ADMIN_SYSTEM_LOGS, icon: Terminal },
      { title: "Health Monitor", url: ROUTES.ADMIN_HEALTH, icon: HeartPulse },
    ],
  },
  {
    label: "GOVERNANCE",
    items: [
      { title: "Programmes", url: ROUTES.ADMIN_PROGRAMMES, icon: Landmark },
      { title: "Data Retention", url: ROUTES.ADMIN_DATA_GOVERNANCE, icon: Database },
      { title: "Policy Settings", url: ROUTES.ADMIN_SETTINGS, icon: Settings },
    ],
  },
];

export function AdminSidebar() {
  const location = useLocation();
  const currentPath = location.pathname;

  const isActive = (url: string, exact?: boolean) => {
    if (exact) return currentPath === url;
    return currentPath.startsWith(url);
  };

  const groupHasActive = (group: NavGroup) =>
    group.items.some((item) => isActive(item.url, item.exact));

  return (
    <Sidebar className="w-60" collapsible="icon">
      <SidebarHeader className="border-b border-border px-4 py-3 space-y-2">
        <Link to={ROUTES.ADMIN} className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded flex items-center justify-center" style={{ backgroundColor: 'hsl(160, 84%, 29%)' }}>
            <span className="text-white font-bold text-[10px] font-mono">IZ</span>
          </div>
          <div>
            <h2 className="font-semibold text-sm text-foreground tracking-tight">Izenzo</h2>
            <p className="text-[10px] text-muted-foreground tracking-wider uppercase">Platform Admin</p>
          </div>
        </Link>
        <Link
          to={ROUTES.DASHBOARD}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>←</span>
          <span>Back to Console</span>
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-2 py-2">
        {sidebarGroups.map((group) => (
          <Collapsible
            key={group.label}
            defaultOpen={groupHasActive(group)}
            className="group/collapsible"
          >
            <SidebarGroup className="py-0">
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground/70 uppercase px-2 mb-0.5 cursor-pointer hover:text-muted-foreground transition-colors">
                  <span className="flex-1">{group.label}</span>
                  <ChevronRight className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => {
                      const active = isActive(item.url, item.exact);
                      return (
                        <SidebarMenuItem key={item.title}>
                          <SidebarMenuButton asChild>
                            <Link
                              to={item.url}
                              className={`flex items-center gap-2 text-[13px] transition-all duration-150 ${
                                active
                                  ? "bg-foreground text-background font-medium"
                                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                              }`}
                              style={active ? { borderLeft: '2px solid hsl(160, 84%, 29%)' } : {}}
                            >
                              <item.icon className={`h-4 w-4 shrink-0 ${active ? 'text-success' : ''}`} />
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
