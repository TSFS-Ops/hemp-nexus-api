import { useState, lazy, Suspense } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Key, Activity, FileText, BarChart3, Clock, Search, ArrowRight, BookOpen, Zap, Handshake, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/lib/constants";

const OnboardingWizard = lazy(() => import("@/components/OnboardingWizard"));
function GettingStartedEmpty({ onStartWizard }: { onStartWizard: () => void }) {
  const navigate = useNavigate();

  const steps = [
    {
      number: "1",
      title: "Search for a counterparty",
      description: "Find verified buyers or sellers by commodity, region, or company name.",
      icon: Search,
      action: () => navigate(ROUTES.DASHBOARD_SEARCH),
      actionLabel: "Start searching",
    },
    {
      number: "2",
      title: "Create a match",
      description: "Select one or more counterparties and create a match to begin the workflow.",
      icon: Handshake,
      action: () => navigate(ROUTES.DASHBOARD_SEARCH),
      actionLabel: "Find counterparties",
    },
    {
      number: "3",
      title: "Confirm intent",
      description: "Signal your serious interest — no contract, no payment, just a verifiable audit record.",
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
          You're all set up. Follow the steps below to complete your first counterparty workflow, or launch the guided setup wizard.
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
          Skip — run a search now
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

  // Onboarding wizard state — auto-open for first-time users
  const [wizardOpen, setWizardOpen] = useState(() => {
    try {
      return localStorage.getItem("onboarding_completed") !== "true";
    } catch {
      return false;
    }
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

      // Check for individual query errors — a partial failure must not look like zero activity
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

  const statCards = [
    { label: "Active API Keys", value: stats?.activeApiKeys ?? 0, icon: Key },
    { label: "Calls (24h)", value: stats?.callsLast24h ?? 0, icon: Activity },
    { label: "Calls (7d)", value: stats?.callsLast7d ?? 0, icon: BarChart3 },
    { label: "Confirmed Intents", value: stats?.confirmedIntents ?? 0, icon: FileText },
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
          Your activity at a glance — search, match, and confirm intent
        </p>
      </header>

      {/* Error state — distinct from zero-activity onboarding */}
      {isError && (
        <div className="p-6 border border-destructive/30 rounded-lg bg-destructive/5 text-center">
          <p className="font-medium text-foreground mb-1">Couldn't load your activity</p>
          <p className="text-sm text-muted-foreground mb-4">
            We had trouble fetching your console data. This is usually temporary — try refreshing.
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

      {/* Stats Grid — only render when we have data or are loading (not on error) */}
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

      {/* Last Activity */}
      {!isError && !hasZeroActivity && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>Last activity: {formatRelativeTime(stats?.lastActivity)}</span>
        </div>
      )}

      {/* Empty state or info block — only show onboarding when query SUCCEEDED with zero data */}
      {!isError && hasZeroActivity ? (
        <GettingStartedEmpty onStartWizard={() => setWizardOpen(true)} />
      ) : !isError && !hasZeroActivity && !isLoading ? (
        <div className="p-5 border border-border rounded-lg bg-muted/30">
          <h3 className="font-medium text-foreground mb-3">How it works</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { step: "1", label: "Search", desc: "Find counterparties" },
              { step: "2", label: "Match", desc: "Select & create" },
              { step: "3", label: "Confirm", desc: "Signal intent" },
              { step: "4", label: "Evidence", desc: "Download pack" },
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
            Confirming intent records your interest — no contract, no payment, no legal obligation.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="default" size="sm" onClick={() => navigate(ROUTES.DASHBOARD_SEARCH)} className="gap-2">
              <Search className="h-3.5 w-3.5" />
              Search counterparties
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate(ROUTES.DASHBOARD_MATCHES)} className="gap-2">
              <FileText className="h-3.5 w-3.5" />
              View matches
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}