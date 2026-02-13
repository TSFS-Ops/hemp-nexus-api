import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [
        { count: usersCount },
        { count: orgsCount },
        { count: keysCount },
        { count: errorsCount },
        { count: requestsCount },
        { count: matchesCount },
        { count: confirmedCount },
        { count: signalsCount },
      ] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("organizations").select("*", { count: "exact", head: true }),
        supabase.from("api_keys").select("*", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("api_request_logs").select("*", { count: "exact", head: true }).gte("status_code", 400).gte("created_at", yesterday.toISOString()),
        supabase.from("api_request_logs").select("*", { count: "exact", head: true }).gte("created_at", today.toISOString()),
        supabase.from("matches").select("*", { count: "exact", head: true }),
        supabase.from("matches").select("*", { count: "exact", head: true }).eq("status", "settled"),
        supabase.from("signals").select("*", { count: "exact", head: true }).eq("status", "active"),
      ]);

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
    { title: "Total Matches", value: stats.totalMatches, icon: GitCompare, description: `${stats.confirmedMatches} confirmed` },
    { title: "Active Signals", value: stats.activeSignals, icon: Radio, description: "Buyer/seller signals" },
    { title: "Total Users", value: stats.totalUsers, icon: Users, description: "Registered users" },
    { title: "Organizations", value: stats.totalOrgs, icon: Activity, description: "Active organizations" },
    { title: "Active API Keys", value: stats.activeApiKeys, icon: Key, description: "Currently active" },
    { title: "Recent Errors", value: stats.recentErrors, icon: AlertTriangle, description: "Last 24 hours", alert: stats.recentErrors > 10 },
    { title: "Requests Today", value: stats.requestsToday, icon: TrendingUp, description: "API calls today" },
  ];

  if (loading) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-6">Loading...</h2>
      </div>
    );
  }

  const quickActions = [
    { to: "/admin/matches", icon: GitCompare, label: "Matches" },
    { to: "/admin/signals", icon: Radio, label: "Signals" },
    { to: "/admin/coherence", icon: TrendingUp, label: "Coherence Engine" },
    { to: "/admin/behavioral", icon: Activity, label: "Behavioral Analytics" },
    { to: "/admin/audit", icon: FileText, label: "Audit Logs" },
    { to: "/admin/api-keys", icon: Key, label: "API Keys" },
    { to: "/admin/users-orgs", icon: Users, label: "Users & Orgs" },
    { to: "/admin/settings", icon: Settings, label: "Settings" },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">API Platform Overview</h2>
        <p className="text-muted-foreground mt-1 sm:mt-2 text-sm sm:text-base">
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
        <CardHeader className="px-4 sm:px-6">
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common administrative tasks</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 px-4 sm:px-6">
          {quickActions.map((action) => (
            <Link
              key={action.to}
              to={action.to}
              className="flex flex-col items-center justify-center p-4 border rounded-lg hover:bg-muted/50 transition-colors"
            >
              <action.icon className="h-6 w-6 mb-2" />
              <span className="text-sm font-medium">{action.label}</span>
            </Link>
          ))}
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
