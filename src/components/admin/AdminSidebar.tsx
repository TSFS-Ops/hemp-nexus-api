import {
  Activity,
  Key,
  Users,
  FileText,
  Settings,
  Shield,
  GitCompare,
  Radio,
  Brain,
  MousePointer,
  ScrollText,
  Zap,
  Coins,
  FileCheck,
  Lock,
  ClipboardCheck,
  BookLock,
  AlertTriangle,
  Globe,
  UserCog,
  FileWarning,
  Heart,
  ShieldCheck,
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
  useSidebar,
} from "@/components/ui/sidebar";

const sidebarGroups = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", url: "/admin", icon: Activity, exact: true },
      { title: "Verification Checklist", url: "/admin/verification", icon: ClipboardCheck },
    ],
  },
  {
    label: "Core Data",
    items: [
      { title: "Interests", url: "/admin/interests", icon: Heart },
      { title: "POIs", url: "/admin/pois", icon: Shield },
      { title: "Matches", url: "/admin/matches", icon: GitCompare },
      { title: "Signals", url: "/admin/signals", icon: Radio },
      { title: "Documents", url: "/admin/documents", icon: FileCheck },
      { title: "WaD Hard-Gates", url: "/admin/wad-governance", icon: ShieldCheck },
      { title: "WaD Bundles", url: "/admin/wad", icon: Lock },
    ],
  },
  {
    label: "Analytics",
    items: [
      { title: "Coherence Engine", url: "/admin/coherence", icon: Brain },
      { title: "Discovery Metrics", url: "/admin/discovery", icon: Zap },
      { title: "Behavioral", url: "/admin/behavioral", icon: MousePointer },
    ],
  },
  {
    label: "Audit & Logs",
    items: [
      { title: "Audit Trail", url: "/admin/audit", icon: ScrollText },
      { title: "POI State History", url: "/admin/poi-history", icon: Shield },
      { title: "Collapse Ledger", url: "/admin/collapse-ledger", icon: BookLock },
      { title: "API Logs", url: "/admin/logs", icon: FileText },
    ],
  },
  {
    label: "Governance",
    items: [
      { title: "RBAC", url: "/admin/rbac", icon: UserCog },
      { title: "Break-Glass", url: "/admin/break-glass", icon: AlertTriangle },
      { title: "BRD Constraints", url: "/admin/brd-constraints", icon: FileWarning },
      { title: "Data Residency", url: "/admin/data-residency", icon: Globe },
    ],
  },
  {
    label: "Management",
    items: [
      { title: "Tokens", url: "/admin/tokens", icon: Coins },
      { title: "Users & Orgs", url: "/admin/users-orgs", icon: Users },
      { title: "API Keys", url: "/admin/api-keys", icon: Key },
      { title: "Risk Register", url: "/admin/risk", icon: Shield },
      { title: "Settings", url: "/admin/settings", icon: Settings },
    ],
  },
  {
    label: "Checkpoints",
    items: [
      { title: "Checkpoint Demo (16 Apr 2026)", url: "/admin/checkpoint-2026-04-16", icon: ClipboardCheck },
    ],
  },
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
        {sidebarGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
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
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
