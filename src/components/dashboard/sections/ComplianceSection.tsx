import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Clock, AlertTriangle, XCircle, Shield, FileText, Globe, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/error-state";
import { SectionHeader } from "@/components/ui/section-header";
import { format } from "date-fns";

interface Entity {
  id: string;
  legal_name: string;
  entity_type: string;
  status: string;
  jurisdiction_code: string;
  registration_number: string | null;
  created_at: string;
}

interface ScreeningResult {
  id: string;
  entity_id: string;
  screening_type: string;
  provider: string;
  status: string;
  screened_at: string;
}

export function ComplianceSection() {
  const { user } = useAuth();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [screenings, setScreenings] = useState<ScreeningResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    fetchComplianceData();
  }, [user]);

  const fetchComplianceData = async () => {
    setFetchError(null);
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user?.id ?? "")
        .maybeSingle();

      if (!profile?.org_id) return;
      setOrgId(profile.org_id);

      const [entitiesRes, screeningsRes] = await Promise.all([
        supabase.from("entities").select("*").eq("org_id", profile.org_id).order("created_at", { ascending: false }),
        supabase.from("screening_results").select("id, entity_id, screening_type, provider, status, screened_at").eq("org_id", profile.org_id).order("screened_at", { ascending: false }).limit(50),
      ]);

      if (entitiesRes.error) throw entitiesRes.error;
      if (screeningsRes.error) throw screeningsRes.error;

      setEntities(entitiesRes.data || []);
      setScreenings((screeningsRes.data as ScreeningResult[]) || []);
    } catch (err) {
      console.error("[ComplianceSection] fetch failed:", err);
      setFetchError(err instanceof Error ? err.message : "Failed to load compliance data");
    } finally {
      setLoading(false);
    }
  };

  const statusIcon = (status: string) => {
    switch (status.toUpperCase()) {
      case "VERIFIED": return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case "PENDING": return <Clock className="h-4 w-4 text-amber-600" />;
      case "FAILED": return <XCircle className="h-4 w-4 text-destructive" />;
      default: return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const statusBadge = (status: string) => {
    const upper = status.toUpperCase();
    const variant = upper === "VERIFIED" ? "default" : upper === "PENDING" ? "secondary" : "destructive";
    return <Badge variant={variant}>{upper}</Badge>;
  };

  const verifiedCount = entities.filter(e => e.status.toUpperCase() === "VERIFIED").length;
  const completionPct = entities.length > 0 ? Math.round((verifiedCount / entities.length) * 100) : 0;

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (fetchError) {
    return (
      <div className="space-y-6">
        <SectionHeader
          title="Compliance Status"
          description="Your organisation's KYC/KYB verification status"
        />
        <ErrorState
          title="Failed to load compliance data"
          message={fetchError}
          type="server"
          onRetry={fetchComplianceData}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Compliance Status"
        description="Your organisation's KYC/KYB verification status, screening results, and compliance documents."
        action={<Button variant="outline" size="sm" onClick={fetchComplianceData}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button>}
      />

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Entity Verification</span>
              <span className="text-sm text-muted-foreground">{verifiedCount}/{entities.length}</span>
            </div>
            <Progress value={completionPct} className="h-2" />
            <p className="text-xs text-muted-foreground mt-2">{completionPct}% complete</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <Shield className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Screenings Run</p>
              <p className="text-2xl font-bold">{screenings.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <Globe className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Jurisdictions</p>
              <p className="text-2xl font-bold">{[...new Set(entities.map(e => e.jurisdiction_code))].length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="entities">
        <TabsList>
          <TabsTrigger value="entities">Entities & KYB</TabsTrigger>
          <TabsTrigger value="screening">Screening Results</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="entities" className="mt-4">
          {entities.length === 0 ? (
            <Alert>
              <FileText className="h-4 w-4" />
              <AlertDescription>
                No entities registered yet. Entities are created during the onboarding process or via the API.
              </AlertDescription>
            </Alert>
          ) : (
            <Card>
              <CardContent className="pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Legal Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Jurisdiction</TableHead>
                      <TableHead>Reg Number</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entities.map(e => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{e.legal_name}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{e.entity_type}</Badge></TableCell>
                        <TableCell>{e.jurisdiction_code}</TableCell>
                        <TableCell className="text-sm font-mono">{e.registration_number || "—"}</TableCell>
                        <TableCell>{statusBadge(e.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="screening" className="mt-4">
          {screenings.length === 0 ? (
            <Alert>
              <Shield className="h-4 w-4" />
              <AlertDescription>
                No screening results available. Sanctions and PEP screenings are performed automatically during entity verification.
              </AlertDescription>
            </Alert>
          ) : (
            <Card>
              <CardContent className="pt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entity</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Screened</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {screenings.map(s => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs">{s.entity_id.slice(0, 8)}…</TableCell>
                        <TableCell>{s.screening_type}</TableCell>
                        <TableCell>{s.provider}</TableCell>
                        <TableCell>{statusBadge(s.status)}</TableCell>
                        <TableCell className="text-xs">{format(new Date(s.screened_at), "dd MMM yyyy")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Document Collection Centre</CardTitle>
              <CardDescription>
                Upload and manage compliance documents. Documents uploaded here are available across all your trade workflows.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Alert>
                <FileText className="h-4 w-4" />
                <AlertDescription>
                  Documents are managed per-match in the match detail view. Navigate to a specific match to upload supporting documents, certificates, and compliance evidence.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
