import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Search, CheckCircle2, XCircle, RefreshCw, Building2, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Organisation {
  id: string;
  name: string;
  status: string;
  created_at: string;
  sandbox_enabled: boolean;
  clip_on_always_on: boolean;
  clip_on_subscription_started_at: string | null;
  _count?: {
    profiles: number;
    api_keys: number;
  };
}

export default function OrgsManagement() {
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [totalCount, setTotalCount] = useState(0);
  

  useEffect(() => {
    fetchOrgs();
  }, []);

  const ORG_LIMIT = 500;

  const fetchOrgs = async () => {
    try {
      setLoading(true);
      
      // Fetch organisations with count
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

  const handleToggleClipOn = async (orgId: string, next: boolean) => {
    try {
      const { error } = await supabase
        .from("organizations")
        .update({
          clip_on_always_on: next,
          clip_on_subscription_started_at: next ? new Date().toISOString() : null,
        })
        .eq("id", orgId);
      if (error) throw error;

      await supabase.from("audit_logs").insert([{
        org_id: orgId,
        action: next ? "clip_on.subscription_enabled" : "clip_on.subscription_disabled",
        entity_type: "organization",
        entity_id: orgId,
        metadata: { changed_at: new Date().toISOString() },
      }]);

      toast.success(
        next
          ? "Clip-on switched on permanently. Monthly billing starts at the next cron run."
          : "Clip-on permanent plan switched off. Per-request charges resume.",
      );
      fetchOrgs();
    } catch (e: any) {
      toast.error(`Failed to update clip-on plan: ${e?.message ?? "unknown error"}`);
    }
  };

  const filteredOrgs = orgs.filter((org) =>
    org.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organisation Management</CardTitle>
        <CardDescription>
          View and manage organisations and their verification status
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search organisations..."
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
        {!loading && totalCount > ORG_LIMIT && (
          <p className="text-sm text-muted-foreground">
            Showing {orgs.length} of {totalCount} organisations. Only the most recent {ORG_LIMIT} are displayed.
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="space-y-3 md:hidden">
              {filteredOrgs.map((org) => (
                <div key={org.id} className="border rounded-md p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <p className="font-medium text-sm truncate">{org.name}</p>
                    </div>
                    {org.sandbox_enabled ? (
                      <Badge variant="default" className="flex items-center gap-1 shrink-0 text-[10px]">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        Sandbox
                      </Badge>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground text-[10px] uppercase">Users</span>
                      <p className="font-medium">{org._count?.profiles || 0}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-[10px] uppercase">API Keys</span>
                      <p className="font-medium">{org._count?.api_keys || 0}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-[10px] uppercase">Created</span>
                      <p className="text-[11px]">{new Date(org.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t">
                    <Select
                      value={org.status}
                      onValueChange={(value) => handleUpdateStatus(org.id, value)}
                    >
                      <SelectTrigger className="w-full h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table view */}
            <div className="border rounded-md hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Users</TableHead>
                    <TableHead>API Keys</TableHead>
                    <TableHead>Sandbox</TableHead>
                    <TableHead>Clip-on plan</TableHead>
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
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={!!org.clip_on_always_on}
                            onCheckedChange={(v) => handleToggleClipOn(org.id, v)}
                            aria-label="Toggle permanent clip-on plan"
                          />
                          {org.clip_on_always_on ? (
                            <Badge variant="default" className="flex items-center gap-1 w-fit text-[10px]">
                              <ShieldCheck className="h-3 w-3" />
                              Always-on
                            </Badge>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">Per-request</span>
                          )}
                        </div>
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
          </>
        )}

        {!loading && filteredOrgs.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No organisations found matching your search
          </div>
        )}
      </CardContent>
    </Card>
  );
}
