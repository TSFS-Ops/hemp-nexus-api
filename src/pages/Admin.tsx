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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlTab } from "@/hooks/use-url-tab";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { useLocation } from "react-router-dom";

/** Deals: Pipeline + Matches + Approvals */
function DealsSection() {
  const [tab, setTab] = useUrlTab("tab", "pipeline", ["pipeline", "matches", "approvals"]);
  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Admin", href: ROUTES.ADMIN }, { label: "Deals" }]} />
      <h2 className="text-2xl font-bold tracking-tight">Deals</h2>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="matches">Matches</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
        </TabsList>
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
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Admin", href: ROUTES.ADMIN }, { label: "Users & Orgs" }]} />
      <h2 className="text-2xl font-bold tracking-tight">Users & Organisations</h2>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="orgs">Organisations</TabsTrigger>
          <TabsTrigger value="entities">Entities</TabsTrigger>
          <TabsTrigger value="tokens">Tokens</TabsTrigger>
        </TabsList>
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
  const [tab, setTab] = useUrlTab("tab", "cases", ["cases", "risk"]);
  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Admin", href: ROUTES.ADMIN }, { label: "Compliance" }]} />
      <h2 className="text-2xl font-bold tracking-tight">Compliance</h2>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="cases">Cases</TabsTrigger>
          <TabsTrigger value="risk">Risk Register</TabsTrigger>
        </TabsList>
        <TabsContent value="cases" className="mt-4"><AdminComplianceCasesPanel /></TabsContent>
        <TabsContent value="risk" className="mt-4"><AdminRiskPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

/** Audit: Logs + POI History + Collapse Ledger + API Logs */
function AuditSection() {
  const [tab, setTab] = useUrlTab("tab", "audit", ["audit", "poi", "ledger", "api"]);
  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "Admin", href: ROUTES.ADMIN }, { label: "Audit" }]} />
      <h2 className="text-2xl font-bold tracking-tight">Audit Trail</h2>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="audit">Audit Logs</TabsTrigger>
          <TabsTrigger value="poi">POI History</TabsTrigger>
          <TabsTrigger value="ledger">Collapse Ledger</TabsTrigger>
          <TabsTrigger value="api">API Logs</TabsTrigger>
        </TabsList>
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
      <div className="min-h-screen flex w-full">
        <AdminSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-14 border-b flex items-center px-4 bg-background justify-between">
            <div className="flex items-center">
              <SidebarTrigger />
              <h1 className="ml-4 text-lg font-semibold">Admin</h1>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to={ROUTES.DASHBOARD}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Console
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
