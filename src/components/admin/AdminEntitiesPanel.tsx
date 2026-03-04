import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Building2, User, Search, ShieldCheck, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

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

const statusColour: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  suspended: "bg-amber-500/10 text-amber-700 border-amber-200",
  blocked: "bg-destructive/10 text-destructive border-destructive/20",
  archived: "bg-muted text-muted-foreground border-muted",
};

export function AdminEntitiesPanel() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [screeningEntity, setScreeningEntity] = useState<string | null>(null);

  const fetchEntities = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const params: Record<string, string> = { all: "true", limit: "200" };
      if (statusFilter !== "all") params.status = statusFilter;
      if (typeFilter !== "all") params.entity_type = typeFilter;

      const res = await supabase.functions.invoke("entities", {
        method: "GET",
        headers: { "X-Correlation-ID": crypto.randomUUID() },
        body: null,
      });

      // Fallback: direct table query for admin
      const { data, error } = await supabase
        .from("entities")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      setEntities(data || []);
    } catch (err) {
      console.error("Failed to load entities:", err);
      toast.error("Failed to load entities");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEntities(); }, [statusFilter, typeFilter]);

  const runScreening = async (entityId: string) => {
    setScreeningEntity(entityId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Stub screening — always returns "clear" for demo
      const res = await supabase.functions.invoke("entities", {
        method: "POST",
        headers: {
          "Idempotency-Key": `screen-${entityId}-${Date.now()}`,
          "X-Correlation-ID": crypto.randomUUID(),
        },
        body: {
          entity_id: entityId,
          provider: "stub",
          result: "clear",
          details: { note: "Automated stub screening — no real provider configured" },
        },
      });

      toast.success("Screening completed: CLEAR");
      fetchEntities();
    } catch (err) {
      console.error("Screening error:", err);
      toast.error("Screening failed");
    } finally {
      setScreeningEntity(null);
    }
  };

  const filtered = entities.filter((e) => {
    const matchesSearch = !searchTerm ||
      e.legal_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.id.includes(searchTerm);
    const matchesStatus = statusFilter === "all" || e.status === statusFilter;
    const matchesType = typeFilter === "all" || e.entity_type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const stats = {
    total: entities.length,
    active: entities.filter((e) => e.status === "active").length,
    suspended: entities.filter((e) => e.status === "suspended").length,
    companies: entities.filter((e) => e.entity_type === "COMPANY").length,
    individuals: entities.filter((e) => e.entity_type === "INDIVIDUAL").length,
  };

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
          <CardDescription>All registered legal entities across the platform</CardDescription>
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
            <Button variant="outline" size="icon" onClick={fetchEntities} aria-label="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No entities found</p>
          ) : (
            <div className="overflow-x-auto">
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
                      <TableCell className="text-xs">{entity.registration_number || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusColour[entity.status] || ""}>
                          {entity.status}
                        </Badge>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
