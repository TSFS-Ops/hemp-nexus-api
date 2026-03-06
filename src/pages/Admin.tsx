import { useState, useEffect } from "react";
import { useNavigate, Routes, Route, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ROUTES } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, ArrowLeft } from "lucide-react";
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

/** Deals: Pipeline + Matches + Approvals */
function DealsSection() {
  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Deals</h2>
      <Tabs defaultValue="pipeline">
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
  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Users & Organisations</h2>
      <Tabs defaultValue="users">
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
function ComplianceSection() {
  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Compliance</h2>
      <Tabs defaultValue="cases">
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
  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">Audit Trail</h2>
      <Tabs defaultValue="audit">
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

export default function Admin() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const checkAdminAccess = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!session) { navigate(ROUTES.AUTH); return; }

        const { data, error } = await supabase.rpc('is_admin', { user_id: session.user.id });
        if (cancelled) return;
        if (error) throw error;
        if (!data) {
          toast.error("Access denied", { description: "You do not have admin privileges." });
          navigate(ROUTES.DASHBOARD);
          return;
        }
        setIsAdmin(true);
      } catch (error) {
        if (cancelled) return;
        console.error("Admin check error:", error);
        toast.error("Failed to verify admin access");
        navigate(ROUTES.DASHBOARD);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    checkAdminAccess();
    return () => { cancelled = true; };
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Shield className="h-12 w-12 animate-pulse mx-auto text-primary" />
        <p className="text-muted-foreground ml-3">Verifying access…</p>
      </div>
    );
  }

  if (!isAdmin) return null;

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
              <Route path="/compliance" element={<ComplianceSection />} />
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
