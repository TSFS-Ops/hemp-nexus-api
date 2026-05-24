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
import { LogOut, Shield, Users, Building2, AlertTriangle, Settings as SettingsIcon, Activity, ExternalLink, Inbox, TrendingUp, GitBranch, Wrench, Lock } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContextSwitcher } from "@/components/layout/ContextSwitcher";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useUrlTab } from "@/hooks/use-url-tab";

// ── Wired admin panels (no mocks) ───────────────────────────────────
import UsersManagement from "@/components/admin/UsersManagement";
import OrgsManagement from "@/components/admin/OrgsManagement";
import { AdminEntitiesPanel } from "@/components/admin/AdminEntitiesPanel";
import { AdminKycDocsPanel } from "@/components/admin/AdminKycDocsPanel";
import { AdminDisputesPanel } from "@/components/admin/AdminDisputesPanel";
import { AdminChallengeQueuePanel } from "@/components/admin/AdminChallengeQueuePanel";
import { AdminTradeApprovalsPanel } from "@/components/admin/AdminTradeApprovalsPanel";
import { AdminPendingEngagementsPanel } from "@/components/admin/AdminPendingEngagementsPanel";
import { AdminVerificationQueuePanel } from "@/components/admin/AdminVerificationQueuePanel";
import { AdminEngagementForensicsPanel } from "@/components/admin/AdminEngagementForensicsPanel";
import { AdminSettings } from "@/components/admin/AdminSettings";
import { AdminApprovalThresholdsPanel } from "@/components/admin/AdminApprovalThresholdsPanel";
import { AdminTokenManagement } from "@/components/admin/AdminTokenManagement";
import { AdminSigningKeysPanel } from "@/components/admin/AdminSigningKeysPanel";
import { BrdConstraintsPanel } from "@/components/admin/BrdConstraintsPanel";
import { AdminManualOverrides } from "@/components/admin/AdminManualOverrides";
import { AdminStagingFixturePasswords } from "@/components/admin/AdminStagingFixturePasswords";
import { AdminFixtureRecoveryEmails } from "@/components/admin/AdminFixtureRecoveryEmails";
import { AdminGovernancePosturePanel } from "@/components/admin/AdminGovernancePosturePanel";
import { AdminRedirectOriginBanner } from "@/components/admin/AdminRedirectOriginBanner";
// ── Audit & Health (compliance / observability) ─────────────────────
import { AdminAuditLogs } from "@/components/admin/AdminAuditLogs";
import { AdminNotificationPreferencesPanel } from "@/components/admin/AdminNotificationPreferencesPanel";
import { AdminOutreachBlocksPanel } from "@/components/admin/AdminOutreachBlocksPanel";

import { AdminHealthMonitor } from "@/components/admin/AdminHealthMonitor";
import { EmailRetentionHealth } from "@/components/admin/EmailRetentionHealth";
import { AiQuotaHealth } from "@/components/admin/AiQuotaHealth";
import { AdminEventStorePanel } from "@/components/admin/AdminEventStorePanel";
import { AdminRiskAlarmsPanel } from "@/components/admin/AdminRiskAlarmsPanel";
import { AdminRatingAppealsPanel } from "@/components/admin/AdminRatingAppealsPanel";
import { AdminRevenueNotificationsPanel } from "@/components/admin/AdminRevenueNotificationsPanel";
import { AdminUploadAuditPanel } from "@/components/admin/AdminUploadAuditPanel";
import { AdminRevenuePanel } from "@/components/admin/AdminRevenuePanel";
import SystemAnalytics from "@/components/admin/SystemAnalytics";
import { SystemStatusBadge } from "@/components/admin/SystemStatusBadge";
import { AdminCanonicalSpinePanel } from "@/components/admin/AdminCanonicalSpinePanel";
import { AdminLifecycleRunPanel } from "@/components/admin/AdminLifecycleRunPanel";
import { AdminLegacyRepairPanel } from "@/components/admin/AdminLegacyRepairPanel";
import { AdminLegalHoldsPanel } from "@/components/admin/AdminLegalHoldsPanel";
import { AdminTradeRequestArchivePanel } from "@/components/admin/AdminTradeRequestArchivePanel";
import { AdminComplianceHoldPanel } from "@/components/admin/AdminComplianceHoldPanel";
import { AdminDemoWorkspacesPanel } from "@/components/admin/AdminDemoWorkspacesPanel";
import { AdminResidencyReviewsPanel } from "@/components/admin/AdminResidencyReviewsPanel";

