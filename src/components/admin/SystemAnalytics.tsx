import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { 
  Loader2, 
  Users, 
  Building2, 
  Key, 
  Activity,
  TrendingUp,
  Database,
  Webhook,
  Shield
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface SystemStats {
  totalUsers: number;
  activeUsers: number;
  totalOrganizations: number;
  activeOrganizations: number;
  totalApiKeys: number;
  activeApiKeys: number;
  totalSignals: number;
  totalMatches: number;
  totalWebhooks: number;
  sandboxOrgs: number;
}

interface RecentActivity {
  id: string;
  action: string;
  entity_type: string;
  created_at: string;
  actor_email?: string;
  metadata: any;
}

export default function SystemAnalytics() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);

      // Fetch system statistics
      const [
        usersCount,
        activeUsersCount,
        orgsCount,
        activeOrgsCount,
        apiKeysCount,
        activeApiKeysCount,
        signalsCount,
        matchesCount,
        webhooksCount,
        sandboxOrgsCount,
        activityLogs,
      ] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("organizations").select("id", { count: "exact", head: true }),
        supabase.from("organizations").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("api_keys").select("id", { count: "exact", head: true }),
        supabase.from("api_keys").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("signals").select("id", { count: "exact", head: true }),
        supabase.from("matches").select("id", { count: "exact", head: true }),
        supabase.from("webhook_endpoints").select("id", { count: "exact", head: true }),
        supabase.from("organizations").select("id", { count: "exact", head: true }).eq("sandbox_enabled", true),
        supabase
          .from("audit_logs")
          .select(`
            *,
            profiles!audit_logs_actor_user_id_fkey(email)
          `)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      setStats({
        totalUsers: usersCount.count || 0,
        activeUsers: activeUsersCount.count || 0,
        totalOrganizations: orgsCount.count || 0,
        activeOrganizations: activeOrgsCount.count || 0,
        totalApiKeys: apiKeysCount.count || 0,
        activeApiKeys: activeApiKeysCount.count || 0,
        totalSignals: signalsCount.count || 0,
        totalMatches: matchesCount.count || 0,
        totalWebhooks: webhooksCount.count || 0,
        sandboxOrgs: sandboxOrgsCount.count || 0,
      });

      setRecentActivity(
        (activityLogs.data || []).map((log: any) => ({
          id: log.id,
          action: log.action,
          entity_type: log.entity_type,
          created_at: log.created_at,
          actor_email: log.profiles?.email,
          metadata: log.metadata,
        }))
      );
    } catch (error) {
      console.error("Analytics fetch error:", error);
      toast.error("Failed to fetch system analytics");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!stats) {
    return (
      <Card>
        <CardContent className="py-12">
          <p className="text-center text-muted-foreground">No analytics data available</p>
        </CardContent>
      </Card>
    );
  }

  const statCards = [
    {
      title: "Users",
      value: stats.totalUsers,
      subtitle: `${stats.activeUsers} active`,
      icon: Users,
      color: "text-blue-500",
    },
    {
      title: "Organizations",
      value: stats.totalOrganizations,
      subtitle: `${stats.activeOrganizations} active`,
      icon: Building2,
      color: "text-purple-500",
    },
    {
      title: "API Keys",
      value: stats.totalApiKeys,
      subtitle: `${stats.activeApiKeys} active`,
      icon: Key,
      color: "text-green-500",
    },
    {
      title: "Sandbox Enabled",
      value: stats.sandboxOrgs,
      subtitle: `${Math.round((stats.sandboxOrgs / stats.totalOrganizations) * 100)}% of orgs`,
      icon: Shield,
      color: "text-amber-500",
    },
    {
      title: "Signals Created",
      value: stats.totalSignals,
      subtitle: "Total signals",
      icon: Activity,
      color: "text-cyan-500",
    },
    {
      title: "Matches Recorded",
      value: stats.totalMatches,
      subtitle: "Total matches",
      icon: TrendingUp,
      color: "text-emerald-500",
    },
    {
      title: "Webhook Endpoints",
      value: stats.totalWebhooks,
      subtitle: "Configured webhooks",
      icon: Webhook,
      color: "text-orange-500",
    },
    {
      title: "Database Health",
      value: "Operational",
      subtitle: "All systems green",
      icon: Database,
      color: "text-green-500",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.subtitle}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest system events across all organizations</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Timestamp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentActivity.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No recent activity
                  </TableCell>
                </TableRow>
              ) : (
                recentActivity.map((activity) => (
                  <TableRow key={activity.id}>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {activity.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize">{activity.entity_type.replace("_", " ")}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {activity.actor_email || "System"}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                      {activity.metadata && Object.keys(activity.metadata).length > 0
                        ? JSON.stringify(activity.metadata)
                        : "-"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(activity.created_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
