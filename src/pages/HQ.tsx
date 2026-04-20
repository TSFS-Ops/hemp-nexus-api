/**
 * Admin Dashboard, Izenzo Platform Administration.
 *
 * Top-level admin workspace for the platform operations team. Provides
 * functional management surfaces for users, organisations (KYB), disputes,
 * and platform settings.
 *
 * Layout:
 *   - Top admin bar (slate-950): brand + system status + exit.
 *   - Tab rail (white, hairline border): four functional admin surfaces.
 *   - Tab content (slate-50): real, wired admin panels, no mocks.
 *
 * Privacy contract: counterparty trade detail remains opaque to admins by
 * design. Only meta-state surfaces here (KYB status, dispute escalations,
 * system settings). Trade payloads are encrypted at rest.
 */

import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { LogOut, Shield, Users, Building2, AlertTriangle, Settings as SettingsIcon, Activity, ExternalLink, Inbox } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContextSwitcher } from "@/components/layout/ContextSwitcher";
import { TopRightBell } from "@/components/notifications/TopRightBell";
import { useUrlTab } from "@/hooks/use-url-tab";

// ── Wired admin panels (no mocks) ───────────────────────────────────
import UsersManagement from "@/components/admin/UsersManagement";
import OrgsManagement from "@/components/admin/OrgsManagement";
import { AdminEntitiesPanel } from "@/components/admin/AdminEntitiesPanel";
import { AdminKycDocsPanel } from "@/components/admin/AdminKycDocsPanel";
import { AdminDisputesPanel } from "@/components/admin/AdminDisputesPanel";
import { AdminTradeApprovalsPanel } from "@/components/admin/AdminTradeApprovalsPanel";
import { AdminPendingEngagementsPanel } from "@/components/admin/AdminPendingEngagementsPanel";
import { AdminSettings } from "@/components/admin/AdminSettings";
import { AdminApprovalThresholdsPanel } from "@/components/admin/AdminApprovalThresholdsPanel";
import { AdminTokenManagement } from "@/components/admin/AdminTokenManagement";
import { AdminSigningKeysPanel } from "@/components/admin/AdminSigningKeysPanel";
import { BrdConstraintsPanel } from "@/components/admin/BrdConstraintsPanel";
import { AdminManualOverrides } from "@/components/admin/AdminManualOverrides";
// ── Audit & Health (compliance / observability) ─────────────────────
import { AdminAuditLogs } from "@/components/admin/AdminAuditLogs";
import { AdminHealthMonitor } from "@/components/admin/AdminHealthMonitor";
import { EmailRetentionHealth } from "@/components/admin/EmailRetentionHealth";
import { AdminEventStorePanel } from "@/components/admin/AdminEventStorePanel";
import SystemAnalytics from "@/components/admin/SystemAnalytics";

// ─────────────────────────────────────────────────────────────────────────────
// Tab registry, single source of truth. Order matters; first entry is default.
// ─────────────────────────────────────────────────────────────────────────────
type TabId = "users" | "organisations" | "engagements" | "disputes" | "audit" | "settings";
const TABS: {
  id: TabId;
  label: string;
  icon: typeof Users;
  blurb: string;
}[] = [{
  id: "users",
  label: "User Management",
  icon: Users,
  blurb: "Profiles, role assignments, account suspensions."
}, {
  id: "organisations",
  label: "Organisation Management",
  icon: Building2,
  blurb: "KYB lifecycle, legal entities, KYC document verification."
}, {
  id: "engagements",
  label: "Engagements",
  icon: Inbox,
  blurb: "POI hold-point queue · counterparty outreach and activation."
}, {
  id: "disputes",
  label: "Dispute Resolution",
  icon: AlertTriangle,
  blurb: "Flagged trades, escalations, force-resolve overrides."
}, {
  id: "audit",
  label: "Audit & Health",
  icon: Activity,
  blurb: "Immutable audit trail, event store, system health monitoring, and platform analytics."
}, {
  id: "settings",
  label: "Platform Settings",
  icon: SettingsIcon,
  blurb: "Platform configuration, approval thresholds, signing keys, overrides."
}];
const VALID_TAB_IDS = TABS.map(t => t.id) as readonly TabId[];

