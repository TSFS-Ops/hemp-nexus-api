import { Routes, Route, Link, Navigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ROUTES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminMobileNav } from "@/components/admin/AdminMobileNav";
import { AdminOverview } from "@/components/admin/AdminOverview";
import { AdminApiKeys } from "@/components/admin/AdminApiKeys";
import { AdminSettings } from "@/components/admin/AdminSettings";
import { AdminMatchesPanel } from "@/components/admin/AdminMatchesPanel";
import { AdminAuditLogs } from "@/components/admin/AdminAuditLogs";
import { AdminTokenManagement } from "@/components/admin/AdminTokenManagement";
import { AdminComplianceCasesPanel } from "@/components/admin/AdminComplianceCasesPanel";
import { AdminDisputesPanel } from "@/components/admin/AdminDisputesPanel";
import { AdminDealPipelinePanel } from "@/components/admin/AdminDealPipelinePanel";
import { AdminTradeApprovalsPanel } from "@/components/admin/AdminTradeApprovalsPanel";
import { AdminEntitiesPanel } from "@/components/admin/AdminEntitiesPanel";
import { AdminRiskPanel } from "@/components/admin/AdminRiskPanel";
import UsersManagement from "@/components/admin/UsersManagement";
import OrgsManagement from "@/components/admin/OrgsManagement";
import { GlobalApiLogs } from "@/components/admin/GlobalApiLogs";
import { PoiStateHistory } from "@/components/admin/PoiStateHistory";
import { CollapseLedgerViewer } from "@/components/admin/CollapseLedgerViewer";
import { AdminManualOverrides } from "@/components/admin/AdminManualOverrides";
import { AdminSigningKeysPanel } from "@/components/admin/AdminSigningKeysPanel";
import { AdminGovernanceDocsPanel } from "@/components/admin/AdminGovernanceDocsPanel";
import { AdminReputationPanel } from "@/components/admin/AdminReputationPanel";
import { AdminRetentionFlagsPanel } from "@/components/admin/AdminRetentionFlagsPanel";
import { AdminKycDocsPanel } from "@/components/admin/AdminKycDocsPanel";
import { AdminBehavioralKycLink } from "@/components/admin/AdminBehavioralKycLink";
import { AdminBehavioralInsights } from "@/components/admin/AdminBehavioralInsights";
import { AdminRiskSnapshotsPanel } from "@/components/admin/AdminRiskSnapshotsPanel";
import { AdminScreeningRunsPanel } from "@/components/admin/AdminScreeningRunsPanel";
import { AdminUboPanel } from "@/components/admin/AdminUboPanel";
import { AdminPodPanel } from "@/components/admin/AdminPodPanel";
import { AdminSignalsPanel } from "@/components/admin/AdminSignalsPanel";
import { AdminInterestsPanel } from "@/components/admin/AdminInterestsPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlTab } from "@/hooks/use-url-tab";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

