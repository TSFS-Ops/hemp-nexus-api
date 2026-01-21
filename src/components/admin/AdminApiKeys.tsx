import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Key, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface ApiKeyData {
  id: string;
  name: string;
  scopes: string[];
  status: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  organizations: { name: string } | null;
  profiles: { email: string } | null;
}

export function AdminApiKeys() {
  const [apiKeys, setApiKeys] = useState<ApiKeyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [revokeDialog, setRevokeDialog] = useState<{ open: boolean; keyId: string | null }>({
    open: false,
    keyId: null,
  });

  useEffect(() => {
    fetchApiKeys();
  }, []);

  const fetchApiKeys = async () => {
    try {
      setLoading(true);

      // SECURITY: Explicitly select only safe columns to avoid exposing key_hash
      // Never request key_hash or key_history from the api_keys table
      const { data, error } = await supabase
        .from("api_keys")
        .select(`
          id,
          name,
          scopes,
          status,
          created_at,
          last_used_at,
          expires_at,
          org_id,
          created_by,
          revoked_at,
          environment
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch organizations and creator emails separately for each key
      const keysWithDetails = await Promise.all(
        (data || []).map(async (key) => {
          let orgName = null;
          let creatorEmail = null;

          // Fetch organization name
          if (key.org_id) {
            const { data: org } = await supabase
              .from("organizations")
              .select("name")
              .eq("id", key.org_id)
              .single();
            orgName = org?.name || null;
          }

          // Fetch creator email
          if (key.created_by) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("email")
              .eq("id", key.created_by)
              .single();
            creatorEmail = profile?.email || null;
          }

          return {
            id: key.id,
            name: key.name,
            scopes: key.scopes,
            status: key.status,
            created_at: key.created_at,
            last_used_at: key.last_used_at,
            expires_at: key.expires_at,
            organizations: orgName ? { name: orgName } : null,
            profiles: creatorEmail ? { email: creatorEmail } : null,
          };
        })
      );

      setApiKeys(keysWithDetails);
    } catch (error) {
      console.error("Error fetching API keys:", error);
      toast.error("Failed to load API keys");
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    try {
      const { error } = await supabase
        .from("api_keys")
        .update({ status: "revoked", revoked_at: new Date().toISOString() })
        .eq("id", keyId);

      if (error) throw error;

      toast.success("API key revoked successfully");
      fetchApiKeys();
    } catch (error) {
      console.error("Error revoking key:", error);
      toast.error("Failed to revoke API key");
    } finally {
      setRevokeDialog({ open: false, keyId: null });
    }
  };

  const isExpiringSoon = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    const daysUntilExpiry = Math.floor(
      (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    return daysUntilExpiry >= 0 && daysUntilExpiry <= 7;
  };

  const filteredKeys = apiKeys.filter((key) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      key.name.toLowerCase().includes(searchLower) ||
      key.organizations?.name.toLowerCase().includes(searchLower) ||
      key.profiles?.email.toLowerCase().includes(searchLower) ||
      key.id.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">API Keys Management</h2>
          <p className="text-muted-foreground mt-2">
            Monitor and manage all API keys across organizations
          </p>
        </div>
        <Button onClick={fetchApiKeys} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, organization, creator email, or key ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">Loading API keys...</div>
          ) : filteredKeys.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No API keys found</div>
          ) : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Scopes</TableHead>
                    <TableHead>Last Used</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredKeys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Key className="h-4 w-4 text-muted-foreground" />
                          {key.name}
                        </div>
                      </TableCell>
                      <TableCell>{key.organizations?.name || "-"}</TableCell>
                      <TableCell className="text-xs">{key.profiles?.email || "-"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            key.status === "active"
                              ? "default"
                              : key.status === "revoked"
                              ? "destructive"
                              : "secondary"
                          }
                          className={key.status === "active" ? "bg-green-500 hover:bg-green-600" : ""}
                        >
                          {key.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {key.scopes.length > 0 ? (
                            key.scopes.map((scope) => (
                              <Badge key={scope} variant="outline" className="text-xs">
                                {scope}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">No scopes</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {key.last_used_at
                          ? format(new Date(key.last_used_at), "MMM dd, yyyy")
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {key.expires_at ? (
                          <div className="flex items-center gap-1">
                            {isExpiringSoon(key.expires_at) && (
                              <AlertTriangle className="h-3 w-3 text-warning" />
                            )}
                            {format(new Date(key.expires_at), "MMM dd, yyyy")}
                          </div>
                        ) : (
                          "Never"
                        )}
                      </TableCell>
                      <TableCell>
                        {key.status === "active" && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setRevokeDialog({ open: true, keyId: key.id })}
                          >
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={revokeDialog.open}
        onOpenChange={(open) => setRevokeDialog({ open, keyId: null })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke this API key? This action cannot be undone and will
              immediately stop all requests using this key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeDialog.keyId && handleRevokeKey(revokeDialog.keyId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