// ─────────────────────────────────────────────────────────────────────────────
// Tab registry, single source of truth. Order matters; first entry is default.
// ─────────────────────────────────────────────────────────────────────────────
type TabId = "spine" | "users" | "organisations" | "engagements" | "disputes" | "revenue" | "legacy-repair" | "legal-holds" | "audit" | "settings";
const TABS: {
  id: TabId;
  label: string;
  icon: typeof Users;
  blurb: string;
}[] = [{
  id: "spine",
  label: "Canonical Spine",
  icon: GitBranch,
  blurb: "Unified live view of every match across Search → Match → POI → WaD → Execution."
}, {
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
  id: "revenue",
  label: "Revenue & Sales",
  icon: TrendingUp,
  blurb: "Credit purchases, daily/monthly revenue, top buyers, per-org timeline."
}, {
  id: "legacy-repair",
  label: "Legacy Repair",
  icon: Wrench,
  blurb: "Matches with conflicting status / state / POI fields. Hidden from user views, awaiting admin reconciliation. Read-only — repair/archive actions coming next."
}, {
  id: "legal-holds",
  label: "Legal Holds",
  icon: Lock,
  blurb: "Apply and release legal holds. Active holds block deletion, anonymisation, purge and export destruction for the scoped entity."
}, {
  id: "audit",
  label: "Audit & Health",
  icon: Activity,
  blurb: "Tamper-evident audit trail, event store, system health monitoring, and platform analytics."
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
            <div className="h-6 w-6 rounded-sm bg-[hsl(var(--emerald))] flex items-center justify-center">
              <span className="text-foreground font-bold text-[10px] font-mono">IZ</span>
            </div>
            <div className="leading-tight">
              <div className="font-mono text-[11px] tracking-[0.25em] uppercase text-slate-100">
                Izenzo · Admin
              </div>
              <div className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted-foreground">
                Platform Administration
              </div>
            </div>
          </Link>

          {/* Workspace switcher, escape hatch back to Desk / Governance / Developer */}
          <div className="hidden md:block w-[240px]">
            <ContextSwitcher tone="dark" />
          </div>

          {/* System status badge — reads live maintenance flag from admin_settings */}
          <SystemStatusBadge />
        </div>

        <div className="flex items-center gap-3 sm:gap-5 shrink-0">
          {/* View public marketing site */}
          <a href="/" target="_blank" rel="noopener noreferrer" className="hidden sm:flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-muted-foreground/70 hover:text-emerald-400 transition-colors" aria-label="Open public marketing site in new tab">
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
            View Public Site
          </a>

          <div className="pr-1">
            <NotificationBell iconClassName="text-muted-foreground/50 hover:text-white" />
          </div>

          <button onClick={signOut} className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-muted-foreground/70 hover:text-slate-100 transition-colors" aria-label="Sign out of admin dashboard">
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
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-sm border border-border bg-card shrink-0">
        <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
      </div>
      <div className="min-w-0">
        <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground mb-1">
          Admin · {meta.label}
        </p>
        <h1 className="text-2xl font-medium text-foreground tracking-tight">
          {meta.label}
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{meta.blurb}</p>
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
  return <section className="bg-card border border-border rounded-sm overflow-hidden">
      {label && <header className="px-4 sm:px-5 py-3 border-b border-border bg-muted/50">
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground break-words">
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
function SpineTab() {
  return <>
      <TabHeader id="spine" />
      <Surface label="Live spine · matches × p3_wads × pods × pod_milestones × breaches">
        <AdminCanonicalSpinePanel />
      </Surface>
    </>;
}

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
        <TabsList className="bg-card border border-border rounded-sm">
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
      <Surface label="Forensic engagement search · trace any engagement by match, email, org or status">
        <AdminEngagementForensicsPanel />
      </Surface>
    </>;
}
function LegacyRepairTab() {
  return <>
      <TabHeader id="legacy-repair" />
      <Surface label="Inconsistent matches · public.matches via admin_list_inconsistent_matches RPC · hidden from user views">
        <AdminLegacyRepairPanel />
      </Surface>
    </>;
}
function LegalHoldsTab() {
  return <>
      <TabHeader id="legal-holds" />
      <Surface label="DATA-003 · public.legal_holds · platform_admin + AAL2 · blocks deletion/anonymisation/purge/export-destruction">
        <AdminLegalHoldsPanel />
      </Surface>
    </>;
}
function DisputesTab() {
  // Sub-tabs: Disputes · Challenges · Trade Approvals · Verification Queue (clip-on)
  const [sub, setSub] = useUrlTab("sub", "disputes", ["disputes", "challenges", "approvals", "verification", "trade-request-archive"]);
  return <>
      <TabHeader id="disputes" />
      <Tabs value={sub} onValueChange={setSub} className="space-y-5">
        <TabsList className="bg-card border border-border rounded-sm flex-wrap h-auto">
          <TabsTrigger value="disputes">Active Disputes</TabsTrigger>
          <TabsTrigger value="challenges">Challenges</TabsTrigger>
          <TabsTrigger value="approvals">Trade Approvals</TabsTrigger>
          <TabsTrigger value="verification">Verification Queue</TabsTrigger>
          <TabsTrigger value="trade-request-archive">Trade Request Archive</TabsTrigger>
          <TabsTrigger value="compliance-holds">Compliance Holds</TabsTrigger>
          <TabsTrigger value="demo-workspaces">Demo Workspaces</TabsTrigger>
        </TabsList>
        <TabsContent value="disputes">
          <Surface label="Disputed trades · public.disputes · escalation queue">
            <AdminDisputesPanel />
          </Surface>
        </TabsContent>
        <TabsContent value="challenges">
          <Surface label="Match challenges · public.match_challenges · review and outcome controls">
            <AdminChallengeQueuePanel />
          </Surface>
        </TabsContent>
        <TabsContent value="approvals">
          <Surface label="Trade approvals awaiting platform review · public.dd_approval_requests">
            <AdminTradeApprovalsPanel />
          </Surface>
        </TabsContent>
        <TabsContent value="verification">
          <Surface label="Operator verification clip-on · public.operator_verification_requests · optional pre-POI; informational, not a gate">
            <AdminVerificationQueuePanel />
          </Surface>
        </TabsContent>
        <TabsContent value="trade-request-archive">
          <Surface label="MT-012 · public.trade_requests · normal archive / admin override / exception hold release · service_role-only RPCs, AAL2-gated overrides, no POI/WaD/execution/finality/credit/payment side effects">
            <AdminTradeRequestArchivePanel />
          </Surface>
        </TabsContent>
        <TabsContent value="compliance-holds">
          <Surface label="COMP-002 / COMP-012 · public.compliance_holds · sanctions (30d) + verification (365d) freshness gate · AAL2-gated release/close · no payment/credit side effects">
            <AdminComplianceHoldPanel />
          </Surface>
        </TabsContent>
      </Tabs>
    </>;
}
function RevenueTab() {
  return <>
      <TabHeader id="revenue" />
      <Surface label="Credit purchases · public.token_ledger ⨝ public.organizations · USD revenue · legacy ZAR preserved, top buyers, per-org timeline">
        <AdminRevenuePanel />
      </Surface>
    </>;
}
function AuditTab() {
  // Compliance & observability: tamper-evident audit trail, event store, system health, analytics.
  const [sub, setSub] = useUrlTab("sub", "risk-alarms", ["risk-alarms", "rating-appeals", "audit-logs", "notification-prefs", "outreach-blocks", "upload-audit", "revenue-notifications", "health", "event-store", "analytics"]);
  return <>
      <TabHeader id="audit" />
      <Tabs value={sub} onValueChange={setSub} className="space-y-5">
        <TabsList className="bg-card border border-border rounded-sm flex-wrap h-auto">
          <TabsTrigger value="risk-alarms">Risk Alarms</TabsTrigger>
          <TabsTrigger value="rating-appeals">Rating Appeals</TabsTrigger>
          <TabsTrigger value="audit-logs">Audit Logs</TabsTrigger>
          <TabsTrigger value="notification-prefs">Notification Preferences</TabsTrigger>
          <TabsTrigger value="outreach-blocks">Outreach Blocks</TabsTrigger>
          <TabsTrigger value="upload-audit">Upload Audit</TabsTrigger>
          <TabsTrigger value="revenue-notifications">Revenue Notifications</TabsTrigger>
          
          <TabsTrigger value="health">System Health</TabsTrigger>
          <TabsTrigger value="event-store">Event Store</TabsTrigger>
          <TabsTrigger value="analytics">System Analytics</TabsTrigger>
        </TabsList>
        <TabsContent value="risk-alarms">
          <Surface label="Reconciliation alarms · accepted-without-notification, dispatch parity, attestation gaps">
            <AdminRiskAlarmsPanel />
          </Surface>
        </TabsContent>
        <TabsContent value="rating-appeals">
          <Surface label="Counterparty rating appeals · public.rating_appeals · derived four-pillar scoring">
            <AdminRatingAppealsPanel />
          </Surface>
        </TabsContent>
        <TabsContent value="audit-logs">
          <Surface label="Tamper-evident audit trail · public.audit_logs">
            <AdminAuditLogs />
          </Surface>
        </TabsContent>
        <TabsContent value="notification-prefs">
          <Surface label="Notification preferences · public.notification_preferences ⨝ public.suppressed_emails · org-scoped for org_admin, cross-org for platform_admin/auditor">
            <AdminNotificationPreferencesPanel />
          </Surface>
        </TabsContent>
        <TabsContent value="outreach-blocks">
          <Surface label="Outreach blocks · public.audit_logs (action=outreach.blocked.*) · canonical Batch E events only · counterparty/dispute/commercial fields never displayed">
            <AdminOutreachBlocksPanel />
          </Surface>
        </TabsContent>
        <TabsContent value="upload-audit">
          <Surface label="Match document upload attempts · public.audit_logs (action=document.upload.attempt) · server-evaluated participant decision">
            <AdminUploadAuditPanel />
          </Surface>
        </TabsContent>
        <TabsContent value="revenue-notifications">
          <Surface label="Revenue email attempts · public.revenue_notification_audit · support@izenzo.co.za">
            <AdminRevenueNotificationsPanel />
          </Surface>
        </TabsContent>
        <TabsContent value="health">
          <Surface label="Live subsystem health · /healthz · 30s polling">
            <div className="space-y-4">
              <AdminHealthMonitor />
              <EmailRetentionHealth />
              <AiQuotaHealth />
              <AdminLifecycleRunPanel />
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
  // Staging-only: fixture password reset tab is hidden on production hosts.
  const isStagingHost = typeof window !== "undefined" &&
    !/(^|\.)izenzo\.co\.za$/i.test(window.location.hostname);
  const baseTabs = ["platform", "governance-posture", "thresholds", "tokens", "signing", "brd", "overrides", "fixture-recovery"];
  const tabs = isStagingHost ? [...baseTabs, "staging-passwords"] : baseTabs;
  const [sub, setSub] = useUrlTab("sub", "platform", tabs);
  return <>
      <TabHeader id="settings" />
      <Tabs value={sub} onValueChange={setSub} className="space-y-5">
        <TabsList className="bg-card border border-border rounded-sm flex-wrap h-auto">
          <TabsTrigger value="platform">Platform</TabsTrigger>
          <TabsTrigger value="governance-posture">Governance Posture</TabsTrigger>
          <TabsTrigger value="thresholds">Approval Thresholds</TabsTrigger>
          <TabsTrigger value="tokens">Credit Management</TabsTrigger>
          <TabsTrigger value="signing">Signing Keys</TabsTrigger>
          <TabsTrigger value="brd">BRD Constraints</TabsTrigger>
          <TabsTrigger value="overrides">Manual Overrides</TabsTrigger>
          <TabsTrigger value="fixture-recovery">Fixture Recovery</TabsTrigger>
          {isStagingHost && <TabsTrigger value="staging-passwords">Staging Passwords</TabsTrigger>}
        </TabsList>
        <TabsContent value="platform">
          <Surface label="Global platform variables · public.admin_settings">
            <AdminSettings />
          </Surface>
        </TabsContent>
        <TabsContent value="governance-posture">
          <Surface label="Per-org legitimacy gate posture · public.org_governance_profiles · versioned history">
            <AdminGovernancePosturePanel />
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
          <Surface label="Cryptographic signing keys · append-only · public.signing_keys">
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
        <TabsContent value="fixture-recovery">
          <Surface label="Batch A fixture recovery · standard Supabase recovery email · 4-account allowlist · audited">
            <AdminFixtureRecoveryEmails />
          </Surface>
        </TabsContent>
        {isStagingHost && (
          <TabsContent value="staging-passwords">
            <Surface label="Staging-only fixture password reset · one-time reveal links · disabled on production">
              <AdminStagingFixturePasswords />
            </Surface>
          </TabsContent>
        )}
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
  const activeTab: TabId = (VALID_TAB_IDS as readonly string[]).includes(tab ?? "") ? tab as TabId : "spine";
  const handleTabChange = (next: string) => {
    navigate(`/hq/${next}`, {
      replace: false
    });
  };
  return <div className="min-h-screen bg-muted">
      <CommandBar />

      {/* Tab rail, replaces the old SecondaryNav. Mirrors the Command Bar's
          horizontal language; sticky so admins always have the four levers in view. */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="bg-card border-b border-border sticky top-0 z-10">
          <div className="px-4 sm:px-6 lg:px-10 overflow-x-auto no-scrollbar">
            <TabsList className="h-12 bg-transparent p-0 gap-6 sm:gap-8 rounded-none">
              {TABS.map(t => {
              const Icon = t.icon;
              return <TabsTrigger key={t.id} value={t.id} className="
                      relative h-12 px-0 rounded-none bg-transparent shrink-0
                      text-sm text-muted-foreground hover:text-foreground
                      data-[state=active]:text-foreground
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

        <main className="px-3 sm:px-6 lg:px-10 py-6 sm:py-8 max-w-[1600px] mx-auto space-y-4">
          <AdminRedirectOriginBanner />
          <TabsContent value="spine" className="mt-0 animate-section-enter"><SpineTab /></TabsContent>
          <TabsContent value="users" className="mt-0 animate-section-enter"><UsersTab /></TabsContent>
          <TabsContent value="organisations" className="mt-0 animate-section-enter"><OrganisationsTab /></TabsContent>
          <TabsContent value="engagements" className="mt-0 animate-section-enter"><EngagementsTab /></TabsContent>
          <TabsContent value="disputes" className="mt-0 animate-section-enter"><DisputesTab /></TabsContent>
          <TabsContent value="revenue" className="mt-0 animate-section-enter"><RevenueTab /></TabsContent>
          <TabsContent value="legacy-repair" className="mt-0 animate-section-enter"><LegacyRepairTab /></TabsContent>
          <TabsContent value="legal-holds" className="mt-0 animate-section-enter"><LegalHoldsTab /></TabsContent>
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
  return <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
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
        <p className="text-sm text-muted-foreground/70 leading-relaxed mb-10">
          The Izenzo Admin Dashboard is reserved for the platform operations team. Your account does not carry the
          <span className="font-mono text-muted-foreground/50"> platform_admin </span>
          role required to enter this area. This attempt has been recorded.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/desk" className="px-4 py-2 text-xs font-medium tracking-wide uppercase bg-card text-foreground hover:bg-muted transition-colors rounded-sm">
            Return to Desk
          </Link>
          <Link to="/welcome" className="px-4 py-2 text-xs font-medium tracking-wide uppercase border border-slate-800 text-muted-foreground/50 hover:border-slate-600 hover:text-white transition-colors rounded-sm">
            Choose workspace
          </Link>
        </div>
        <p className="mt-12 text-[10px] font-mono tracking-[0.2em] uppercase text-muted-foreground">
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