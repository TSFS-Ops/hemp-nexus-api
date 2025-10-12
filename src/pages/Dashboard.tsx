import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Copy, Loader2, Key, LogOut, Trash2 } from "lucide-react";
import { z } from "zod";
import type { User, Session } from "@supabase/supabase-js";

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
}

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["signals:write", "signals:read"]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  const availableScopes = [
    "signals:write",
    "signals:read",
    "data-sources:write",
    "data-sources:read",
    "consents:write",
    "consents:read",
  ];

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (!session) {
        navigate("/auth");
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      
      if (!session) {
        navigate("/auth");
      } else {
        fetchApiKeys();
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const fetchApiKeys = async () => {
    const { data, error } = await supabase
      .from("api_keys")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      toast({
        title: "Error",
        description: "Failed to load API keys",
        variant: "destructive",
      });
    } else {
      setApiKeys(data || []);
    }
  };

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      apiKeySchema.parse({ name: keyName, scopes: selectedScopes });
      setCreating(true);

      const { data, error } = await supabase.functions.invoke("api-keys", {
        body: { name: keyName, scopes: selectedScopes },
        method: "POST",
      });

      if (error) throw error;

      setNewKey(data.key);
      setKeyName("");
      toast({
        title: "Success!",
        description: "API key created. Save it now - you won't see it again!",
      });
      
      fetchApiKeys();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create API key",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: "API key copied to clipboard",
    });
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const handleDeleteApiKey = async (keyId: string, keyName: string) => {
    if (!confirm(`Are you sure you want to revoke "${keyName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const { error } = await supabase.functions.invoke(`api-keys/${keyId}`, {
        method: "DELETE",
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "API key revoked successfully",
      });
      
      fetchApiKeys();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to revoke API key",
        variant: "destructive",
      });
    }
  };

  const toggleScope = (scope: string) => {
    setSelectedScopes(prev =>
      prev.includes(scope)
        ? prev.filter(s => s !== scope)
        : [...prev, scope]
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">API Keys</h1>
            <p className="text-muted-foreground mt-1">{user?.email}</p>
          </div>
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </div>

        {newKey && (
          <Card className="border-primary">
            <CardHeader>
              <CardTitle className="text-green-600">API Key Created!</CardTitle>
              <CardDescription>
                Save this key now - you won't be able to see it again
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input value={newKey} readOnly className="font-mono" />
                <Button onClick={() => copyToClipboard(newKey)} size="icon">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Button 
                onClick={() => setNewKey(null)} 
                variant="outline" 
                className="mt-4 w-full"
              >
                I've saved it
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Create New API Key</CardTitle>
            <CardDescription>
              Generate a new API key to access the SignalRank API
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
                <Label>Scopes</Label>
                <div className="grid grid-cols-2 gap-2">
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
              <p className="text-muted-foreground text-center py-8">
                No API keys yet. Create one above to get started.
              </p>
            ) : (
              <div className="space-y-4">
                {apiKeys.map((key) => (
                  <div
                    key={key.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div>
                      <h3 className="font-semibold">{key.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        Created: {new Date(key.created_at).toLocaleDateString()}
                      </p>
                      <div className="flex gap-1 mt-1">
                        {key.scopes.map((scope) => (
                          <span
                            key={scope}
                            className="text-xs px-2 py-1 bg-secondary rounded"
                          >
                            {scope}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-sm text-muted-foreground">
                        {key.last_used_at
                          ? `Last used: ${new Date(key.last_used_at).toLocaleDateString()}`
                          : "Never used"}
                      </div>
                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={() => handleDeleteApiKey(key.id, key.name)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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
