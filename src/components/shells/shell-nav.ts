import { Handshake } from "lucide-react";
/**
 * Shared shell navigation configuration.
 *
 * Central catalogue of every persona-scoped surface so the AdminShell and
 * FunderShell sidebars stay in sync with the App route table. Each entry
 * declares its icon, label, and the deep-link path a user should land on.
 * Grouping keeps the sidebar scannable when the number of surfaces grows.
 */
import {
  Activity,
  AlertOctagon,
  BadgeCheck,
  Banknote,
  BarChart3,
  Bell,
  Building2,
  ClipboardList,
  Coins,
  Database,
  FileArchive,
  FileText,
  Gavel,
  History,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Package,
  Receipt,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Signpost,
  Sparkles,
  Users,
  UserRound,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export interface ShellNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match rule: 'exact' | 'startsWith' (default 'startsWith'). */
  match?: "exact" | "startsWith";
}

export interface ShellNavGroup {
  label: string;
  items: ShellNavItem[];
  defaultOpen?: boolean;
}

/**
 * Admin persona sidebar. Grouped so a platform admin sees every operating
 * surface without having to remember URLs, and can move between the
 * Compliance Workbench, HQ, Funder Workspace, Registry and P-5 workbenches
 * without leaving the shell.
 */
export const ADMIN_SHELL_NAV: ShellNavGroup[] = [
  {
    label: "Command Centre",
    items: [
      { to: "/hq", label: "HQ Overview", icon: LayoutDashboard, match: "exact" },
      { to: "/hq/spine", label: "Platform Spine", icon: Workflow },
      { to: "/hq/users", label: "Users", icon: Users },
      { to: "/hq/organisations", label: "Organisations", icon: Building2 },
      { to: "/hq/engagements", label: "Engagements", icon: Handshake_ },
      { to: "/hq/facilitation", label: "Facilitation", icon: Signpost },
    ],
  },
  {
    label: "Compliance",
    items: [
      { to: "/hq/compliance", label: "Compliance Workbench", icon: ShieldCheck },
      { to: "/admin/idv/review", label: "IDV Review", icon: BadgeCheck },
      { to: "/admin/p5-governance", label: "Governance Cases", icon: Scale },
      { to: "/hq/disputes", label: "Disputes", icon: Gavel },
      { to: "/hq/legal-holds", label: "Legal Holds", icon: ShieldAlert },
    ],
  },
  {
    label: "Funder Workspace",
    items: [
      { to: "/admin/funder-workspace", label: "Overview", icon: Landmark, match: "exact" },
      { to: "/admin/funder-workspace/onboarding", label: "Onboarding" , icon: ListChecks },
      { to: "/admin/funder-workspace/organisations", label: "Funder Orgs", icon: Building2 },
      { to: "/admin/funder-workspace/releases", label: "Deal Releases", icon: Package },
      { to: "/admin/funder-workspace/audit", label: "Audit & Usage", icon: History },
      { to: "/admin/p5-batch3", label: "Funder Workflow", icon: Workflow },
      { to: "/admin/p5-batch4", label: "Execution Cases", icon: FileArchive },
    ],
  },
  {
    label: "Registry",
    items: [
      { to: "/admin/registry", label: "Registry Console", icon: Database, match: "exact" },
      { to: "/admin/registry/operations", label: "Operations", icon: Activity },
      { to: "/admin/registry/records", label: "Records", icon: FileText },
      { to: "/admin/registry/claims", label: "Claims", icon: ClipboardList },
      { to: "/admin/registry/bank-verification", label: "Bank Verification", icon: Banknote },
      { to: "/admin/registry/api-clients", label: "API Clients", icon: Sparkles },
      { to: "/admin/registry/api-usage", label: "API Usage", icon: BarChart3 },
    ],
  },
  {
    label: "Evidence Workbenches",
    items: [
      { to: "/admin/p5-batch2", label: "Evidence & Packs", icon: FileArchive },
      { to: "/admin/p5-batch5/finality-memory", label: "Finality Memory", icon: History },
      { to: "/admin/p5-batch6", label: "Exceptions", icon: AlertOctagon },
      { to: "/admin/p5-batch7/control-dashboard", label: "Control Dashboard", icon: LayoutDashboard },
      { to: "/admin/p5-batch7/compliance-dashboard", label: "Compliance Dashboard", icon: ShieldCheck },
      { to: "/admin/p5-batch7/api-dashboard", label: "API Dashboard", icon: BarChart3 },
      { to: "/admin/p5-batch7/provider-dashboard", label: "Provider Dashboard", icon: Sparkles },
      { to: "/admin/p5-batch7/audit-dashboard", label: "Audit Dashboard", icon: History },
      { to: "/admin/p5-batch8", label: "Provider Dependencies", icon: Sparkles },
      { to: "/admin/p5-screening", label: "Screening Readiness", icon: Search },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/admin/notifications/channel-readiness", label: "Notifications", icon: Bell },
      { to: "/admin/support", label: "Support Queue", icon: LifeBuoy, match: "exact" },
      { to: "/admin/support/incidents", label: "Incidents", icon: AlertOctagon },
      { to: "/admin/support/kb", label: "Knowledge Base", icon: FileText },
      { to: "/admin/support/sla", label: "SLA Targets", icon: BarChart3 },
      { to: "/admin/support/escalation-runs", label: "Escalation Runs", icon: Activity },
    ],
  },
];

/**
 * Funder persona sidebar. Consolidates every release-scoped funder surface
 * (workspace overview, deals, batch requests, cases, finality and exceptions)
 * into one navigation so a funder never has to relearn the app across batches.
 */
export const FUNDER_SHELL_NAV: ShellNavGroup[] = [
  {
    label: "Workspace",
    items: [
      { to: "/funder/workspace", label: "Overview", icon: LayoutDashboard, match: "exact" },
      { to: "/funder/workspace/deals", label: "Deals", icon: Package },
      { to: "/funder/workspace/activity", label: "Activity", icon: Activity },
      { to: "/funder/workspace/profile", label: "Profile", icon: UserRound },
    ],
  },
  {
    label: "Evidence",
    items: [
      { to: "/funder/evidence-pack", label: "Evidence Pack", icon: FileArchive },
      { to: "/funder/p5-batch2/evidence-pack", label: "Evidence Pack (P-5 B2)", icon: FileArchive },
      { to: "/funder/compliance-summary", label: "Compliance Summary", icon: ShieldCheck },
    ],
  },
  {
    label: "Workflow",
    items: [
      { to: "/funder/p5-batch3", label: "Requests", icon: ListChecks, match: "exact" },
      { to: "/funder/p5-batch4", label: "Execution Cases", icon: FileText, match: "exact" },
      { to: "/funder/p5-batch5/finality", label: "Finality", icon: History },
      { to: "/funder/p5-batch6/exceptions", label: "Exceptions", icon: AlertOctagon },
      { to: "/funder/p5-batch7/funder-dashboard", label: "Dashboard", icon: BarChart3 },
    ],
  },
];

const Handshake_: LucideIcon = Handshake ?? Workflow;

