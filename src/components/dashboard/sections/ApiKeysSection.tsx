import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Loader2, Key, Trash2, Eye, EyeOff, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";

const apiKeySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  scopes: z.array(z.string()).min(1, "At least one scope is required"),
});

interface ApiKey {
  id: string;
  name: string;
  key?: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  status: string;
}

const availableScopes = [
  "signals:write",
  "signals:read",
  "signals",
  "match:write",
  "match:read",
  "match",
  "collapse",
  "preflight",
  "trade-status",
  "evidence",
  "api_keys",
  "data-sources:write",
  "data-sources:read",
  "consents:write",
  "consents:read",
  "webhooks:write",
  "webhooks:read",
];

export function ApiKeysSection() {
  const { session } = useAuth();
  const [creating, setCreating] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["signals:write", "signals:read"]);
  const [expiryDays, setExpiryDays] = useState<string>("never");
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  const fetchApiKeys = useCallback(async () => {
    // SECURITY: Explicitly select only safe columns to avoid exposing key_hash
    // Never request key_hash or key_history from the api_keys table
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, name, scopes, status, created_at, last_used_at, expires_at")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Error fetching API keys", { description: error.message });
      return;
    }

    setApiKeys(data || []);
  }, []);

  useEffect(() => {
    if (session) {
      fetchApiKeys();
    }
  }, [session, fetchApiKeys]);

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      apiKeySchema.parse({ name: keyName, scopes: selectedScopes });

      const expiresAt = expiryDays === "never" 
        ? null 
        : new Date(Date.now() + parseInt(expiryDays) * 24 * 60 * 60 * 1000).toISOString();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-keys`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            name: keyName,
            scopes: selectedScopes,
            expires_at: expiresAt,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || "Failed to create API key");
      }

      const data = await response.json();
      setNewKey(data.key);
      setShowKey(true);
      setKeyName("");
      setSelectedScopes(["signals:write", "signals:read"]);
      setExpiryDays("never");
      
      await navigator.clipboard.writeText(data.key);
      await fetchApiKeys();

      toast.success("API Key created & copied!", {
        description: "Your new API key has been copied to your clipboard. This is the only time you'll see it - save it securely now!",
        duration: 8000,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error("Validation error", { description: error.errors[0].message });
      } else {
        toast.error("Error creating API key", {
          description: error instanceof Error ? error.message : "An error occurred",
        });
      }
    } finally {
      setCreating(false);
    }
  };

  const handleCopyKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      toast.success("Copied!", { description: "API key copied to clipboard" });
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    const confirmed = window.confirm(
      "Are you sure you want to revoke this API key? This action cannot be undone."
    );

    if (!confirmed) return;

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-keys/${keyId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      }
    );

    if (!response.ok) {
      toast.error("Error revoking API key");
      return;
    }

    toast.success("API Key revoked", { description: "The API key has been revoked successfully" });

    await fetchApiKeys();
  };

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope)
        ? prev.filter((s) => s !== scope)
        : [...prev, scope]
    );
  };

  const isKeyExpiringSoon = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    const expiryDate = new Date(expiresAt);
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return expiryDate <= sevenDaysFromNow;
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never";
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="space-y-1">
        <h1 className="font-bold tracking-tight">Authentication</h1>
        <p className="text-muted-foreground text-sm sm:text-base leading-relaxed max-w-2xl">
          Manage API keys to authenticate your requests
        </p>
      </header>

      {newKey && (
        <Alert className="border-primary bg-primary/5">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="flex items-center gap-2">
            ⚠️ Save your API key now
            <Badge variant="outline" className="ml-auto">Copied to clipboard</Badge>
          </AlertTitle>
          <AlertDescription className="space-y-3">
            <p className="font-medium">
              This is the only time you'll see this key. It's been automatically copied to your clipboard.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <code className="flex-1 px-3 py-2 bg-muted rounded text-sm font-mono break-all">
                {showKey ? newKey : "••••••••••••••••••••••••••••••••"}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button 
                variant="outline" 
                size="icon" 
                onClick={handleCopyKey}
                title="Copy again"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              💡 <strong>Next steps:</strong> Store this key securely (in a password manager or environment variable), then test it in the API Playground or Testing tab.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create New API Key</CardTitle>
            <CardDescription>
              Generate a new API key to access the API endpoints
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateApiKey} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Key Name</Label>
                <Input
                  id="name"
                  placeholder="My API Key"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="expiryDays">Expiry</Label>
                <Select value={expiryDays} onValueChange={setExpiryDays}>
                  <SelectTrigger id="expiryDays">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Never expires</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                    <SelectItem value="180">180 days</SelectItem>
                    <SelectItem value="365">1 year</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  You'll receive a warning email 7 days before expiry
                </p>
              </div>
              
              <div className="space-y-2">
                <Label>Scopes</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {availableScopes.map((scope) => (
                    <label
                      key={scope}
                      className="flex items-center space-x-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedScopes.includes(scope)}
                        onChange={() => toggleScope(scope)}
                        className="rounded"
                      />
                      <span className="text-sm">{scope}</span>
                    </label>
                  ))}
                </div>
              </div>

              <Button type="submit" disabled={creating} className="w-full">
                {creating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Key className="mr-2 h-4 w-4" />
                    Create API Key
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your API Keys</CardTitle>
            <CardDescription>Manage your existing API keys</CardDescription>
          </CardHeader>
          <CardContent>
            {apiKeys.length === 0 ? (
              <div className="text-center py-12 space-y-3">
                <Key className="h-12 w-12 mx-auto text-muted-foreground" />
                <p className="text-muted-foreground">
                  No API keys yet
                </p>
                <p className="text-sm text-muted-foreground">
                  Create your first API key to get started
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {apiKeys.map((key) => (
                  <div
                    key={key.id}
                    className="flex items-start justify-between p-4 border rounded-lg"
                  >
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{key.name}</p>
                        {isKeyExpiringSoon(key.expires_at) && (
                          <Badge variant="destructive" className="text-xs">
                            Expiring Soon
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Created: {formatDate(key.created_at)}
                      </p>
                      {key.expires_at && (
                        <p className="text-sm text-muted-foreground">
                          Expires: {formatDate(key.expires_at)}
                        </p>
                      )}
                      {key.last_used_at && (
                        <p className="text-sm text-muted-foreground">
                          Last used: {formatDate(key.last_used_at)}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {key.scopes.map((scope) => (
                          <Badge key={scope} variant="secondary" className="text-xs">
                            {scope}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRevokeKey(key.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
