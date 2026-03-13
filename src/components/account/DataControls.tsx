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
import { Download, Trash2, Loader2, AlertTriangle, Mail } from "lucide-react";
import { toast } from "sonner";

export function DataControls() {
  const { user } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");

  const handleExportData = async () => {
    setExporting(true);
    try {
      // Gather user's data from relevant tables
      const [profileRes, matchesRes, logsRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user?.id ?? "").maybeSingle(),
        supabase.from("matches").select("*").limit(500),
        supabase.from("audit_logs").select("action, entity_type, entity_id, created_at, metadata").limit(500),
      ]);

      const exportData = {
        exported_at: new Date().toISOString(),
        user_email: user?.email,
        profile: profileRes.data,
        matches: matchesRes.data || [],
        audit_logs: logsRes.data || [],
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
      toast.success("Data exported successfully");
    } catch (err) {
      console.error("Export error:", err);
      toast.error("Failed to export data");
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
          <CardDescription>Download a copy of your account data, matches, and audit history.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleExportData} disabled={exporting} variant="outline">
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Export Data (JSON)
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
