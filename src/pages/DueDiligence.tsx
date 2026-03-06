import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  FileCheck,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Users,
  Search,
  BarChart3,
  ClipboardCheck,
  RefreshCw,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { BackButton } from "@/components/BackButton";
import { getDossier, runScreening, computeRiskScore, submitForApproval, approveOrReject } from "@/lib/modules/due-diligence";
import type { Dossier, RiskScore } from "@/lib/modules/due-diligence";

const RISK_BAND_COLOURS: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  critical: "bg-destructive/10 text-destructive",
};

const TRADE_STATUS_COLOURS: Record<string, string> = {
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  not_approved: "bg-muted text-muted-foreground",
  suspended: "bg-destructive/10 text-destructive",
};

export default function DueDiligence() {
  const navigate = useNavigate();
  const [orgId, setOrgId] = useState("");
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [cases, setCases] = useState<any[]>([]);
  const [casesLoading, setCasesLoading] = useState(true);

  useEffect(() => {
    loadCases();
  }, []);

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  };

  const loadCases = async () => {
    try {
      setCasesLoading(true);
      const { data, error } = await supabase
        .from("trade_approvals")
        .select("*")
        .order("created_at", { ascending: false });
      
      // Also get orgs that have kyc_status
      const { data: kycOrgs } = await supabase
        .from("kyc_status")
        .select("org_id, status, completeness_percentage");

      const allOrgIds = new Set([
        ...(data || []).map((t: any) => t.org_id),
        ...(kycOrgs || []).map((k: any) => k.org_id),
      ]);

      const caseList = Array.from(allOrgIds).map(id => {
        const trade = (data || []).find((t: any) => t.org_id === id);
        const kyc = (kycOrgs || []).find((k: any) => k.org_id === id);
        return {
          org_id: id,
          trade_status: trade?.status || "not_approved",
          kyc_status: kyc?.status || "unknown",
          kyc_completeness: kyc?.completeness_percentage || 0,
          approved_at: trade?.approved_at,
        };
      });

      setCases(caseList);
    } catch (err) {
      console.error("Failed to load cases:", err);
    } finally {
      setCasesLoading(false);
    }
  };

  const loadDossier = async (targetOrgId?: string) => {
    const target = targetOrgId || orgId;
    if (!target.trim()) {
      toast.error("Please enter an organisation ID");
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      const data = await getDossier(target, token);
      setDossier(data);
      setOrgId(target);
    } catch (err: any) {
      toast.error(err.message || "Failed to load dossier");
    } finally {
      setLoading(false);
    }
  };

  const handleRunScreening = async () => {
    if (!dossier) return;
    setActionLoading("screening");
    try {
      const token = await getToken();
      await runScreening(dossier.org_id, token);
      toast.success("Screening completed");
      await loadDossier(dossier.org_id);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoading("");
    }
  };

  const handleComputeScore = async () => {
    if (!dossier) return;
    setActionLoading("score");
    try {
      const token = await getToken();
      await computeRiskScore(dossier.org_id, token);
      toast.success("Risk score computed");
      await loadDossier(dossier.org_id);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoading("");
    }
  };

  const handleSubmitApproval = async () => {
    if (!dossier) return;
    setActionLoading("submit");
    try {
      const token = await getToken();
      await submitForApproval(dossier.org_id, token);
      toast.success("Submitted for approval");
      await loadDossier(dossier.org_id);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoading("");
    }
  };

  const handleApproveReject = async (requestId: string, decision: "approve" | "reject") => {
    setActionLoading(`${decision}-${requestId}`);
    try {
      const token = await getToken();
      const result = await approveOrReject(requestId, decision, token);
      toast.success(decision === "approve" ? "Approved" : "Rejected");
      if (dossier) await loadDossier(dossier.org_id);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setActionLoading("");
    }
  };

  const latestScore: RiskScore | null = dossier?.risk_scores?.[0] || null;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center gap-4">
        <BackButton fallback="/dashboard" label="Dashboard" />
        <div>
          <h1 className="text-2xl font-bold">Due Diligence Workspace</h1>
          <p className="text-sm text-muted-foreground">Counterparty enablement & eligibility</p>
        </div>
      </div>

      {/* Case List */}
      {!dossier && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Enter organisation ID to open dossier"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadDossier()}
              className="font-mono text-sm"
              aria-label="Organisation ID"
            />
            <Button onClick={() => loadDossier()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Active Cases
              </CardTitle>
            </CardHeader>
            <CardContent>
              {casesLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : cases.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No due diligence cases found. Enter an organisation ID above to start.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organisation ID</TableHead>
                      <TableHead>KYC Status</TableHead>
                      <TableHead>Trade Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cases.map((c) => (
                      <TableRow key={c.org_id}>
                        <TableCell className="font-mono text-sm">{c.org_id.substring(0, 12)}...</TableCell>
                        <TableCell>
                          <Badge variant="outline">{c.kyc_status} ({Math.round(c.kyc_completeness)}%)</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={TRADE_STATUS_COLOURS[c.trade_status] || ""} variant="outline">
                            {c.trade_status === "approved" ? "Approved to Trade" : c.trade_status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => loadDossier(c.org_id)}>
                            Open Dossier
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Dossier View */}
      {dossier && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => setDossier(null)}>
              ← Back to Cases
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-mono">{dossier.org_id.substring(0, 16)}...</span>
              <Badge className={TRADE_STATUS_COLOURS[dossier.trade_approval?.status] || ""} variant="outline">
                {dossier.trade_approval?.status === "approved" ? "✓ Approved to Trade" : dossier.trade_approval?.status || "Not Approved"}
              </Badge>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="overview" className="flex items-center gap-1 text-xs">
                <Building2 className="h-3.5 w-3.5" /> Overview
              </TabsTrigger>
              <TabsTrigger value="kyc" className="flex items-center gap-1 text-xs">
                <FileCheck className="h-3.5 w-3.5" /> KYC
              </TabsTrigger>
              <TabsTrigger value="screening" className="flex items-center gap-1 text-xs">
                <Shield className="h-3.5 w-3.5" /> Screening
              </TabsTrigger>
              <TabsTrigger value="risk" className="flex items-center gap-1 text-xs">
                <BarChart3 className="h-3.5 w-3.5" /> Risk
              </TabsTrigger>
              <TabsTrigger value="approvals" className="flex items-center gap-1 text-xs">
                <ClipboardCheck className="h-3.5 w-3.5" /> Approvals
              </TabsTrigger>
            </TabsList>

            {/* OVERVIEW TAB */}
            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">KYC Completeness</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {Math.round(dossier.kyc_status?.completeness_percentage || 0)}%
                    </div>
                    <Badge variant="outline" className="mt-1">
                      {dossier.kyc_status?.status || "incomplete"}
                    </Badge>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Risk Score</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {latestScore ? Math.round(latestScore.score) : "—"}
                    </div>
                    {latestScore && (
                      <Badge className={RISK_BAND_COLOURS[latestScore.risk_band] || ""} variant="outline">
                        {latestScore.risk_band}
                      </Badge>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Directors / UBOs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{dossier.directors.length}</div>
                    <span className="text-sm text-muted-foreground">
                      {dossier.directors.filter((d: any) => d.is_pep).length} PEP
                    </span>
                  </CardContent>
                </Card>
              </div>

              {/* Directors list */}
              {dossier.directors.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Users className="h-4 w-4" /> Directors & UBOs
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Nationality</TableHead>
                          <TableHead>Ownership</TableHead>
                          <TableHead>PEP</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dossier.directors.map((d: any) => (
                          <TableRow key={d.id}>
                            <TableCell className="font-medium">{d.full_name}</TableCell>
                            <TableCell>{d.role}</TableCell>
                            <TableCell>{d.nationality || "—"}</TableCell>
                            <TableCell>{d.ownership_percentage ? `${d.ownership_percentage}%` : "—"}</TableCell>
                            <TableCell>
                              {d.is_pep ? (
                                <Badge className="bg-orange-100 text-orange-800" variant="outline">PEP</Badge>
                              ) : (
                                <span className="text-muted-foreground">No</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* KYC TAB */}
            <TabsContent value="kyc" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">KYC Documents</CardTitle>
                </CardHeader>
                <CardContent>
                  {dossier.kyc_documents.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No KYC documents uploaded yet.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Document Type</TableHead>
                          <TableHead>Filename</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Country</TableHead>
                          <TableHead>Expiry</TableHead>
                          <TableHead>Uploaded</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dossier.kyc_documents.map((doc: any) => (
                          <TableRow key={doc.id}>
                            <TableCell className="font-medium">{doc.doc_type}</TableCell>
                            <TableCell className="text-sm">{doc.filename}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{doc.status}</Badge>
                            </TableCell>
                            <TableCell>{doc.issuing_country || "—"}</TableCell>
                            <TableCell>
                              {doc.expiry_date ? new Date(doc.expiry_date).toLocaleDateString("en-GB") : "—"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {new Date(doc.created_at).toLocaleDateString("en-GB")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* SCREENING TAB */}
            <TabsContent value="screening" className="space-y-4">
              <div className="flex justify-end">
                <Button onClick={handleRunScreening} disabled={actionLoading === "screening"}>
                  {actionLoading === "screening" ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Run Screening
                </Button>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Screening Results</CardTitle>
                </CardHeader>
                <CardContent>
                  {dossier.screening_results.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No screenings run yet.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Matches</TableHead>
                          <TableHead>Screened At</TableHead>
                          <TableHead>Next Screening</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dossier.screening_results.map((s: any) => (
                          <TableRow key={s.id}>
                            <TableCell className="font-medium capitalize">{s.screening_type}</TableCell>
                            <TableCell>
                              {s.status === "clear" ? (
                                <Badge className="bg-green-100 text-green-800" variant="outline">
                                  <CheckCircle2 className="h-3 w-3 mr-1" /> Clear
                                </Badge>
                              ) : (
                                <Badge className="bg-destructive/10 text-destructive" variant="outline">
                                  <AlertTriangle className="h-3 w-3 mr-1" /> Match
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {(s.matched_entities || []).length > 0 ? (
                                <span className="text-sm">{(s.matched_entities as any[]).map((e: any) => e.name || e.matched_against).join(", ")}</span>
                              ) : "—"}
                            </TableCell>
                            <TableCell className="text-sm">{new Date(s.screened_at).toLocaleString("en-GB")}</TableCell>
                            <TableCell className="text-sm">
                              {s.next_screening_at ? new Date(s.next_screening_at).toLocaleDateString("en-GB") : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* RISK TAB */}
            <TabsContent value="risk" className="space-y-4">
              <div className="flex justify-end">
                <Button onClick={handleComputeScore} disabled={actionLoading === "score"}>
                  {actionLoading === "score" ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <BarChart3 className="h-4 w-4 mr-2" />
                  )}
                  Compute Risk Score
                </Button>
              </div>

              {latestScore && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">Latest Risk Assessment</CardTitle>
                      <Badge className={RISK_BAND_COLOURS[latestScore.risk_band] || ""} variant="outline">
                        Score: {Math.round(latestScore.score)} — {latestScore.risk_band.toUpperCase()}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Factor</TableHead>
                          <TableHead>Weight</TableHead>
                          <TableHead>Value</TableHead>
                          <TableHead>Contribution</TableHead>
                          <TableHead>Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(latestScore.factors || []).map((f: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium capitalize">{f.factor.replace(/_/g, " ")}</TableCell>
                            <TableCell>{(f.weight * 100).toFixed(0)}%</TableCell>
                            <TableCell>{Math.round(f.value)}</TableCell>
                            <TableCell>{Math.round(f.contribution)}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{f.reason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* APPROVALS TAB */}
            <TabsContent value="approvals" className="space-y-4">
              <div className="flex justify-end">
                <Button onClick={handleSubmitApproval} disabled={actionLoading === "submit"}>
                  {actionLoading === "submit" ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Submit for Approval
                </Button>
              </div>

              {dossier.approval_requests.length === 0 ? (
                <Card>
                  <CardContent className="py-8">
                    <p className="text-sm text-muted-foreground text-center">No approval requests yet.</p>
                  </CardContent>
                </Card>
              ) : (
                dossier.approval_requests.map((req: any) => (
                  <Card key={req.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">
                          Approval Request
                          <span className="ml-2 font-mono text-xs text-muted-foreground">{req.id.substring(0, 8)}</span>
                        </CardTitle>
                        <Badge variant="outline" className={
                          req.status === "approved" ? "bg-green-100 text-green-800" :
                          req.status === "rejected" ? "bg-destructive/10 text-destructive" :
                          "bg-yellow-100 text-yellow-800"
                        }>
                          {req.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Required Roles:</span>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {(req.required_roles || []).map((r: string) => (
                              <Badge key={r} variant="outline" className="text-xs">
                                {r.replace(/_/g, " ")}
                                {(req.completed_roles || []).includes(r) && (
                                  <CheckCircle2 className="h-3 w-3 ml-1 text-green-600" />
                                )}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Created:</span>
                          <p>{new Date(req.created_at).toLocaleString("en-GB")}</p>
                        </div>
                      </div>

                      {/* Approval actions history */}
                      {req.dd_approval_actions && req.dd_approval_actions.length > 0 && (
                        <div className="border-t pt-2">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Audit History</p>
                          {req.dd_approval_actions.map((a: any) => (
                            <div key={a.id} className="text-xs flex items-center gap-2 py-1">
                              {a.action === "approve" ? (
                                <CheckCircle2 className="h-3 w-3 text-green-600" />
                              ) : (
                                <XCircle className="h-3 w-3 text-destructive" />
                              )}
                              <span className="font-medium capitalize">{a.actor_role.replace(/_/g, " ")}</span>
                              <span className="text-muted-foreground">—</span>
                              <span>{a.action}</span>
                              {a.reason && <span className="text-muted-foreground">({a.reason})</span>}
                              <span className="text-muted-foreground ml-auto">
                                {new Date(a.created_at).toLocaleString("en-GB")}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {req.status === "pending" && (
                        <div className="flex gap-2 pt-2">
                          <Button
                            size="sm"
                            onClick={() => handleApproveReject(req.id, "approve")}
                            disabled={actionLoading === `approve-${req.id}`}
                          >
                            {actionLoading === `approve-${req.id}` ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : (
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                            )}
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleApproveReject(req.id, "reject")}
                            disabled={actionLoading === `reject-${req.id}`}
                          >
                            {actionLoading === `reject-${req.id}` ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : (
                              <XCircle className="h-3 w-3 mr-1" />
                            )}
                            Reject
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
