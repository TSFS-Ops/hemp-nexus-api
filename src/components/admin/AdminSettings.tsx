import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Settings, Bell, Key } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Json } from "@/integrations/supabase/types";

interface GeneralSettings {
  siteName: string;
  maintenanceMode: boolean;
  allowNewRegistrations: boolean;
}

interface ApiSettings {
  rateLimit: number;
  defaultExpiry: number;
  requireApproval: boolean;
}

interface NotificationSettings {
  emailAlerts: boolean;
  slackWebhook: string;
  alertThreshold: number;
}

export function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [general, setGeneral] = useState<GeneralSettings>({
    siteName: "Compliance Match",
    maintenanceMode: false,
    allowNewRegistrations: true,
  });
  const [api, setApi] = useState<ApiSettings>({
    rateLimit: 100,
    defaultExpiry: 90,
    requireApproval: false,
  });
  const [notifications, setNotifications] = useState<NotificationSettings>({
    emailAlerts: true,
    slackWebhook: "",
    alertThreshold: 10,
  });
  const { toast } = useToast();

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
      toast({
        title: "Error",
        description: "Failed to load settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (key: string, value: object) => {
    try {
      setSaving(true);
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from("admin_settings")
        .update({
          value: value as Json,
          updated_by: user?.id,
        })
        .eq("key", key);

      if (error) throw error;

      toast({ title: "Settings saved successfully" });
    } catch (error) {
      console.error("Error saving settings:", error);
      toast({
        title: "Error",
        description: "Failed to save settings",
        variant: "destructive",
      });
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
        </TabsList>

        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>General Settings</CardTitle>
              <CardDescription>Basic platform configuration</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="siteName">Site Name</Label>
                <Input
                  id="siteName"
                  value={general.siteName}
                  onChange={(e) => setGeneral({ ...general, siteName: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Maintenance Mode</Label>
                  <p className="text-sm text-muted-foreground">
                    Temporarily disable access to the platform
                  </p>
                </div>
                <Switch
                  checked={general.maintenanceMode}
                  onCheckedChange={(checked) => setGeneral({ ...general, maintenanceMode: checked })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Allow New Registrations</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow new users to sign up
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
              <CardDescription>Configure API behavior and limits</CardDescription>
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
      </Tabs>
    </div>
  );
}
