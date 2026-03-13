import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Search, CheckCircle2, XCircle, RefreshCw, Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Organization {
  id: string;
  name: string;
  status: string;
  created_at: string;
  sandbox_enabled: boolean;
  _count?: {
    profiles: number;
    api_keys: number;
  };
}

export default function OrgsManagement() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  

  useEffect(() => {
    fetchOrgs();
  }, []);

  const ORG_LIMIT = 500;

  const fetchOrgs = async () => {
    try {
      setLoading(true);
      
      // Fetch organizations with count
      const { data: orgsData, error: orgsError, count } = await supabase
        .from("organizations")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(ORG_LIMIT);

      if (orgsError) throw orgsError;

      setTotalCount(count ?? orgsData?.length ?? 0);

      // Batch count: profiles per org (single query instead of N+1)
      const orgIds = (orgsData || []).map(o => o.id);
      
      const [profilesRes, apiKeysRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("org_id")
          .in("org_id", orgIds),
        supabase
          .from("api_keys")
          .select("org_id")
          .in("org_id", orgIds)
          .eq("status", "active"),
      ]);

      // Aggregate counts client-side
      const profileCounts = new Map<string, number>();
      const apiKeyCounts = new Map<string, number>();
      for (const p of profilesRes.data ?? []) {
        profileCounts.set(p.org_id, (profileCounts.get(p.org_id) ?? 0) + 1);
      }
      for (const k of apiKeysRes.data ?? []) {
        apiKeyCounts.set(k.org_id, (apiKeyCounts.get(k.org_id) ?? 0) + 1);
      }

      const orgsWithCounts = (orgsData || []).map((org) => ({
        ...org,
        _count: {
          profiles: profileCounts.get(org.id) ?? 0,
          api_keys: apiKeyCounts.get(org.id) ?? 0,
        },
      }));

      setOrgs(orgsWithCounts);
    } catch (error) {
      toast.error("Failed to fetch organisations");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (orgId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from("organizations")
        .update({ status: newStatus })
        .eq("id", orgId);

      if (error) throw error;

      toast.success(`Organisation status changed to ${newStatus}`);
      fetchOrgs();
    } catch (error) {
      toast.error("Failed to update organisation status");
    }
  };

  const filteredOrgs = orgs.filter((org) =>
    org.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization Management</CardTitle>
        <CardDescription>
          View and manage organizations and their verification status
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search organizations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              aria-label="Search organisations"
            />
          </div>
          <Button variant="outline" size="sm" onClick={fetchOrgs} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>API Keys</TableHead>
                  <TableHead>Sandbox</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrgs.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      {org.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{org._count?.profiles || 0}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{org._count?.api_keys || 0}</Badge>
                    </TableCell>
                    <TableCell>
                      {org.sandbox_enabled ? (
                        <Badge variant="default" className="flex items-center gap-1 w-fit">
                          <CheckCircle2 className="h-3 w-3" />
                          Enabled
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                          <XCircle className="h-3 w-3" />
                          Disabled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={org.status}
                        onValueChange={(value) => handleUpdateStatus(org.id, value)}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="suspended">Suspended</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(org.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!loading && filteredOrgs.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No organizations found matching your search
          </div>
        )}
      </CardContent>
    </Card>
  );
}
