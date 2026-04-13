import { useState, lazy, Suspense } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Key, Activity, FileText, BarChart3, Clock, Search, ArrowRight, BookOpen, Zap, Handshake, Play, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";
import { useNavigate, Link } from "react-router-dom";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";

const OnboardingWizard = lazy(() => import("@/components/OnboardingWizard"));

import { KYCStatusCard } from "@/components/dashboard/KYCStatusCard";
function GettingStartedEmpty({ onStartWizard }: { onStartWizard: () => void }) {
  const navigate = useNavigate();

  const steps = [
    {
      number: "1",
      title: "Search for a trading partner",
      description: "Find verified buyers or sellers by commodity, region, or company name.",
      icon: Search,
      action: () => navigate(ROUTES.DASHBOARD_SEARCH),
      actionLabel: "Start searching",
    },
    {
      number: "2",
      title: "Create a match",
      description: "Select one or more trading partners and create a match to begin the workflow.",
      icon: Handshake,
      action: () => navigate(ROUTES.DASHBOARD_SEARCH),
      actionLabel: "Find trading partners",
    },
    {
      number: "3",
      title: "Proof of Intent",
      description: "Generate a Proof of Intent — 1 credit (R10). Non-binding, irreversible, fully audited.",
      icon: Zap,
      action: () => navigate(ROUTES.DASHBOARD_MATCHES),
      actionLabel: "View matches",
    },
    {
      number: "4",
      title: "Download evidence pack",
      description: "Get a tamper-evident evidence pack for your compliance records.",
      icon: Key,
      action: () => navigate(ROUTES.DASHBOARD_MATCHES),
      actionLabel: "View matches",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center py-8 px-4">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Zap className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          Welcome to your Console
        </h2>
        <p className="text-muted-foreground max-w-md mx-auto leading-relaxed">
          You're all set up. Follow the steps below to complete your first trading partner workflow, or launch the guided setup wizard.
        </p>
      </div>

      {/* Steps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {steps.map((step) => (
          <button
            key={step.number}
            onClick={step.action}
            className="relative p-5 rounded-lg border border-border bg-background hover:border-primary/40 hover:bg-accent/30 transition-colors text-left group"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {step.number}
              </span>
              <div className="space-y-1 flex-1">
                <h3 className="font-medium text-sm text-foreground">{step.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{step.description}</p>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-primary mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {step.actionLabel}
                  <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <Button onClick={onStartWizard} className="gap-2">
          <Play className="h-4 w-4" />
          Launch setup wizard
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" onClick={() => navigate(ROUTES.DASHBOARD_SEARCH)} className="gap-2">
          <Search className="h-4 w-4" />
          Skip - run a search now
        </Button>
        <Button variant="ghost" onClick={() => navigate(ROUTES.DOCS)} className="gap-2">
          <BookOpen className="h-4 w-4" />
          Read the docs
        </Button>
      </div>
    </div>
  );
}

export function ConsoleOverview() {
  const { session } = useAuth();
  const navigate = useNavigate();

  const [wizardOpen, setWizardOpen] = useState(false);

  // Fetch the user's org_id first, then their token balance
  const { data: userProfile } = useQuery({
    queryKey: ["user-profile-org", session?.user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", session!.user.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!session,
  });

  const { data: tokenBalance } = useQuery({
    queryKey: ["token-balance", userProfile?.org_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("token_balances")
        .select("balance, minimum_required")
        .eq("org_id", userProfile!.org_id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!session && !!userProfile?.org_id,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: stats, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["console-overview-stats"],
    queryFn: async () => {
      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [apiKeys, logs24h, logs7d, matches, lastLog] = await Promise.all([
        supabase.from("api_keys").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("api_request_logs").select("id", { count: "exact", head: true }).gte("created_at", last24h),
        supabase.from("api_request_logs").select("id", { count: "exact", head: true }).gte("created_at", last7d),
        supabase.from("matches").select("id", { count: "exact", head: true }).eq("status", "confirmed"),
        supabase.from("api_request_logs").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);

      // Check for individual query errors - a partial failure must not look like zero activity
      const anyError = [apiKeys, logs24h, logs7d, matches, lastLog].find(r => r.error);
      if (anyError?.error) {
        throw new Error(anyError.error.message || "Failed to load console data");
      }

      return {
        activeApiKeys: apiKeys.count || 0,
        callsLast24h: logs24h.count || 0,
        callsLast7d: logs7d.count || 0,
        confirmedIntents: matches.count || 0,
        lastActivity: lastLog.data?.created_at || null,
      };
    },
    enabled: !!session,
  });

  const currentBalance = tokenBalance?.balance ?? 0;
  const isBalanceLow = currentBalance <= 200;
  const isBalanceCritical = currentBalance <= 50;

  const statCards = [
    { label: "Active API Keys", value: stats?.activeApiKeys ?? 0, icon: Key },
    { label: "Calls (24h)", value: stats?.callsLast24h ?? 0, icon: Activity },
    { label: "Calls (7d)", value: stats?.callsLast7d ?? 0, icon: BarChart3 },
    { label: "Trade Requests", value: stats?.confirmedIntents ?? 0, icon: FileText },
  ];

  const hasZeroActivity = !isLoading && stats &&
    stats.activeApiKeys === 0 &&
    stats.callsLast24h === 0 &&
    stats.callsLast7d === 0 &&
    stats.confirmedIntents === 0 &&
    !stats.lastActivity;

  return (
    <div className="space-y-6">
      
      <header>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Console</h1>
        <p className="text-muted-foreground">
          Your activity at a glance - search, match, and send trade requests
        </p>
      </header>

      {/* Error state - distinct from zero-activity onboarding */}
      {isError && (
        <div className="p-6 border border-destructive/30 rounded-lg bg-destructive/5 text-center">
          <p className="font-medium text-foreground mb-1">Couldn't load your activity</p>
          <p className="text-sm text-muted-foreground mb-4">
            We had trouble fetching your console data. This is usually temporary - try refreshing.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
            <a href="mailto:support@izenzo.co.za" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Contact support
            </a>
          </div>
        </div>
      )}

      {/* Credit Balance Card - prominent, client-requested */}
      {!isError && tokenBalance && (
        <Link
          to="/billing"
          className={cn(
            "flex items-center justify-between p-4 rounded-lg border transition-colors hover:bg-accent/30",
            isBalanceCritical
              ? "border-destructive/50 bg-destructive/5"
              : isBalanceLow
                ? "border-amber-500/50 bg-amber-500/5"
                : "border-primary/30 bg-primary/5"
          )}
        >
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full",
              isBalanceCritical ? "bg-destructive/10" : isBalanceLow ? "bg-amber-500/10" : "bg-primary/10"
            )}>
              <Coins className={cn(
                "h-5 w-5",
                isBalanceCritical ? "text-destructive" : isBalanceLow ? "text-amber-600" : "text-primary"
              )} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Credit Balance</p>
              <p className={cn(
                "text-2xl font-bold",
                isBalanceCritical ? "text-destructive" : isBalanceLow ? "text-amber-600" : "text-foreground"
              )}>
                {currentBalance.toLocaleString()}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">R10 per action</p>
            {isBalanceCritical && (
              <p className="text-xs font-medium text-destructive mt-1">Top up now →</p>
            )}
            {isBalanceLow && !isBalanceCritical && (
              <p className="text-xs font-medium text-amber-600 mt-1">Running low →</p>
            )}
            {!isBalanceLow && (
              <p className="text-xs text-muted-foreground mt-1">Purchase credits →</p>
            )}
          </div>
        </Link>
      )}

      {/* Stats Grid - only render when we have data or are loading (not on error) */}
      {!isError && (
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
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-semibold text-foreground">
                  {stat.value.toLocaleString()}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* KYC Status - always visible when logged in */}
      {!isError && !isLoading && (
        <KYCStatusCard />
      )}

      {/* Last Activity */}
      {!isError && !hasZeroActivity && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>Last activity: {formatRelativeTime(stats?.lastActivity)}</span>
        </div>
      )}

      {/* Empty state or info block - only show onboarding when query SUCCEEDED with zero data */}
      {!isError && hasZeroActivity ? (
        <GettingStartedEmpty onStartWizard={() => setWizardOpen(true)} />
      ) : !isError && !hasZeroActivity && !isLoading ? (
        <div className="space-y-4">
          {/* Contextual next-step prompt */}
          {stats && (() => {
            const hasKeys = stats.activeApiKeys > 0;
            const hasSearches = stats.callsLast24h > 0 || stats.callsLast7d > 0;
            const hasIntents = stats.confirmedIntents > 0;

            if (!hasKeys) {
              return (
                <div className="p-4 border border-primary/30 rounded-lg bg-primary/5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">Your next step: Create an API key</p>
                    <p className="text-xs text-muted-foreground mt-0.5">You need an API key to run searches and interact with the platform programmatically.</p>
                  </div>
                  <Button size="sm" onClick={() => navigate(ROUTES.DASHBOARD_SETTINGS)}>
                    <Key className="h-3.5 w-3.5 mr-1.5" />
                    Create API key
                  </Button>
                </div>
              );
            }
            if (!hasSearches) {
              return (
                <div className="p-4 border border-primary/30 rounded-lg bg-primary/5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">Your next step: Run your first search</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Search for trading partners by commodity, region, or company name to find potential matches.</p>
                  </div>
                  <Button size="sm" onClick={() => navigate(ROUTES.DASHBOARD_SEARCH)}>
                    <Search className="h-3.5 w-3.5 mr-1.5" />
                    Start searching
                  </Button>
                </div>
              );
            }
            if (!hasIntents) {
              return (
                <div className="p-4 border border-primary/30 rounded-lg bg-primary/5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">Your next step: Send a trade request on a match</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Open an existing match and signal your interest. This creates an immutable trade request record.</p>
                  </div>
                  <Button size="sm" onClick={() => navigate(ROUTES.DASHBOARD_MATCHES)}>
                    <Handshake className="h-3.5 w-3.5 mr-1.5" />
                    View matches
                  </Button>
                </div>
              );
            }
            return null;
          })()}

          <div className="p-5 border border-border rounded-lg bg-muted/30">
            <h3 className="font-medium text-foreground mb-3">How it works</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { step: "1", label: "Search", desc: "Find trading partners" },
                { step: "2", label: "Match", desc: "Select & create" },
                { step: "3", label: "Proof of Intent", desc: "Generate proof" },
                { step: "4", label: "Without a Doubt", desc: "Seal evidence" },
              ].map((s) => (
                <div key={s.step} className="text-center p-3 rounded-md bg-background border border-border">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary mb-1">
                    {s.step}
                  </span>
                  <p className="text-xs font-medium text-foreground">{s.label}</p>
                  <p className="text-[10px] text-muted-foreground">{s.desc}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Confirming intent records your interest - no contract, no payment, no legal obligation.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="default" size="sm" onClick={() => navigate(ROUTES.DASHBOARD_SEARCH)} className="gap-2">
                <Search className="h-3.5 w-3.5" />
                Search trading partners
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate(ROUTES.DASHBOARD_MATCHES)} className="gap-2">
                <FileText className="h-3.5 w-3.5" />
                View matches
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Onboarding Wizard */}
      <Suspense fallback={null}>
        <OnboardingWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
      </Suspense>
    </div>
  );
}