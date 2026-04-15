/**
 * AdminOverview - Action-first overview following the Stripe strategy.
 * Surfaces stalled intents, KYC bottlenecks, and system alerts at the top.
 * Static counts are secondary. No decorative widgets.
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  Clock,
  Shield,
  Users,
  GitCompare,
  Key,
  ArrowRight,
  Activity,
  FileWarning,
  CheckCircle2,
  Blocks,
  UserX,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { MATCH_STATUS, RESOURCE_STATUS, ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface ActionItem {
  severity: "critical" | "warning" | "info";
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  count?: number;
  href: string;
  linkLabel: string;
}

export function AdminOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-overview-v2"],
    queryFn: async () => {
      const now = new Date();
      const h48ago = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
      const h24ago = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);

      const [
        stalledPois,
        kycPending,
        recentErrors,
        totalUsers,
        totalOrgs,
        totalMatches,
        confirmedMatches,
        activeKeys,
        requestsToday,
        activeSignals,
        openDisputes,
        uncontactedCounterparties,
      ] = await Promise.all([
        // Stalled intents: unilateral drafts older than 48h with no trading partner
        supabase.from("matches").select("id", { count: "exact", head: true })
          .eq("status", "draft")
          .is("seller_org_id", null)
          .lt("created_at", h48ago),
        // KYC bottlenecks: orgs with no completed KYC
        supabase.from("kyc_status").select("id", { count: "exact", head: true })
          .neq("status", "verified"),
        // System errors last 24h
        supabase.from("api_request_logs").select("id", { count: "exact", head: true })
          .gte("status_code", 500)
          .gte("created_at", h24ago),
        // Counts
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("organizations").select("id", { count: "exact", head: true }),
        supabase.from("matches").select("id", { count: "exact", head: true }),
        supabase.from("matches").select("id", { count: "exact", head: true }).eq("status", MATCH_STATUS.SETTLED),
        supabase.from("api_keys").select("id", { count: "exact", head: true }).eq("status", RESOURCE_STATUS.ACTIVE),
        supabase.from("api_request_logs").select("id", { count: "exact", head: true }).gte("created_at", today.toISOString()),
        supabase.from("signals").select("id", { count: "exact", head: true }).eq("status", RESOURCE_STATUS.ACTIVE),
        supabase.from("disputes").select("id", { count: "exact", head: true }).eq("status", "open"),
        // Off-platform counterparties awaiting manual outreach
        supabase.from("poi_engagements").select("id", { count: "exact", head: true })
          .eq("counterparty_type", "unknown")
          .eq("engagement_status", "notification_sent"),
      ]);

      return {
        stalledPois: stalledPois.count ?? 0,
        kycPending: kycPending.count ?? 0,
        recentErrors: recentErrors.count ?? 0,
        totalUsers: totalUsers.count ?? 0,
        totalOrgs: totalOrgs.count ?? 0,
        totalMatches: totalMatches.count ?? 0,
        confirmedMatches: confirmedMatches.count ?? 0,
        activeKeys: activeKeys.count ?? 0,
        requestsToday: requestsToday.count ?? 0,
        activeSignals: activeSignals.count ?? 0,
        openDisputes: openDisputes.count ?? 0,
        uncontactedCounterparties: uncontactedCounterparties.count ?? 0,
      };
    },
    staleTime: 30_000,
  });

  const s = data ?? {
    stalledPois: 0, kycPending: 0, recentErrors: 0, totalUsers: 0,
    totalOrgs: 0, totalMatches: 0, confirmedMatches: 0, activeKeys: 0,
    requestsToday: 0, activeSignals: 0, openDisputes: 0, uncontactedCounterparties: 0,
  };

  // Build action items dynamically
  const actions: ActionItem[] = [];

  if (s.stalledPois > 0) {
    actions.push({
      severity: "warning",
      icon: Clock,
      title: "Stalled unilateral intents",
      description: `${s.stalledPois} draft request${s.stalledPois !== 1 ? "s" : ""} without trading partner acceptance for over 48 hours.`,
      count: s.stalledPois,
      href: ROUTES.ADMIN_DEALS + "?tab=matches",
      linkLabel: "Review stalled deals",
    });
  }
  if (s.kycPending > 0) {
    actions.push({
      severity: "warning",
      icon: FileWarning,
      title: "KYC verification pending",
      description: `${s.kycPending} organisation${s.kycPending !== 1 ? "s" : ""} with incomplete identity verification.`,
      count: s.kycPending,
      href: ROUTES.ADMIN_COMPLIANCE + "?tab=kyc",
      linkLabel: "Review KYC queue",
    });
  }
  if (s.openDisputes > 0) {
    actions.push({
      severity: "critical",
      icon: AlertTriangle,
      title: "Open disputes",
      description: `${s.openDisputes} unresolved dispute${s.openDisputes !== 1 ? "s" : ""} requiring admin intervention.`,
      count: s.openDisputes,
      href: ROUTES.ADMIN_COMPLIANCE + "?tab=disputes",
      linkLabel: "Resolve disputes",
    });
  }
  if (s.recentErrors > 10) {
    actions.push({
      severity: "critical",
      icon: AlertTriangle,
      title: "Elevated error rate",
      description: `${s.recentErrors} server errors (5xx) in the last 24 hours. Investigate immediately.`,
      count: s.recentErrors,
      href: ROUTES.ADMIN_SYSTEM_LOGS,
      linkLabel: "View system logs",
    });
  }

  const severityStyles = {
    critical: "border-destructive/40 bg-destructive/5",
    warning: "border-amber-500/40 bg-amber-500/5",
    info: "border-border",
  };
  const severityIconStyles = {
    critical: "text-destructive",
    warning: "text-amber-600",
    info: "text-muted-foreground",
  };

  const counters = [
    { label: "Matches", value: s.totalMatches, sub: `${s.confirmedMatches} settled`, icon: GitCompare, href: ROUTES.ADMIN_DEALS },
    { label: "Signals", value: s.activeSignals, sub: "Active", icon: Activity, href: ROUTES.ADMIN_DEALS },
    { label: "Users", value: s.totalUsers, sub: "Registered", icon: Users, href: ROUTES.ADMIN_USERS },
    { label: "API Keys", value: s.activeKeys, sub: "Active", icon: Key, href: ROUTES.ADMIN_API_KEYS },
    { label: "Requests", value: s.requestsToday, sub: "Today", icon: Blocks, href: ROUTES.ADMIN_SYSTEM_LOGS },
    { label: "Orgs", value: s.totalOrgs, sub: "Registered", icon: Shield, href: ROUTES.ADMIN_ORGS },
  ];

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <Skeleton className="h-7 w-48 mb-2" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="space-y-3">
          {[1, 2].map(i => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <header>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
          Platform Overview
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Operational status and items requiring attention across the Izenzo platform.
        </p>
      </header>

      {/* Action Required Section */}
      {actions.length > 0 ? (
        <section>
          <h2 className="text-xs font-semibold tracking-[0.08em] uppercase text-muted-foreground mb-3">
            Action Required
          </h2>
          <div className="space-y-2">
            {actions.map((action) => (
              <Link
                key={action.title}
                to={action.href}
                className={cn(
                  "flex items-start gap-3 p-4 rounded-lg border transition-colors hover:bg-accent/30",
                  severityStyles[action.severity]
                )}
              >
                <action.icon className={cn("h-5 w-5 mt-0.5 shrink-0", severityIconStyles[action.severity])} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-foreground">{action.title}</h3>
                    {action.count != null && (
                      <Badge variant="secondary" className="text-xs font-mono">
                        {action.count}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
                </div>
                <span className="text-xs font-medium text-foreground shrink-0 flex items-center gap-1 mt-0.5">
                  {action.linkLabel}
                  <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section className="flex items-center gap-3 p-4 rounded-lg border border-border bg-muted/20">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <div>
            <h3 className="text-sm font-medium text-foreground">All clear</h3>
            <p className="text-xs text-muted-foreground">No items require immediate attention.</p>
          </div>
        </section>
      )}

      {/* System Counters */}
      <section>
        <h2 className="text-xs font-semibold tracking-[0.08em] uppercase text-muted-foreground mb-3">
          System Status
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {counters.map((c) => (
            <Link
              key={c.label}
              to={c.href}
              className="p-4 rounded-lg border border-border bg-background hover:bg-accent/20 transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{c.label}</span>
                <c.icon className="h-3.5 w-3.5 text-muted-foreground/50" />
              </div>
              <p className="text-2xl font-semibold text-foreground font-mono tracking-tight">
                {c.value.toLocaleString()}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{c.sub}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
