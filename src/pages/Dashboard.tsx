import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Copy, Loader2, Key, LogOut, Trash2, Eye, EyeOff, CheckCircle2, Circle, ArrowRight, Rocket } from "lucide-react";
import { z } from "zod";
import type { User, Session } from "@supabase/supabase-js";
import SignalTester from "@/components/SignalTester";
import MatchTester from "@/components/MatchTester";
import AuditLogViewer from "@/components/AuditLogViewer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
  const [showKey, setShowKey] = useState(false);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("keys");
  const [showWelcome, setShowWelcome] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  const availableScopes = [
    "signals:write",
    "signals:read",
    "data-sources:write",
    "data-sources:read",
    "consents:write",
    "consents:read",
    "webhooks:write",
    "webhooks:read",
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
    // RLS automatically filters to only this user's org keys
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
      // Clear testingKey when switching users to force creating new key
      setTestingKey(null);
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
      setShowKey(true); // Show key by default when created
      setTestingKey(data.key); // Keep for testing
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api-keys/${keyId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to revoke API key");
      }

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

  const hasApiKeys = apiKeys.length > 0;
  const hasTestedEndpoint = testingKey !== null;
  const completedSteps = [hasApiKeys, hasTestedEndpoint].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Trade.Izenzo Dashboard</h1>
            <p className="text-muted-foreground mt-1">{user?.email}</p>
          </div>
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </div>

        {/* Welcome Card - Show for users with no keys or when manually shown */}
        {(!hasApiKeys || showWelcome) && (
          <Alert className="border-primary">
            <Rocket className="h-5 w-5" />
            <AlertTitle className="text-lg font-semibold">Welcome to Trade.Izenzo!</AlertTitle>
            <AlertDescription className="mt-2 space-y-3">
              <p>Get started with the Trade.Izenzo API in 3 simple steps:</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {hasApiKeys ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={hasApiKeys ? "text-foreground" : "text-muted-foreground"}>
                    1. Create your first API key
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {hasTestedEndpoint ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={hasTestedEndpoint ? "text-foreground" : "text-muted-foreground"}>
                    2. Test API endpoints
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Circle className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">3. Review audit logs</span>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button 
                  onClick={() => setActiveTab("keys")} 
                  size="sm"
                  disabled={hasApiKeys}
                >
                  {hasApiKeys ? "Completed" : "Get Started"}
                  {!hasApiKeys && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
                {hasApiKeys && showWelcome && (
                  <Button variant="outline" size="sm" onClick={() => setShowWelcome(false)}>
                    Dismiss
                  </Button>
                )}
              </div>
              {completedSteps > 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Progress: {completedSteps}/2 steps completed
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* New Key Success Alert */}
        {newKey && (
          <Card className="border-primary bg-primary/5">
            <CardHeader>
              <CardTitle className="text-primary flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                API Key Created Successfully!
              </CardTitle>
              <CardDescription>
                Save this key now - you won't be able to see it again
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input 
                  value={showKey ? newKey : `${"•".repeat(newKey.length - 4)}${newKey.slice(-4)}`} 
                  readOnly 
                  className="font-mono" 
                />
                <Button 
                  onClick={() => setShowKey(!showKey)} 
                  size="icon"
                  variant="outline"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button onClick={() => copyToClipboard(newKey)} size="icon">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Button 
                onClick={() => {
                  setNewKey(null);
                  setShowKey(false);
                  setActiveTab("testing");
                  toast({
                    title: "Next Step",
                    description: "Now you can test the API endpoints!",
                  });
                }} 
                variant="outline" 
                className="mt-4 w-full"
              >
                I've saved it - Continue to Testing
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="keys" className="relative">
              API Keys
              {hasApiKeys && (
                <CheckCircle2 className="h-3 w-3 absolute -top-1 -right-1 text-green-500" />
              )}
            </TabsTrigger>
            <TabsTrigger value="testing" disabled={!hasApiKeys}>
              Testing
              {hasTestedEndpoint && (
                <CheckCircle2 className="h-3 w-3 absolute -top-1 -right-1 text-green-500" />
              )}
            </TabsTrigger>
            <TabsTrigger value="audit" disabled={!hasApiKeys}>
              Audit Logs
            </TabsTrigger>
          </TabsList>

          {/* API Keys Tab */}
          <TabsContent value="keys" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Create New API Key</CardTitle>
                <CardDescription>
                  Generate a new API key to access the Trade.Izenzo API
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
                  <div className="text-center py-12 space-y-3">
                    <Key className="h-12 w-12 mx-auto text-muted-foreground" />
                    <p className="text-muted-foreground">
                      No API keys yet
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Create your first API key above to get started with Trade.Izenzo
                    </p>
                  </div>
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
                          <div className="flex gap-1 mt-1 flex-wrap">
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
          </TabsContent>

          {/* Testing Tab */}
          <TabsContent value="testing" className="space-y-4">
            {!testingKey ? (
              <Card>
                <CardHeader>
                  <CardTitle>Set API Key for Testing</CardTitle>
                  <CardDescription>
                    Paste one of your API keys to test the endpoints below
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Alert className="mb-4">
                    <AlertDescription>
                      <strong className="block text-amber-600 dark:text-amber-400">
                        ⚠️ Important: Use your own API keys
                      </strong>
                      Each user must use their own API keys. Data is isolated per organization.
                    </AlertDescription>
                  </Alert>
                  <div className="space-y-2">
                    <Label htmlFor="testKey">Your API Key</Label>
                    <div className="flex gap-2">
                      <Input
                        id="testKey"
                        type="password"
                        placeholder="sk_..."
                        onChange={(e) => setTestingKey(e.target.value || null)}
                      />
                      <Button onClick={() => {
                        if (testingKey) {
                          toast({ 
                            title: "Key Set", 
                            description: "You can now use the testers below" 
                          });
                        }
                      }}>
                        Set Key
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertDescription>
                  API key is set. You can now test the endpoints below.
                  <Button 
                    variant="link" 
                    size="sm" 
                    className="ml-2" 
                    onClick={() => setTestingKey(null)}
                  >
                    Clear key
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <MatchTester apiKey={testingKey} />
            <SignalTester apiKey={testingKey} />
          </TabsContent>

          {/* Audit Logs Tab */}
          <TabsContent value="audit" className="space-y-4">
            <AuditLogViewer apiKey={testingKey} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
