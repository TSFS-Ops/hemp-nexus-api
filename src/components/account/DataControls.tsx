import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Download, Trash2, Loader2, AlertTriangle, Mail, Info } from "lucide-react";
import { toast } from "sonner";

const EXPORT_BATCH_SIZE = 500;

export function DataControls() {
  const { user } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");

  const handleExportData = async () => {
    setExporting(true);
    try {
      // Paginate through all user data
      const allMatches: any[] = [];
      const allLogs: any[] = [];

      // Fetch profile
      const profileRes = await supabase.from("profiles").select("*").eq("id", user?.id ?? "").maybeSingle();

      // Paginate matches
      let matchPage = 0;
      let hasMoreMatches = true;
      while (hasMoreMatches) {
        const from = matchPage * EXPORT_BATCH_SIZE;
        const to = from + EXPORT_BATCH_SIZE - 1;
        const { data, error } = await supabase
          .from("matches")
          .select("*")
          .range(from, to)
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (data && data.length > 0) {
          allMatches.push(...data);
          hasMoreMatches = data.length === EXPORT_BATCH_SIZE;
          matchPage++;
        } else {
          hasMoreMatches = false;
        }
      }

      // Paginate audit logs
      let logPage = 0;
      let hasMoreLogs = true;
      while (hasMoreLogs) {
        const from = logPage * EXPORT_BATCH_SIZE;
        const to = from + EXPORT_BATCH_SIZE - 1;
        const { data, error } = await supabase
          .from("audit_logs")
          .select("action, entity_type, entity_id, created_at, metadata")
          .range(from, to)
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (data && data.length > 0) {
          allLogs.push(...data);
          hasMoreLogs = data.length === EXPORT_BATCH_SIZE;
          logPage++;
        } else {
          hasMoreLogs = false;
        }
      }

      const exportData = {
        exported_at: new Date().toISOString(),
        user_email: user?.email,
        record_counts: {
          matches: allMatches.length,
          audit_logs: allLogs.length,
        },
        profile: profileRes.data,
        matches: allMatches,
        audit_logs: allLogs,
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trade-izenzo-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Data exported: ${allMatches.length} matches, ${allLogs.length} audit logs.`);
    } catch (err) {
      console.error("Export error:", err);
      toast.error("Failed to export data. Please try again or contact support@izenzo.co.za.");
    } finally {
      setExporting(false);
    }
  };

  const emailMatches = confirmEmail.trim().toLowerCase() === (user?.email ?? "").toLowerCase();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Download className="h-5 w-5" />Export Your Data</CardTitle>
          <CardDescription>Download a complete copy of your account data, matches, and audit history.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              This export includes all your matches and audit logs. Large accounts may take a moment to compile.
            </AlertDescription>
          </Alert>
          <Button onClick={handleExportData} disabled={exporting} variant="outline">
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            {exporting ? "Exporting all records…" : "Export Data (JSON)"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive"><Trash2 className="h-5 w-5" />Delete Account</CardTitle>
          <CardDescription>Permanently delete your account and all associated data. This action cannot be undone.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Account deletion is not yet available as a self-service action. To request account deletion, 
              please email <a href="mailto:support@izenzo.co.za" className="underline font-medium">support@izenzo.co.za</a> from 
              your registered email address. We will process your request within 30 days.
              Data subject to regulatory retention (7 years) will be anonymised rather than deleted.
            </AlertDescription>
          </Alert>
          <Button variant="outline" asChild>
            <a href={`mailto:support@izenzo.co.za?subject=Account%20Deletion%20Request&body=Please%20delete%20my%20account%20associated%20with%20${encodeURIComponent(user?.email ?? "")}.`}>
              <Mail className="h-4 w-4 mr-2" />
              Email support to request deletion
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
