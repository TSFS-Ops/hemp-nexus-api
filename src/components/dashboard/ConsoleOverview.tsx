import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Key, Activity, FileText, BarChart3, Clock } from "lucide-react";

interface OverviewStats {
  activeApiKeys: number;
  callsLast24h: number;
  callsLast7d: number;
  confirmedIntents: number;
  lastActivity: string | null;
}

export function ConsoleOverview() {
  const { session } = useAuth();
  const { toast } = useToast();
  const [stats, setStats] = useState<OverviewStats>({
    activeApiKeys: 0,
    callsLast24h: 0,
    callsLast7d: 0,
    confirmedIntents: 0,
    lastActivity: null,
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    if (!session) return;

    setIsLoading(true);
    try {
      // Fetch active API keys count
      const { data: apiKeys, error: apiKeysError } = await supabase
        .from("api_keys")
        .select("id", { count: "exact" })
        .eq("status", "active");

      // Fetch API request logs for last 24h and 7d
      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const { data: logs24h } = await supabase
        .from("api_request_logs")
        .select("id", { count: "exact" })
        .gte("created_at", last24h);

      const { data: logs7d } = await supabase
        .from("api_request_logs")
        .select("id", { count: "exact" })
        .gte("created_at", last7d);

      // Fetch confirmed matches count
      const { data: matches, count: matchCount } = await supabase
        .from("matches")
        .select("id", { count: "exact" })
        .eq("status", "confirmed");

      // Get last activity
      const { data: lastLog } = await supabase
        .from("api_request_logs")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      setStats({
        activeApiKeys: apiKeys?.length || 0,
        callsLast24h: logs24h?.length || 0,
        callsLast7d: logs7d?.length || 0,
        confirmedIntents: matchCount || 0,
        lastActivity: lastLog?.created_at || null,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const formatLastActivity = (timestamp: string | null) => {
    if (!timestamp) return "No activity yet";
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const statCards = [
    {
      label: "Active API Keys",
      value: stats.activeApiKeys,
      icon: Key,
    },
    {
      label: "Calls (24h)",
      value: stats.callsLast24h,
      icon: Activity,
    },
    {
      label: "Calls (7d)",
      value: stats.callsLast7d,
      icon: BarChart3,
    },
    {
      label: "Confirmed Intents",
      value: stats.confirmedIntents,
      icon: FileText,
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Overview</h1>
        <p className="text-muted-foreground">
          Your organisation's API activity at a glance
        </p>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <div
            key={stat.label}
            className="p-4 border border-border rounded-lg bg-background"
          >
            <div className="flex items-center gap-2 mb-2">
              <stat.icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{stat.label}</span>
            </div>
            <p className="text-2xl font-semibold text-foreground">
              {isLoading ? "—" : stat.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* Last Activity */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="h-4 w-4" />
        <span>Last activity: {formatLastActivity(stats.lastActivity)}</span>
      </div>

      {/* Quick Info */}
      <div className="p-4 border border-border rounded-lg bg-muted/30">
        <h3 className="font-medium text-foreground mb-2">What is Compliance Matching API?</h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-3">
          Search for counterparties, record proof-of-intent, and generate tamper-evident audit trails. 
          Confirm Intent creates an information-only record — no payment, no contract, no legal obligation.
        </p>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            SHA-256 hashed evidence
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            Chain-linked audit logs
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            Discovery Engine (+12% results)
          </span>
        </div>
      </div>
    </div>
  );
}
