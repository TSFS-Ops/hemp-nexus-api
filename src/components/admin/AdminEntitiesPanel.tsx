import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { apiFetch } from "@/lib/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Building2, User, Search, ShieldCheck, AlertTriangle, RefreshCw, Loader2, LinkIcon, Link2 } from "lucide-react";
import { toast } from "sonner";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { TruncationBanner } from "@/components/ui/truncation-banner";
import { StatusBadge } from "@/components/ui/status-badge";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { ErrorState } from "@/components/ui/error-state";
import { AuthorityBindDialog } from "./AuthorityBindDialog";

interface Entity {
  id: string;
  entity_type: string;
  legal_name: string;
  jurisdiction_code: string;
  registration_number: string | null;
  tax_number: string | null;
  org_id: string;
  status: string;
  created_at: string;
}

export function AdminEntitiesPanel() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [screeningEntity, setScreeningEntity] = useState<string | null>(null);
  const [verifyingEntity, setVerifyingEntity] = useState<string | null>(null);
  const [bindDialogOpen, setBindDialogOpen] = useState(false);
  const [bindTarget, setBindTarget] = useState<Entity | null>(null);

  const { data: entities = [], isLoading, isError, refetch, isTruncated, totalCount, queryLimit } = useSupabaseList<Entity>("entities", {
    limit: 200,
    queryKeyExtra: [statusFilter, typeFilter],
    filters: (q) => {
      let query = q;
      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (typeFilter !== "all") query = query.eq("entity_type", typeFilter);
      return query;
    },
  });

  const runScreening = async (entityId: string) => {
    setScreeningEntity(entityId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Check if a real screening provider is configured
      const dilisenseConfigured = true; // DILISENSE_API_KEY is set in edge function secrets
      if (!dilisenseConfigured) {
        toast.error("No screening provider configured. Contact platform admin to set up Dilisense or another provider.");
        return;
      }

      const resp = await apiFetch<any>("dilisense-screen", {
        method: "POST",
        body: JSON.stringify({ entity_id: entityId }),
      });

      toast.success("Screening completed");
      refetch();
    } catch (err) {
      console.error("Screening error:", err);
      toast.error("Screening failed - check provider configuration");
    } finally {
      setScreeningEntity(null);
    }
  };

  const verifyUbo = async (entityId: string) => {
    setVerifyingEntity(entityId);
    try {
      const resp = await apiFetch<any>("ubo-verify", {
        method: "POST",
        body: JSON.stringify({ entity_id: entityId }),
      });

      const result = resp;
      if (result?.verification === "not_applicable") {
        toast.info("Individual entities do not require UBO verification.");
        return;
      }

      if (result?.is_complete && result?.all_verified) {
        toast.success(`UBO verified - ${result.total_ownership_pct}% ownership confirmed across ${result.max_depth} layers.`);
      } else if (result?.escalation_required) {
        toast.warning(`Escalation required: ${result.escalation_reason}`);
      } else {
        toast.warning(`UBO incomplete - ${result?.total_ownership_pct ?? 0}% of 100% verified. Add missing UBO links.`);
      }
      refetch();
    } catch (err) {
      console.error("UBO verify error:", err);
      toast.error("UBO verification failed");
    } finally {
      setVerifyingEntity(null);
    }
  };

  const filtered = entities.filter((e) => {
    if (!searchTerm) return true;
    return (
      e.legal_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.id.includes(searchTerm)
    );
  });

  const stats = {
    total: entities.length,
    active: entities.filter((e) => e.status === "active").length,
    suspended: entities.filter((e) => e.status === "suspended").length,
    companies: entities.filter((e) => e.entity_type === "COMPANY").length,
    individuals: entities.filter((e) => e.entity_type === "INDIVIDUAL").length,
  };

  if (isError) {
    return <ErrorState title="Failed to load entities" onRetry={refetch} />;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Entity Management</h2>
        <p className="text-muted-foreground mt-1">
          Manage legal entities across all organisations with screening capabilities
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "Total", value: stats.total, icon: Building2 },
          { label: "Active", value: stats.active, icon: ShieldCheck },
          { label: "Suspended", value: stats.suspended, icon: AlertTriangle },
          { label: "Companies", value: stats.companies, icon: Building2 },
          { label: "Individuals", value: stats.individuals, icon: User },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-bold">{s.value}</p>
                </div>
                <s.icon className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
      <CardHeader className="pb-3">
          <CardTitle className="text-lg">Entities</CardTitle>
          <CardDescription>
            All registered legal entities across the platform
          </CardDescription>
          <TruncationBanner data={entities} totalCount={isTruncated ? totalCount : undefined} limit={queryLimit} />
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or ID…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                aria-label="Search entities"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]" aria-label="Filter by status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[140px]" aria-label="Filter by type">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="COMPANY">Company</SelectItem>
                <SelectItem value="INDIVIDUAL">Individual</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => refetch()} aria-label="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {isLoading ? (
            <TableSkeleton rows={5} columns={7} />
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No entities found</p>
          ) : (
            <>
              {/* Mobile card view */}
              <div className="space-y-3 md:hidden">
                {filtered.map((entity) => (
                  <div key={entity.id} className="border rounded-md p-3 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{entity.legal_name}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <Badge variant="outline" className="text-[10px]">
                            {entity.entity_type === "COMPANY" ? (
                              <Building2 className="h-2.5 w-2.5 mr-0.5" />
                            ) : (
                              <User className="h-2.5 w-2.5 mr-0.5" />
                            )}
                            {entity.entity_type}
                          </Badge>
                          <span className="font-mono text-[10px] text-muted-foreground">{entity.jurisdiction_code}</span>
                          <StatusBadge status={entity.status} />
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Reg. No.</span>
                        <p className="truncate">{entity.registration_number || "-"}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Created</span>
                        <p>{new Date(entity.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 min-w-[100px] h-9 touch-target"
                        onClick={() => runScreening(entity.id)}
                        disabled={screeningEntity === entity.id || entity.status === "archived"}
                      >
                        {screeningEntity === entity.id ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <ShieldCheck className="h-3 w-3 mr-1" />
                        )}
                        Screen
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 min-w-[100px] h-9 touch-target"
                        onClick={() => verifyUbo(entity.id)}
                        disabled={verifyingEntity === entity.id || entity.status === "archived"}
                      >
                        {verifyingEntity === entity.id ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <LinkIcon className="h-3 w-3 mr-1" />
                        )}
                        UBO
                      </Button>
                      {entity.entity_type === "COMPANY" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 min-w-[100px] h-9 touch-target"
                          onClick={() => {
                            setBindTarget(entity);
                            setBindDialogOpen(true);
                          }}
                          disabled={entity.status === "archived"}
                        >
                          <Link2 className="h-3 w-3 mr-1" />
                          Bind ATB
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table view */}
              <div className="overflow-x-auto hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Legal Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Jurisdiction</TableHead>
                      <TableHead>Reg. No.</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Screening</TableHead>
                      <TableHead className="text-right">UBO</TableHead>
                      <TableHead className="text-right">ATB</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((entity) => (
                      <TableRow key={entity.id}>
                        <TableCell className="font-medium max-w-[200px] truncate">
                          {entity.legal_name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {entity.entity_type === "COMPANY" ? (
                              <Building2 className="h-3 w-3 mr-1" />
                            ) : (
                              <User className="h-3 w-3 mr-1" />
                            )}
                            {entity.entity_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{entity.jurisdiction_code}</TableCell>
                        <TableCell className="text-xs">{entity.registration_number || "-"}</TableCell>
                        <TableCell>
                          <StatusBadge status={entity.status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(entity.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => runScreening(entity.id)}
                            disabled={screeningEntity === entity.id || entity.status === "archived"}
                          >
                            {screeningEntity === entity.id ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : (
                              <ShieldCheck className="h-3 w-3 mr-1" />
                            )}
                            Screen
                          </Button>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => verifyUbo(entity.id)}
                            disabled={verifyingEntity === entity.id || entity.status === "archived"}
                          >
                            {verifyingEntity === entity.id ? (
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            ) : (
                              <LinkIcon className="h-3 w-3 mr-1" />
                            )}
                            Verify
                          </Button>
                        </TableCell>
                        <TableCell className="text-right">
                          {entity.entity_type === "COMPANY" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setBindTarget(entity);
                                setBindDialogOpen(true);
                              }}
                              disabled={entity.status === "archived"}
                            >
                              <Link2 className="h-3 w-3 mr-1" />
                              Bind
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AuthorityBindDialog
        open={bindDialogOpen}
        onOpenChange={setBindDialogOpen}
        companyEntity={bindTarget}
        onSuccess={refetch}
      />
    </div>
  );
}