// ─────────────────────────────────────────────────────────────────────────────
// Top admin bar, header for the platform administration workspace.
// Midnight slate-950 to draw a hard boundary against the bright workspace below.
// ─────────────────────────────────────────────────────────────────────────────
function CommandBar() {
  const {
    signOut
  } = useAuth();
  return <header className="bg-slate-950 text-slate-100 border-b border-slate-900">
      <div className="px-4 sm:px-6 lg:px-10 h-14 flex items-center justify-between gap-6">
        <div className="flex items-center gap-6 min-w-0">
          {/* Wordmark */}
          <Link to="/hq" className="flex items-center gap-2.5 shrink-0">
            <div className="h-6 w-6 rounded-sm bg-emerald-500 flex items-center justify-center">
              <span className="text-slate-950 font-bold text-[10px] font-mono">IZ</span>
            </div>
            <div className="leading-tight">
              <div className="font-mono text-[11px] tracking-[0.25em] uppercase text-slate-100">
                Izenzo · Admin
              </div>
              <div className="font-mono text-[9px] tracking-[0.2em] uppercase text-slate-500">
                Platform Administration
              </div>
            </div>
          </Link>

          {/* Workspace switcher, escape hatch back to Desk / Governance / Developer */}
          <div className="hidden md:block w-[240px]">
            <ContextSwitcher tone="dark" />
          </div>

          {/* System status badge */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-sm border border-emerald-900/60 bg-emerald-950/40 shrink-0">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-emerald-300">
              System Status: Operational
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-5 shrink-0">
          {/* View public marketing site */}
          <a href="/" target="_blank" rel="noopener noreferrer" className="hidden sm:flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-slate-400 hover:text-emerald-400 transition-colors" aria-label="Open public marketing site in new tab">
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
            View Public Site
          </a>

          <NotificationBell iconClassName="text-slate-400 hover:text-slate-100" />

          <button onClick={signOut} className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-slate-400 hover:text-slate-100 transition-colors" aria-label="Sign out of admin dashboard">
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
            Sign out
          </button>
        </div>
      </div>

      {/* Mobile-only workspace switcher row, surfaced because the desktop slot is hidden < md */}
      <div className="md:hidden px-4 pb-3 -mt-1">
        <ContextSwitcher tone="dark" />
      </div>
    </header>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section header, renders inside each tab. Anchors the operator with a
// breadcrumb-equivalent and a one-line description of the surface.
// ─────────────────────────────────────────────────────────────────────────────
function TabHeader({
  id
}: {
  id: TabId;
}) {
  const meta = TABS.find(t => t.id === id)!;
  const Icon = meta.icon;
  return <div className="flex items-start gap-4 mb-8">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-sm border border-slate-200 bg-white shrink-0">
        <Icon className="h-4 w-4 text-slate-700" strokeWidth={1.5} />
      </div>
      <div className="min-w-0">
        <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500 mb-1">
          Admin · {meta.label}
        </p>
        <h1 className="text-2xl font-medium text-slate-900 tracking-tight">
          {meta.label}
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">{meta.blurb}</p>
      </div>
    </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Surface wrapper, uniform admin chrome for every wired panel.
// White card on slate-50, hairline border, generous padding. The internal
// admin panels supply their own tables; we just frame them.
// ─────────────────────────────────────────────────────────────────────────────
function Surface({
  children,
  label
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return <section className="bg-white border border-slate-200 rounded-sm overflow-hidden">
      {label && <header className="px-4 sm:px-5 py-3 border-b border-slate-200 bg-slate-50/50">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-600 break-words">
            {label}
          </p>
        </header>}
      <div className="p-3 sm:p-5 min-w-0" data-admin-table>
        {children}
      </div>
    </section>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab content, each panel is the legacy admin component, restyled by Surface.
// ─────────────────────────────────────────────────────────────────────────────
function UsersTab() {
  return <>
      <TabHeader id="users" />
      <Surface label="Profiles & role assignments · auth.users · public.user_roles">
        <UsersManagement />
      </Surface>
    </>;
}
function OrganisationsTab() {
  // Sub-tabs: Orgs (token balances + suspension) · Legal Entities · KYB Docs
  // Sub-tab state lives in ?sub= so legacy redirects (e.g. /admin/entities) and
  // bookmarks land on the right surface.
  const [sub, setSub] = useUrlTab("sub", "orgs", ["orgs", "entities", "kyb"]);
  return <>
      <TabHeader id="organisations" />
      <Tabs value={sub} onValueChange={setSub} className="space-y-5">
        <TabsList className="bg-white border border-slate-200 rounded-sm">
          <TabsTrigger value="orgs">Organisations</TabsTrigger>
          <TabsTrigger value="entities">Legal Entities</TabsTrigger>
          <TabsTrigger value="kyb">KYB Documents</TabsTrigger>
        </TabsList>
        <TabsContent value="orgs">
          <Surface label="Registered organisations · public.organisations">
            <OrgsManagement />
          </Surface>
        </TabsContent>
        <TabsContent value="entities">
          <Surface label="Legal entities · public.entities">
            <AdminEntitiesPanel />
          </Surface>
        </TabsContent>
        <TabsContent value="kyb">
          <Surface label="KYB document verification · public.kyc_documents">
            <AdminKycDocsPanel />
          </Surface>
        </TabsContent>
      </Tabs>
    </>;
}
function EngagementsTab() {
  return <>
      <TabHeader id="engagements" />
      <Surface label="POI hold-point queue · public.poi_engagements · counterparty outreach">
        <AdminPendingEngagementsPanel />
      </Surface>
    </>;
}
function DisputesTab() {
  // Sub-tabs: Disputes · Trade Approvals
  const [sub, setSub] = useUrlTab("sub", "disputes", ["disputes", "approvals"]);
  return <>
      <TabHeader id="disputes" />
      <Tabs value={sub} onValueChange={setSub} className="space-y-5">
        <TabsList className="bg-white border border-slate-200 rounded-sm">
          <TabsTrigger value="disputes">Active Disputes</TabsTrigger>
          <TabsTrigger value="approvals">Trade Approvals</TabsTrigger>
        </TabsList>
        <TabsContent value="disputes">
          <Surface label="Disputed trades · public.disputes · escalation queue">
            <AdminDisputesPanel />
          </Surface>
        </TabsContent>
        <TabsContent value="approvals">
          <Surface label="Trade approvals awaiting platform review · public.dd_approval_requests">
            <AdminTradeApprovalsPanel />
          </Surface>
        </TabsContent>
      </Tabs>
    </>;
}
function AuditTab() {
  // Compliance & observability: immutable audit trail, event store, system health, analytics.
  const [sub, setSub] = useUrlTab("sub", "audit-logs", ["audit-logs", "health", "event-store", "analytics"]);
  return <>
      <TabHeader id="audit" />
      <Tabs value={sub} onValueChange={setSub} className="space-y-5">
        <TabsList className="bg-white border border-slate-200 rounded-sm flex-wrap h-auto">
          <TabsTrigger value="audit-logs">Audit Logs</TabsTrigger>
          <TabsTrigger value="health">System Health</TabsTrigger>
          <TabsTrigger value="event-store">Event Store</TabsTrigger>
          <TabsTrigger value="analytics">System Analytics</TabsTrigger>
        </TabsList>
        <TabsContent value="audit-logs">
          <Surface label="Immutable audit trail · public.audit_logs">
            <AdminAuditLogs />
          </Surface>
        </TabsContent>
        <TabsContent value="health">
          <Surface label="Live subsystem health · /healthz · 30s polling">
            <div className="space-y-4">
              <AdminHealthMonitor />
              <EmailRetentionHealth />
            </div>
          </Surface>
        </TabsContent>
        <TabsContent value="event-store">
          <Surface label="Append-only event store · public.event_store">
            <AdminEventStorePanel />
          </Surface>
        </TabsContent>
        <TabsContent value="analytics">
          <Surface label="Platform-wide system metrics · users, organisations, API usage">
            <SystemAnalytics />
          </Surface>
        </TabsContent>
      </Tabs>
    </>;
}
function SettingsTab() {
  // Full platform settings suite: configuration, thresholds, tokens, signing keys, BRD, overrides.
  const [sub, setSub] = useUrlTab("sub", "platform", ["platform", "thresholds", "tokens", "signing", "brd", "overrides"]);
  return <>
      <TabHeader id="settings" />
      <Tabs value={sub} onValueChange={setSub} className="space-y-5">
        <TabsList className="bg-white border border-slate-200 rounded-sm flex-wrap h-auto">
          <TabsTrigger value="platform">Platform</TabsTrigger>
          <TabsTrigger value="thresholds">Approval Thresholds</TabsTrigger>
          <TabsTrigger value="tokens">Credit Management</TabsTrigger>
          <TabsTrigger value="signing">Signing Keys</TabsTrigger>
          <TabsTrigger value="brd">BRD Constraints</TabsTrigger>
          <TabsTrigger value="overrides">Manual Overrides</TabsTrigger>
        </TabsList>
        <TabsContent value="platform">
          <Surface label="Global platform variables · public.admin_settings">
            <AdminSettings />
          </Surface>
        </TabsContent>
        <TabsContent value="thresholds">
          <Surface label="Per-org approval thresholds · public.approval_thresholds">
            <AdminApprovalThresholdsPanel />
          </Surface>
        </TabsContent>
        <TabsContent value="tokens">
          <Surface label="Credit balance administration · public.token_balances">
            <AdminTokenManagement />
          </Surface>
        </TabsContent>
        <TabsContent value="signing">
          <Surface label="Tamper-Proof signing keys · append-only · public.signing_keys">
            <AdminSigningKeysPanel />
          </Surface>
        </TabsContent>
        <TabsContent value="brd">
          <Surface label="Locked business-rule constraints · public.brd_constraints">
            <BrdConstraintsPanel />
          </Surface>
        </TabsContent>
        <TabsContent value="overrides">
          <Surface label="Break-glass manual interventions · audited · public.break_glass_actions">
            <AdminManualOverrides />
          </Surface>
        </TabsContent>
      </Tabs>
    </>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin layout, top bar + tab rail. Tab state lives in the URL (/hq/:tab)
// so admins can deep-link and bookmark surfaces without losing context.
// ─────────────────────────────────────────────────────────────────────────────
function HQLayout() {
  const navigate = useNavigate();
  const {
    tab
  } = useParams<{
    tab?: string;
  }>();
  const activeTab: TabId = (VALID_TAB_IDS as readonly string[]).includes(tab ?? "") ? tab as TabId : "users";
  const handleTabChange = (next: string) => {
    navigate(`/hq/${next}`, {
      replace: false
    });
  };
  return <div className="min-h-screen bg-slate-50" style={{
    fontFamily: "Inter, sans-serif"
  }}>
      <CommandBar />

      {/* Tab rail, replaces the old SecondaryNav. Mirrors the Command Bar's
          horizontal language; sticky so admins always have the four levers in view. */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
          <div className="px-4 sm:px-6 lg:px-10 overflow-x-auto no-scrollbar">
            <TabsList className="h-12 bg-transparent p-0 gap-6 sm:gap-8 rounded-none">
              {TABS.map(t => {
              const Icon = t.icon;
              return <TabsTrigger key={t.id} value={t.id} className="
                      relative h-12 px-0 rounded-none bg-transparent shrink-0
                      text-sm text-slate-500 hover:text-slate-900
                      data-[state=active]:text-slate-900
                      data-[state=active]:font-medium
                      data-[state=active]:shadow-none
                      data-[state=active]:bg-transparent
                      data-[state=active]:after:absolute
                      data-[state=active]:after:left-0
                      data-[state=active]:after:right-0
                      data-[state=active]:after:-bottom-px
                      data-[state=active]:after:h-0.5
                      data-[state=active]:after:bg-slate-900
                      transition-colors
                    ">
                    <Icon className="h-3.5 w-3.5 mr-2" strokeWidth={1.5} />
                    {t.label}
                  </TabsTrigger>;
            })}
            </TabsList>
          </div>
        </div>

        <main className="px-3 sm:px-6 lg:px-10 py-6 sm:py-8 max-w-[1600px] mx-auto">
          <TabsContent value="users" className="mt-0 animate-section-enter"><UsersTab /></TabsContent>
          <TabsContent value="organisations" className="mt-0 animate-section-enter"><OrganisationsTab /></TabsContent>
          <TabsContent value="engagements" className="mt-0 animate-section-enter"><EngagementsTab /></TabsContent>
          <TabsContent value="disputes" className="mt-0 animate-section-enter"><DisputesTab /></TabsContent>
          <TabsContent value="audit" className="mt-0 animate-section-enter"><AuditTab /></TabsContent>
          <TabsContent value="settings" className="mt-0 animate-section-enter"><SettingsTab /></TabsContent>
        </main>
      </Tabs>
    </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 403 Forbidden, clean, brand-aligned denial state.
// Shown to authenticated non-admins who navigate directly to /hq via URL.
// We render a visible explanation rather than a silent redirect so operators
// understand the boundary; a manual exit returns them to the persona selector.
// ─────────────────────────────────────────────────────────────────────────────
function ForbiddenHQ() {
  return <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6" style={{
    fontFamily: "Inter, sans-serif"
  }}>
      <div className="max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-md border border-slate-800 bg-slate-900 mb-8">
          <Shield className="h-5 w-5 text-rose-400" strokeWidth={1.5} />
        </div>
        <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-rose-400 mb-4">
          403 · Forbidden
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-white mb-4">
          Access restricted
        </h1>
        <p className="text-sm text-slate-400 leading-relaxed mb-10">
          The Izenzo Admin Dashboard is reserved for the platform operations team. Your account does not carry the
          <span className="font-mono text-slate-300"> platform_admin </span>
          role required to enter this area. This attempt has been recorded.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/desk" className="px-4 py-2 text-xs font-medium tracking-wide uppercase bg-white text-slate-950 hover:bg-slate-200 transition-colors rounded-sm">
            Return to Desk
          </Link>
          <Link to="/welcome" className="px-4 py-2 text-xs font-medium tracking-wide uppercase border border-slate-800 text-slate-300 hover:border-slate-600 hover:text-white transition-colors rounded-sm">
            Choose workspace
          </Link>
        </div>
        <p className="mt-12 text-[10px] font-mono tracking-[0.2em] uppercase text-slate-600">
          Access attempt · SHA-256 logged
        </p>
      </div>
    </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outer page. Auth-gated to platform admins.
// Routes: /hq → users (default) · /hq/:tab → that tab.
// ─────────────────────────────────────────────────────────────────────────────
export default function HQ() {
  const {
    isAdmin,
    isLoading
  } = useAuth();
  if (isLoading) return null;
  return <RequireAuth>
      {!isAdmin ? <ForbiddenHQ /> : <HQLayout />}
    </RequireAuth>;
}