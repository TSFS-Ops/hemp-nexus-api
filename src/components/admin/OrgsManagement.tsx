import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
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
  const { toast } = useToast();

  useEffect(() => {
    fetchOrgs();
  }, []);

  const fetchOrgs = async () => {
    try {
      setLoading(true);
      
      // Fetch organizations
      const { data: orgsData, error: orgsError } = await supabase
        .from("organizations")
        .select("*")
        .order("created_at", { ascending: false });

      if (orgsError) throw orgsError;

      // Fetch counts for each org
      const orgsWithCounts = await Promise.all(
        (orgsData || []).map(async (org) => {
          const [profilesCount, apiKeysCount] = await Promise.all([
            supabase
              .from("profiles")
              .select("id", { count: "exact", head: true })
              .eq("org_id", org.id),
            supabase
              .from("api_keys")
              .select("id", { count: "exact", head: true })
              .eq("org_id", org.id)
              .eq("status", "active"),
          ]);

          return {
            ...org,
            _count: {
              profiles: profilesCount.count || 0,
              api_keys: apiKeysCount.count || 0,
            },
          };
        })
      );

      setOrgs(orgsWithCounts);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch organizations",
        variant: "destructive",
      });
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

      toast({
        title: "Status Updated",
        description: `Organization status changed to ${newStatus}`,
      });
      fetchOrgs();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update organization status",
        variant: "destructive",
      });
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
