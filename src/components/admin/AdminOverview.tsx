import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Users, Key, AlertTriangle, TrendingUp, FileText, Settings, GitCompare, Radio } from "lucide-react";
import { toast } from "sonner";

interface OverviewStats {
  totalUsers: number;
  totalOrgs: number;
  activeApiKeys: number;
  recentErrors: number;
  requestsToday: number;
  totalMatches: number;
  confirmedMatches: number;
  activeSignals: number;
}

export function AdminOverview() {
  const [stats, setStats] = useState<OverviewStats>({
    totalUsers: 0,
    totalOrgs: 0,
    activeApiKeys: 0,
    recentErrors: 0,
    requestsToday: 0,
    totalMatches: 0,
    confirmedMatches: 0,
    activeSignals: 0,
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

      // Fetch matches stats
      const { count: matchesCount } = await supabase
        .from("matches")
        .select("*", { count: "exact", head: true });

      const { count: confirmedCount } = await supabase
        .from("matches")
        .select("*", { count: "exact", head: true })
        .eq("status", "settled");

      // Fetch active signals
      const { count: signalsCount } = await supabase
        .from("signals")
        .select("*", { count: "exact", head: true })
        .eq("status", "active");

      setStats({
        totalUsers: usersCount || 0,
        totalOrgs: orgsCount || 0,
        activeApiKeys: keysCount || 0,
        recentErrors: errorsCount || 0,
        requestsToday: requestsCount || 0,
        totalMatches: matchesCount || 0,
        confirmedMatches: confirmedCount || 0,
        activeSignals: signalsCount || 0,
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
      title: "Total Matches",
      value: stats.totalMatches,
      icon: GitCompare,
      description: `${stats.confirmedMatches} confirmed`,
    },
    {
      title: "Active Signals",
      value: stats.activeSignals,
      icon: Radio,
      description: "Buyer/seller signals",
    },
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <a
            href="/admin/matches"
            className="flex flex-col items-center justify-center p-4 border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <GitCompare className="h-6 w-6 mb-2" />
            <span className="text-sm font-medium">View Matches</span>
          </a>
          <a
            href="/admin/signals"
            className="flex flex-col items-center justify-center p-4 border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <Radio className="h-6 w-6 mb-2" />
            <span className="text-sm font-medium">View Signals</span>
          </a>
          <a
            href="/admin/logs"
            className="flex flex-col items-center justify-center p-4 border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <FileText className="h-6 w-6 mb-2" />
            <span className="text-sm font-medium">View API Logs</span>
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

      <Card>
        <CardHeader>
          <CardTitle>Intent Actions Summary</CardTitle>
          <CardDescription>
            Only "Confirm Intent" creates audit/evidence records. All other actions are non-binding.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 border rounded-lg bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
              <h4 className="font-semibold text-green-800 dark:text-green-200">Binding Actions</h4>
              <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                <strong>Confirm Intent</strong> - Creates audit record, evidence chain entry.
                Signals serious interest (no legal obligation).
              </p>
            </div>
            <div className="p-4 border rounded-lg">
              <h4 className="font-semibold">Non-Binding Actions</h4>
              <p className="text-sm text-muted-foreground mt-1">
                Skip, Maybe Later, Not Now, Browse, View - No records created.
                Purely behavioral signals for UX improvement.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
