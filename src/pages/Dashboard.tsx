import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Copy, Loader2, Key, Trash2, Eye, EyeOff, AlertCircle } from "lucide-react";
import { z } from "zod";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { User, Session } from "@supabase/supabase-js";
import SignalTester from "@/components/SignalTester";
import MatchTester from "@/components/MatchTester";
import AuditLogViewer from "@/components/AuditLogViewer";
import ApiDocs from "@/components/ApiDocs";
import ApiAnalytics from "@/components/ApiAnalytics";
import WebhookDeliveryLogs from "@/components/WebhookDeliveryLogs";
import HashVerifier from "@/components/HashVerifier";
import CronSetupInstructions from "@/components/CronSetupInstructions";
import ComprehensiveApiTests from "@/components/ComprehensiveApiTests";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { DashboardLayout } from "@/components/DashboardLayout";
import { QuickstartGuide } from "@/components/dashboard/QuickstartGuide";
import { WebhookManagement } from "@/components/dashboard/WebhookManagement";
import { MatchesList } from "@/components/MatchesList";
import { MatchAnalytics } from "@/components/MatchAnalytics";
import Troubleshooting from "@/components/Troubleshooting";
import OnboardingWizard from "@/components/OnboardingWizard";
import { SandboxIndicator } from "@/components/SandboxIndicator";

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

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["signals:write", "signals:read"]);
  const [expiryDays, setExpiryDays] = useState<string>("never");
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [activeSection, setActiveSection] = useState("quickstart");
  const [isAdmin, setIsAdmin] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
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
        checkAdminRole(session.user.id);
        
        // Check if this is the first time the user is visiting
        const hasCompletedOnboarding = localStorage.getItem("onboarding_completed");
        if (!hasCompletedOnboarding) {
          setShowOnboarding(true);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const checkAdminRole = async (userId: string) => {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    
    setIsAdmin(!!data);
  };

  const fetchApiKeys = async () => {
    const { data, error } = await supabase
      .from("api_keys")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      toast({
        variant: "destructive",
        title: "Error fetching API keys",
        description: error.message,
      });
      return;
    }

    setApiKeys(data || []);
  };

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
      
      // Auto-copy to clipboard
      await navigator.clipboard.writeText(data.key);
      
      await fetchApiKeys();

      toast({
        title: "API Key created & copied!",
        description: "Your new API key has been copied to your clipboard. This is the only time you'll see it - save it securely now!",
        duration: 8000,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast({
          variant: "destructive",
          title: "Validation error",
          description: error.errors[0].message,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Error creating API key",
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
      toast({
        title: "Copied!",
        description: "API key copied to clipboard",
      });
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
      toast({
        variant: "destructive",
        title: "Error revoking API key",
      });
      return;
    }

    toast({
      title: "API Key revoked",
      description: "The API key has been revoked successfully",
    });

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderContent = () => {
    switch (activeSection) {
      case "quickstart":
        return <QuickstartGuide onStartWizard={() => setShowOnboarding(true)} onSectionChange={setActiveSection} />;

      case "matches":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">Matches</h1>
              <p className="text-muted-foreground">
                View and manage trade matches with full audit trails
              </p>
            </div>
            <MatchesList />
          </div>
        );

      case "analytics":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">Match Analytics</h1>
              <p className="text-muted-foreground">
                Insights and statistics about your trading activity
              </p>
            </div>
            <MatchAnalytics />
          </div>
        );

      case "docs":
        return (
          <div className="space-y-8">
            <div>
              <h1 className="text-4xl font-bold tracking-tight mb-2">Compliance Matching API</h1>
              <p className="text-lg text-muted-foreground">
                Cross-industry REST API for logging, matching, and settling verified trade intent between buyers and sellers, with audit logs and compliance event tracking
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              <Card className="border-2">
                <CardHeader>
                  <CardTitle className="text-lg">Quick Start</CardTitle>
                  <CardDescription>
                    Get started with your first API call in minutes
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-2">
                <CardHeader>
                  <CardTitle className="text-lg">Authentication</CardTitle>
                  <CardDescription>
                    Secure your API requests with bearer tokens
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-2">
                <CardHeader>
                  <CardTitle className="text-lg">Rate Limits</CardTitle>
                  <CardDescription>
                    1000 requests per hour per API key
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Base URL</CardTitle>
              </CardHeader>
              <CardContent>
                <code className="block p-4 bg-muted rounded-lg text-sm font-mono">
                  https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1
                </code>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick Example</CardTitle>
                <CardDescription>Create a signal in under 30 seconds</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">cURL</p>
                  <pre className="p-4 bg-muted rounded-lg overflow-x-auto">
                    <code className="text-sm font-mono">{`curl -X POST https://api.example.com/v1/signals \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "buyer",
    "what": "Industrial Equipment Parts",
    "how_much": 10000,
    "unit": "units"
  }'`}</code>
                  </pre>
                </div>
              </CardContent>
            </Card>
          </div>
        );

      case "keys":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">Authentication</h1>
              <p className="text-muted-foreground">
                Manage API keys to authenticate your requests
              </p>
            </div>

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

            <div className="grid gap-6 md:grid-cols-2">
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

      case "test":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">API Reference & Testing</h1>
              <p className="text-muted-foreground">
                Complete documentation with interactive playground and automated test suite
              </p>
            </div>
            <Tabs defaultValue="documentation" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="documentation">Documentation</TabsTrigger>
                <TabsTrigger value="tests">Automated Tests</TabsTrigger>
              </TabsList>
              <TabsContent value="documentation" className="mt-6">
                <ApiDocs />
              </TabsContent>
              <TabsContent value="tests" className="mt-6">
                <ComprehensiveApiTests />
              </TabsContent>
            </Tabs>
          </div>
        );

      case "webhooks":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">Webhooks</h1>
              <p className="text-muted-foreground">
                Real-time event notifications for your integration
              </p>
            </div>
            <WebhookManagement />
            <WebhookDeliveryLogs />
          </div>
        );

      case "audit-logs":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">Logs</h1>
              <p className="text-muted-foreground">
                Audit trail of all API operations
              </p>
            </div>
            {apiKeys.length > 0 ? (
              <AuditLogViewer apiKey={apiKeys[0].id} />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>No API Keys</CardTitle>
                  <CardDescription>
                    Create an API key first to view audit logs
                  </CardDescription>
                </CardHeader>
              </Card>
            )}
          </div>
        );

      case "data-sources":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">Data Sources</h1>
              <p className="text-muted-foreground">
                Configure external data integrations
              </p>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Coming Soon</CardTitle>
                <CardDescription>
                  Data source management interface will be available soon
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        );

      case "hash-verify":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">Hash Verifier</h1>
              <p className="text-muted-foreground">
                Cryptographic verification for audit trails
              </p>
            </div>
            <HashVerifier />
          </div>
        );

      case "automation":
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">Changelog</h1>
              <p className="text-muted-foreground">
                API updates, improvements, and breaking changes
              </p>
            </div>
            <CronSetupInstructions />
          </div>
        );

      case "troubleshooting":
        return <Troubleshooting />;

      default:
        return null;
    }
  };

  return (
    <>
      <OnboardingWizard 
        open={showOnboarding} 
        onClose={() => setShowOnboarding(false)} 
      />
      <DashboardLayout 
        activeSection={activeSection} 
        onSectionChange={setActiveSection}
        isAdmin={isAdmin}
      >
        <SandboxIndicator isSandbox={true} />
        {renderContent()}
      </DashboardLayout>
    </>
  );
}
