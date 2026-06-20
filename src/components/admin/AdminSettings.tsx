import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Save, Settings, Bell, Key, AlertTriangle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Json } from "@/integrations/supabase/types";
import { TestModeBypassPanel } from "@/components/admin/TestModeBypassPanel";

interface GeneralSettings {
  siteName: string;
  maintenanceMode: boolean;
  maintenanceReason?: string;
  maintenanceStartedAt?: string | null;
  allowNewRegistrations: boolean;
}

interface ApiSettings {
  rateLimit: number;
  defaultExpiry: number;
  requireApproval: boolean;
}

interface NotificationSettings {
  emailAlerts: boolean;
  alertEmail: string;
  poiFacilitationEmail: string;
  slackWebhook: string;
  alertThreshold: number;
}

export function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [general, setGeneral] = useState<GeneralSettings>({
    siteName: "Izenzo",
    maintenanceMode: false,
    maintenanceReason: "",
    maintenanceStartedAt: null,
    allowNewRegistrations: true,
  });
  const [api, setApi] = useState<ApiSettings>({
    rateLimit: 100,
    defaultExpiry: 90,
    requireApproval: false,
  });
  const [notifications, setNotifications] = useState<NotificationSettings>({
    emailAlerts: true,
    alertEmail: "",
    poiFacilitationEmail: "",
    slackWebhook: "",
    alertThreshold: 10,
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("admin_settings")
        .select("key, value");

      if (error) throw error;

      data?.forEach((setting) => {
        const value = setting.value as Record<string, unknown>;
        switch (setting.key) {
          case "general":
            setGeneral(value as unknown as GeneralSettings);
            break;
          case "api":
            setApi(value as unknown as ApiSettings);
            break;
          case "notifications":
            setNotifications(value as unknown as NotificationSettings);
            break;
        }
      });
    } catch (error) {
      console.error("Error fetching settings:", error);
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (key: string, value: object) => {
    try {
      setSaving(true);
      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from("admin_settings")
        .upsert({
          key,
          value: value as Json,
          updated_by: user?.id,
        }, { onConflict: "key" })
        .select();

      if (error) throw error;

      if (!data || data.length === 0) {
        throw new Error("Settings were not saved. You may not have permission.");
      }

      toast.success("Settings saved successfully");
    } catch (error) {
      console.error("Error saving settings:", error);
      const msg = error instanceof Error ? error.message : "Failed to save settings";
      if (/AAL2_REQUIRED/.test(msg)) {
        toast.error(
          "MFA required: changing this setting needs a fresh authenticator (MFA) challenge. Re-authenticate and retry.",
        );
      } else {
        toast.error(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground mt-2">
          Platform configuration and preferences
        </p>
      </div>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList>
          <TabsTrigger value="general" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            General
          </TabsTrigger>
          <TabsTrigger value="api" className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            API
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="test-mode" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Test Mode
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>General Settings</CardTitle>
              <CardDescription>Basic platform configuration</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Site Name</Label>
                <Input
                  id="siteName"
                  value={general.siteName}
                  onChange={(e) => setGeneral({ ...general, siteName: e.target.value })}
                />
              </div>

              <div className="space-y-3 rounded-md border border-border p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label>Maintenance Mode</Label>
                    <p className="text-sm text-muted-foreground">
                      Blocks new trades, engagements, document sharing, identity checks, invitations and team invites for non-admin users. Read-only views (existing trades, messages, search) remain available.
                    </p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
                      ✓ Server-side enforcement active. Platform admins are exempt. Toggling logs an audit row.
                    </p>
                  </div>
                  <Switch
                    checked={general.maintenanceMode}
                    onCheckedChange={(checked) =>
                      setGeneral({
                        ...general,
                        maintenanceMode: checked,
                        // Stamp the moment we turn ON; clear when turning OFF.
                        maintenanceStartedAt: checked ? new Date().toISOString() : null,
                      })
                    }
                  />
                </div>

                {general.maintenanceMode && (
                  <div className="space-y-1.5 pt-2 border-t border-border">
                    <Label htmlFor="maintenanceReason" className="text-xs uppercase tracking-wide text-muted-foreground">
                      Reason shown to users
                    </Label>
                    <Textarea
                      id="maintenanceReason"
                      placeholder="e.g. Scheduled database migration. Back online by 18:00 SAST."
                      value={general.maintenanceReason ?? ""}
                      onChange={(e) => setGeneral({ ...general, maintenanceReason: e.target.value })}
                      maxLength={500}
                      rows={2}
                    />
                    <p className="text-xs text-muted-foreground">
                      Appears in the red banner shown to all non-admin users. Leave blank for the default message.
                      {general.maintenanceStartedAt && (
                        <span className="block mt-1">
                          Started: {new Date(general.maintenanceStartedAt).toLocaleString()}
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Allow New Registrations</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow new users to sign up
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                    Saved as a configuration flag. Auth provider settings control actual registration.
                  </p>
                </div>
                <Switch
                  checked={general.allowNewRegistrations}
                  onCheckedChange={(checked) => setGeneral({ ...general, allowNewRegistrations: checked })}
                />
              </div>

              <Button onClick={() => saveSettings("general", general)} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save General Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api">
          <Card>
            <CardHeader>
              <CardTitle>API Settings</CardTitle>
              <CardDescription>Configure API behaviour and limits</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="rateLimit">Rate Limit (requests/minute)</Label>
                <Input
                  id="rateLimit"
                  type="number"
                  value={api.rateLimit}
                  onChange={(e) => setApi({ ...api, rateLimit: parseInt(e.target.value) || 100 })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="defaultExpiry">Default API Key Expiry (days)</Label>
                <Input
                  id="defaultExpiry"
                  type="number"
                  value={api.defaultExpiry}
                  onChange={(e) => setApi({ ...api, defaultExpiry: parseInt(e.target.value) || 90 })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Require Manual Approval</Label>
                  <p className="text-sm text-muted-foreground">
                    Require admin approval for new API keys
                  </p>
                </div>
                <Switch
                  checked={api.requireApproval}
                  onCheckedChange={(checked) => setApi({ ...api, requireApproval: checked })}
                />
              </div>

              <Button onClick={() => saveSettings("api", api)} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save API Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notification Settings</CardTitle>
              <CardDescription>Configure alerts and notifications</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Email Alerts</Label>
                  <p className="text-sm text-muted-foreground">
                    Receive email notifications for important events
                  </p>
                </div>
                <Switch
                  checked={notifications.emailAlerts}
                  onCheckedChange={(checked) => setNotifications({ ...notifications, emailAlerts: checked })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="alertEmail">Alert Recipient Email</Label>
                <Input
                  id="alertEmail"
                  type="email"
                  placeholder="ops@izenzo.co.za"
                  value={notifications.alertEmail}
                  onChange={(e) => setNotifications({ ...notifications, alertEmail: e.target.value })}
                />
                <p className="text-sm text-muted-foreground">
                  Infrastructure alerts are sent to this address. Defaults to ops@izenzo.co.za if empty.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="poiFacilitationEmail">POI Facilitation Email</Label>
                <Input
                  id="poiFacilitationEmail"
                  type="email"
                  placeholder="admin@izenzo.co.za"
                  value={notifications.poiFacilitationEmail}
                  onChange={(e) => setNotifications({ ...notifications, poiFacilitationEmail: e.target.value })}
                />
                <p className="text-sm text-muted-foreground">
                  When a trade request is generated for an unknown trading partner (unilateral trade), a facilitation alert is sent to this address so the team can arrange contact. Defaults to admin@izenzo.co.za if empty.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="slackWebhook">Slack Webhook URL</Label>
                <Input
                  id="slackWebhook"
                  type="url"
                  placeholder="https://hooks.slack.com/services/..."
                  value={notifications.slackWebhook}
                  onChange={(e) => setNotifications({ ...notifications, slackWebhook: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="alertThreshold">Error Alert Threshold</Label>
                <Input
                  id="alertThreshold"
                  type="number"
                  value={notifications.alertThreshold}
                  onChange={(e) => setNotifications({ ...notifications, alertThreshold: parseInt(e.target.value) || 10 })}
                />
                <p className="text-sm text-muted-foreground">
                  Alert when errors exceed this count in 24 hours
                </p>
              </div>

              <Button onClick={() => saveSettings("notifications", notifications)} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save Notification Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="test-mode" className="space-y-4">
          <TestModeBypassPanel />
          <StubProviderSimulationPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
