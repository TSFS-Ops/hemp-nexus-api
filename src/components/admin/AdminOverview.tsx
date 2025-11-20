import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Users, Key, AlertTriangle, TrendingUp, FileText, Settings } from "lucide-react";
import { toast } from "sonner";

interface OverviewStats {
  totalUsers: number;
  totalOrgs: number;
  activeApiKeys: number;
  recentErrors: number;
  requestsToday: number;
}

export function AdminOverview() {
  const [stats, setStats] = useState<OverviewStats>({
    totalUsers: 0,
    totalOrgs: 0,
    activeApiKeys: 0,
    recentErrors: 0,
    requestsToday: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);

      // Fetch users count
      const { count: usersCount } = await supabase
        .from("profiles")
        .select("*", { count: "exact", head: true });

      // Fetch organizations count
      const { count: orgsCount } = await supabase
        .from("organizations")
        .select("*", { count: "exact", head: true });

      // Fetch active API keys count
      const { count: keysCount } = await supabase
        .from("api_keys")
        .select("*", { count: "exact", head: true })
        .eq("status", "active");

      // Fetch recent errors (last 24 hours)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const { count: errorsCount } = await supabase
        .from("api_request_logs")
        .select("*", { count: "exact", head: true })
        .gte("status_code", 400)
        .gte("created_at", yesterday.toISOString());

      // Fetch requests today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { count: requestsCount } = await supabase
        .from("api_request_logs")
        .select("*", { count: "exact", head: true })
        .gte("created_at", today.toISOString());

      setStats({
        totalUsers: usersCount || 0,
        totalOrgs: orgsCount || 0,
        activeApiKeys: keysCount || 0,
        recentErrors: errorsCount || 0,
        requestsToday: requestsCount || 0,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
      toast.error("Failed to load overview statistics");
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      title: "Total Users",
      value: stats.totalUsers,
      icon: Users,
      description: "Registered users",
    },
    {
      title: "Organizations",
      value: stats.totalOrgs,
      icon: Activity,
      description: "Active organizations",
    },
    {
      title: "Active API Keys",
      value: stats.activeApiKeys,
      icon: Key,
      description: "Currently active",
    },
    {
      title: "Recent Errors",
      value: stats.recentErrors,
      icon: AlertTriangle,
      description: "Last 24 hours",
      alert: stats.recentErrors > 10,
    },
    {
      title: "Requests Today",
      value: stats.requestsToday,
      icon: TrendingUp,
      description: "API calls today",
    },
  ];

  if (loading) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-6">Loading...</h2>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">API Platform Overview</h2>
        <p className="text-muted-foreground mt-2">
          Monitor and manage your compliance matching API infrastructure
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {statCards.map((stat) => (
          <Card key={stat.title} className={stat.alert ? "border-destructive" : ""}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.alert ? "text-destructive" : "text-muted-foreground"}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common administrative tasks</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <a
            href="/admin/logs"
            className="flex flex-col items-center justify-center p-4 border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <FileText className="h-6 w-6 mb-2" />
            <span className="text-sm font-medium">View API Logs</span>
          </a>
          <a
            href="/admin/users-orgs"
            className="flex flex-col items-center justify-center p-4 border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <Users className="h-6 w-6 mb-2" />
            <span className="text-sm font-medium">Manage Users</span>
          </a>
          <a
            href="/admin/api-keys"
            className="flex flex-col items-center justify-center p-4 border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <Key className="h-6 w-6 mb-2" />
            <span className="text-sm font-medium">API Key Management</span>
          </a>
          <a
            href="/admin/settings"
            className="flex flex-col items-center justify-center p-4 border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <Settings className="h-6 w-6 mb-2" />
            <span className="text-sm font-medium">Settings</span>
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
