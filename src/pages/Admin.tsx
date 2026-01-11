import { useState, useEffect } from "react";
import { useNavigate, Routes, Route, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Shield, ArrowLeft } from "lucide-react";
import UsersManagement from "@/components/admin/UsersManagement";
import OrgsManagement from "@/components/admin/OrgsManagement";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminOverview } from "@/components/admin/AdminOverview";
import { GlobalApiLogs } from "@/components/admin/GlobalApiLogs";
import { AdminApiKeys } from "@/components/admin/AdminApiKeys";
import { AdminSettings } from "@/components/admin/AdminSettings";
import { AdminRiskPanel } from "@/components/admin/AdminRiskPanel";
import { AdminMatchesPanel } from "@/components/admin/AdminMatchesPanel";
import { AdminSignalsPanel } from "@/components/admin/AdminSignalsPanel";
import { AdminCoherencePanel } from "@/components/admin/AdminCoherencePanel";
import { AdminBehavioralAnalytics } from "@/components/admin/AdminBehavioralAnalytics";
import { AdminAuditLogs } from "@/components/admin/AdminAuditLogs";
import { AdminDiscoveryMetrics } from "@/components/admin/AdminDiscoveryMetrics";
import { AdminTokenManagement } from "@/components/admin/AdminTokenManagement";

export default function Admin() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    checkAdminAccess();
  }, []);

  const checkAdminAccess = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate("/auth");
        return;
      }

      // Check if user has admin role
      const { data, error } = await supabase.rpc('is_admin', {
        user_id: session.user.id
      });

      if (error) throw error;

      if (!data) {
        toast({
          title: "Access Denied",
          description: "You do not have admin privileges",
          variant: "destructive",
        });
        navigate("/dashboard");
        return;
      }

      setIsAdmin(true);
    } catch (error) {
      console.error("Admin check error:", error);
      toast({
        title: "Error",
        description: "Failed to verify admin access",
        variant: "destructive",
      });
      navigate("/dashboard");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Shield className="h-12 w-12 animate-pulse mx-auto text-primary" />
          <p className="text-muted-foreground">Verifying admin access...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AdminSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-14 border-b flex items-center px-4 bg-background justify-between">
            <div className="flex items-center">
              <SidebarTrigger />
              <div className="ml-4">
                <h1 className="text-lg font-semibold">API Platform Admin</h1>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Link>
            </Button>
          </header>
          <main className="flex-1 overflow-auto">
            <Routes>
              <Route path="/" element={<AdminOverview />} />
              <Route path="/logs" element={<GlobalApiLogs />} />
              <Route path="/api-keys" element={<AdminApiKeys />} />
              <Route path="/matches" element={<AdminMatchesPanel />} />
              <Route path="/signals" element={<AdminSignalsPanel />} />
              <Route path="/coherence" element={<AdminCoherencePanel />} />
              <Route path="/discovery" element={<AdminDiscoveryMetrics />} />
              <Route path="/behavioral" element={<AdminBehavioralAnalytics />} />
              <Route path="/audit" element={<AdminAuditLogs />} />
              <Route path="/tokens" element={<AdminTokenManagement />} />
              <Route
                path="/users-orgs"
                element={
                  <div className="p-6 space-y-6">
                    <div>
                      <h2 className="text-3xl font-bold tracking-tight">Users & Organizations</h2>
                      <p className="text-muted-foreground mt-2">
                        Manage user accounts and organizations
                      </p>
                    </div>
                    <UsersManagement />
                    <OrgsManagement />
                  </div>
                }
              />
              <Route
                path="/settings"
                element={<AdminSettings />}
              />
              <Route
                path="/risk"
                element={
                  <div className="p-6">
                    <AdminRiskPanel />
                  </div>
                }
              />
            </Routes>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