// ─── Section Headers ────────────────────────────────────────────────
function SectionHeader({ title, description, parents }: { title: string; description: string; parents?: { label: string; href: string }[] }) {
  return (
    <div className="space-y-1">
      {parents && <Breadcrumbs items={[...parents, { label: title }]} />}
      <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

// ─── GOV.UK Empty State ─────────────────────────────────────────────
function SystemEmpty({ icon: Icon, heading, description }: { icon: React.ComponentType<{ className?: string }>; heading: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <Icon className="h-10 w-10 text-muted-foreground/30 mb-4" />
      <h3 className="text-base font-medium text-foreground mb-1">{heading}</h3>
      <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
    </div>
  );
}

function AdminNotFound() {
  return (
    <div className="p-6 text-center py-16">
      <p className="text-4xl font-bold text-muted-foreground/30 mb-3">404</p>
      <h2 className="text-lg font-semibold text-foreground mb-1">Page not found</h2>
      <p className="text-sm text-muted-foreground mb-4">This admin section does not exist.</p>
      <Button variant="outline" size="sm" asChild>
        <Link to={ROUTES.ADMIN}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Overview
        </Link>
      </Button>
    </div>
  );
}

// ─── TRADES ─────────────────────────────────────────────────────────

function DealsSection() {
  const [tab, setTab] = useUrlTab("tab", "pipeline", ["pipeline", "matches", "approvals"]);
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6" data-admin-table>
      <SectionHeader
        title="Active Requests"
        description="Trade requests in progress, match lifecycle tracking, and approval status."
        parents={[{ label: "Admin", href: ROUTES.ADMIN }]}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="matches">Matches</TabsTrigger>
            <TabsTrigger value="approvals">Approvals</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="pipeline" className="mt-4 animate-section-enter"><AdminDealPipelinePanel /></TabsContent>
        <TabsContent value="matches" className="mt-4 animate-section-enter"><AdminMatchesPanel /></TabsContent>
        <TabsContent value="approvals" className="mt-4 animate-section-enter"><AdminTradeApprovalsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function OrderBookSection() {
  const [tab, setTab] = useUrlTab("tab", "signals", ["signals", "interests"]);
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <SectionHeader
        title="Complete Deals"
        description="Finalised trades, active buyer and seller signals across the platform."
        parents={[{ label: "Admin", href: ROUTES.ADMIN }]}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="signals">Signals</TabsTrigger>
            <TabsTrigger value="interests">Interests</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="signals" className="mt-4"><AdminSignalsPanel /></TabsContent>
        <TabsContent value="interests" className="mt-4"><AdminInterestsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── VERIFICATION ───────────────────────────────────────────────────

function ComplianceSection() {
  const [tab, setTab] = useUrlTab("tab", "cases", ["cases", "disputes", "risk", "kyc", "screening", "ubo", "behavioral-kyc", "insights"]);
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <SectionHeader
        title="Partner Checks"
        description="We check your trading partner's identity and authority to trade before you commit money."
        parents={[{ label: "Admin", href: ROUTES.ADMIN }]}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="cases">Cases</TabsTrigger>
            <TabsTrigger value="disputes">Disputes</TabsTrigger>
            <TabsTrigger value="risk">Risk Register</TabsTrigger>
            <TabsTrigger value="kyc">KYC Docs</TabsTrigger>
            <TabsTrigger value="screening">Screening</TabsTrigger>
            <TabsTrigger value="ubo">UBO</TabsTrigger>
            <TabsTrigger value="behavioral-kyc">Score to KYC</TabsTrigger>
            <TabsTrigger value="insights">Behavioural Insights</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="cases" className="mt-4"><AdminComplianceCasesPanel /></TabsContent>
        <TabsContent value="disputes" className="mt-4"><AdminDisputesPanel /></TabsContent>
        <TabsContent value="risk" className="mt-4"><AdminRiskPanel /></TabsContent>
        <TabsContent value="kyc" className="mt-4"><AdminKycDocsPanel /></TabsContent>
        <TabsContent value="screening" className="mt-4"><AdminScreeningRunsPanel /></TabsContent>
        <TabsContent value="ubo" className="mt-4"><AdminUboPanel /></TabsContent>
        <TabsContent value="behavioral-kyc" className="mt-4"><AdminBehavioralKycLink /></TabsContent>
        <TabsContent value="insights" className="mt-4"><AdminBehavioralInsights /></TabsContent>
      </Tabs>
    </div>
  );
}

function AuditSection() {
  const [tab, setTab] = useUrlTab("tab", "audit", ["audit", "poi"]);
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <SectionHeader
        title="Audit Trail"
        description="Immutable record of all platform actions. Every mutation is logged with actor, timestamp, and context."
        parents={[{ label: "Admin", href: ROUTES.ADMIN }]}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="audit">Audit Logs</TabsTrigger>
            <TabsTrigger value="poi">Intent History</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="audit" className="mt-4"><AdminAuditLogs /></TabsContent>
        <TabsContent value="poi" className="mt-4"><PoiStateHistory /></TabsContent>
      </Tabs>
    </div>
  );
}

function LedgerSection() {
  const [tab, setTab] = useUrlTab("tab", "ledger", ["ledger", "signing-keys", "reputation", "risk-snapshots"]);
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <SectionHeader
        title="Evidence Ledger"
        description="Cryptographic proof chain for all completed trades. Every entry is SHA-256 hashed and signature-verified."
        parents={[{ label: "Admin", href: ROUTES.ADMIN }]}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="ledger">Completion Ledger</TabsTrigger>
            <TabsTrigger value="signing-keys">Signing Keys</TabsTrigger>
            <TabsTrigger value="reputation">Reputation</TabsTrigger>
            <TabsTrigger value="risk-snapshots">Risk Snapshots</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="ledger" className="mt-4"><CollapseLedgerViewer /></TabsContent>
        <TabsContent value="signing-keys" className="mt-4"><AdminSigningKeysPanel /></TabsContent>
        <TabsContent value="reputation" className="mt-4"><AdminReputationPanel /></TabsContent>
        <TabsContent value="risk-snapshots" className="mt-4"><AdminRiskSnapshotsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── PARTNERS ───────────────────────────────────────────────────────

function UsersSection() {
  const [tab, setTab] = useUrlTab("tab", "users", ["users", "tokens"]);
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <SectionHeader
        title="Users"
        description="Platform user accounts and credit balance management."
        parents={[{ label: "Admin", href: ROUTES.ADMIN }]}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="users">User Accounts</TabsTrigger>
            <TabsTrigger value="tokens">Credit Balances</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="users" className="mt-4"><UsersManagement /></TabsContent>
        <TabsContent value="tokens" className="mt-4"><AdminTokenManagement /></TabsContent>
      </Tabs>
    </div>
  );
}

function OrgsSection() {
  const [tab, setTab] = useUrlTab("tab", "orgs", ["orgs", "entities", "pods"]);
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <SectionHeader
        title="Organisations"
        description="Registered organisations, legal entities, and proof-of-delivery tracking."
        parents={[{ label: "Admin", href: ROUTES.ADMIN }]}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="orgs">Organisations</TabsTrigger>
            <TabsTrigger value="entities">Legal Entities</TabsTrigger>
            <TabsTrigger value="pods">Proof of Delivery</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="orgs" className="mt-4"><OrgsManagement /></TabsContent>
        <TabsContent value="entities" className="mt-4"><AdminEntitiesPanel /></TabsContent>
        <TabsContent value="pods" className="mt-4"><AdminPodPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── DEVELOPER ──────────────────────────────────────────────────────

function WebhooksSection() {
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <SectionHeader
        title="Webhooks"
        description="Event delivery endpoints and retry status for all organisations."
        parents={[{ label: "Admin", href: ROUTES.ADMIN }]}
      />
      <SystemEmpty
        icon={ArrowLeft}
        heading="No webhook endpoints configured"
        description="Webhook endpoints are managed per-organisation from the console dashboard."
      />
    </div>
  );
}

function SystemLogsSection() {
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <SectionHeader
        title="System Logs"
        description="API request logs, error rates, and edge function execution history."
        parents={[{ label: "Admin", href: ROUTES.ADMIN }]}
      />
      <GlobalApiLogs />
    </div>
  );
}

// ─── GOVERNANCE ─────────────────────────────────────────────────────

function DataGovernanceSection() {
  const [tab, setTab] = useUrlTab("tab", "retention", ["retention", "governance-docs"]);
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <SectionHeader
        title="Data Retention"
        description="Managing 7-year immutable hold cycles for POPIA compliance. Records are never permanently deleted."
        parents={[{ label: "Admin", href: ROUTES.ADMIN }]}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="retention">Retention Enforcement</TabsTrigger>
            <TabsTrigger value="governance-docs">Governance Documents</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="retention" className="mt-4"><AdminRetentionFlagsPanel /></TabsContent>
        <TabsContent value="governance-docs" className="mt-4"><AdminGovernanceDocsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Layout ─────────────────────────────────────────────────────────

function AdminContent() {
  return (
    <SidebarProvider>
      <div className="min-h-screen-safe flex w-full">
        <div className="hidden md:block">
          <AdminSidebar />
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 sm:h-14 border-b flex items-center px-3 sm:px-4 bg-background justify-between sticky top-0 z-10 safe-area-top">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="touch-target hidden md:flex" />
              <h1 className="text-sm font-medium text-muted-foreground tracking-wide uppercase">Admin</h1>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to={ROUTES.DASHBOARD}>
                <ArrowLeft className="h-4 w-4 mr-1 sm:mr-2" />
                <span className="hidden xs:inline">Console</span>
              </Link>
            </Button>
          </header>
          <main className="flex-1 overflow-auto pb-20 md:pb-0">
            <Routes>
              {/* OPERATIONS */}
              <Route path="/" element={<AdminOverview />} />
              <Route path="/deals" element={<DealsSection />} />
              <Route path="/order-book" element={<OrderBookSection />} />
              {/* TRUST & INTEGRITY */}
              <Route path="/compliance" element={<ComplianceSection />} />
              <Route path="/audit" element={<AuditSection />} />
              <Route path="/ledger" element={<LedgerSection />} />
              {/* ENTITIES */}
              <Route path="/users" element={<UsersSection />} />
              <Route path="/orgs" element={<OrgsSection />} />
              {/* DEVELOPER */}
              <Route path="/api-keys" element={<AdminApiKeys />} />
              <Route path="/webhooks" element={<WebhooksSection />} />
              <Route path="/system-logs" element={<SystemLogsSection />} />
              {/* GOVERNANCE */}
              <Route path="/data-governance" element={<DataGovernanceSection />} />
              <Route path="/settings" element={<AdminSettings />} />
              <Route path="/overrides" element={<AdminManualOverrides />} />
              {/* Legacy redirects */}
              <Route path="/users-orgs" element={<Navigate to={ROUTES.ADMIN_USERS} replace />} />
              <Route path="/infrastructure" element={<Navigate to={ROUTES.ADMIN_LEDGER} replace />} />
              {/* 404 */}
              <Route path="*" element={<AdminNotFound />} />
            </Routes>
          </main>
        </div>
        <AdminMobileNav />
      </div>
    </SidebarProvider>
  );
}

export default function Admin() {
  return (
    <RequireAuth role={["platform_admin", "admin"]}>
      <AdminContent />
    </RequireAuth>
  );
}
