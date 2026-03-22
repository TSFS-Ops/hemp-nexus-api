import { Routes, Route, Link } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ROUTES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
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
import { AdminRiskSnapshotsPanel } from "@/components/admin/AdminRiskSnapshotsPanel";
import { AdminScreeningRunsPanel } from "@/components/admin/AdminScreeningRunsPanel";
import { AdminUboPanel } from "@/components/admin/AdminUboPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlTab } from "@/hooks/use-url-tab";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { useLocation, Navigate } from "react-router-dom";

/** Admin-level catch-all for unknown sub-routes */
function AdminNotFound() {
  return (
    <div className="p-6 text-center py-16">
      <p className="text-4xl font-bold text-muted-foreground/30 mb-3">404</p>
      <h2 className="text-lg font-semibold text-foreground mb-1">Admin page not found</h2>
      <p className="text-sm text-muted-foreground mb-4">This admin section doesn't exist.</p>
      <Button variant="outline" size="sm" asChild>
        <Link to={ROUTES.ADMIN}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Admin Overview
        </Link>
      </Button>
    </div>
  );
}

/** Deals: Pipeline + Matches + Approvals */
function DealsSection() {
  const [tab, setTab] = useUrlTab("tab", "pipeline", ["pipeline", "matches", "approvals"]);
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <Breadcrumbs items={[{ label: "Admin", href: ROUTES.ADMIN }, { label: "Deals" }]} />
      <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Deals</h2>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="matches">Matches</TabsTrigger>
            <TabsTrigger value="approvals">Approvals</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="pipeline" className="mt-4"><AdminDealPipelinePanel /></TabsContent>
        <TabsContent value="matches" className="mt-4"><AdminMatchesPanel /></TabsContent>
        <TabsContent value="approvals" className="mt-4"><AdminTradeApprovalsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

/** Users & Orgs: Users + Orgs + Entities */
function UsersOrgsSection() {
  const [tab, setTab] = useUrlTab("tab", "users", ["users", "orgs", "entities", "tokens"]);
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <Breadcrumbs items={[{ label: "Admin", href: ROUTES.ADMIN }, { label: "Users & Orgs" }]} />
      <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Users & Organisations</h2>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="orgs">Organisations</TabsTrigger>
            <TabsTrigger value="entities">Entities</TabsTrigger>
            <TabsTrigger value="tokens">Tokens</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="users" className="mt-4"><UsersManagement /></TabsContent>
        <TabsContent value="orgs" className="mt-4"><OrgsManagement /></TabsContent>
        <TabsContent value="entities" className="mt-4"><AdminEntitiesPanel /></TabsContent>
        <TabsContent value="tokens" className="mt-4"><AdminTokenManagement /></TabsContent>
      </Tabs>
    </div>
  );
}

/** Compliance: Cases + Risk */
function AdminComplianceSection() {
  const [tab, setTab] = useUrlTab("tab", "cases", ["cases", "disputes", "risk"]);
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <Breadcrumbs items={[{ label: "Admin", href: ROUTES.ADMIN }, { label: "Compliance" }]} />
      <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Compliance</h2>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="cases">Cases</TabsTrigger>
            <TabsTrigger value="disputes">Disputes</TabsTrigger>
            <TabsTrigger value="risk">Risk Register</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="cases" className="mt-4"><AdminComplianceCasesPanel /></TabsContent>
        <TabsContent value="disputes" className="mt-4"><AdminDisputesPanel /></TabsContent>
        <TabsContent value="risk" className="mt-4"><AdminRiskPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

/** Audit: Logs + POI History + Collapse Ledger + API Logs */
function AuditSection() {
  const [tab, setTab] = useUrlTab("tab", "audit", ["audit", "poi", "ledger", "api"]);
  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <Breadcrumbs items={[{ label: "Admin", href: ROUTES.ADMIN }, { label: "Audit" }]} />
      <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Audit Trail</h2>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="audit">Audit Logs</TabsTrigger>
            <TabsTrigger value="poi">POI History</TabsTrigger>
            <TabsTrigger value="ledger">Collapse Ledger</TabsTrigger>
            <TabsTrigger value="api">API Logs</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="audit" className="mt-4"><AdminAuditLogs /></TabsContent>
        <TabsContent value="poi" className="mt-4"><PoiStateHistory /></TabsContent>
        <TabsContent value="ledger" className="mt-4"><CollapseLedgerViewer /></TabsContent>
        <TabsContent value="api" className="mt-4"><GlobalApiLogs /></TabsContent>
      </Tabs>
    </div>
  );
}

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
              <h1 className="text-base sm:text-lg font-semibold truncate">Admin</h1>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to={ROUTES.DASHBOARD}>
                <ArrowLeft className="h-4 w-4 mr-1 sm:mr-2" />
                <span className="hidden xs:inline">Console</span>
              </Link>
            </Button>
          </header>
          <main className="flex-1 overflow-auto">
            <Routes>
              <Route path="/" element={<AdminOverview />} />
              <Route path="/deals" element={<DealsSection />} />
              <Route path="/users-orgs" element={<UsersOrgsSection />} />
              <Route path="/compliance" element={<AdminComplianceSection />} />
              <Route path="/audit" element={<AuditSection />} />
              <Route path="/api-keys" element={<AdminApiKeys />} />
              <Route path="/overrides" element={<AdminManualOverrides />} />
              <Route path="/settings" element={<AdminSettings />} />
              <Route path="*" element={<AdminNotFound />} />
            </Routes>
          </main>
        </div>
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
