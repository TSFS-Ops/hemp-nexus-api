import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type Priority = "high" | "medium" | "low";

interface AttentionItem {
  id: string;
  title: string;
  counterparty: string | null;
  meta: string;
  ageLabel: string;
  deadlineLabel: string | null;
  expiresAt: string | null;
  priority: Priority;
  href: string;
}

const STATE_PRIORITY: Record<string, Priority> = {
  pending_finality: "high",
  terms_pending: "high",
  buyer_committed: "medium",
  seller_committed: "medium",
  committed: "medium",
  counterparty_sighted: "low",
};

const PRIORITY_DOT: Record<Priority, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-slate-300",
};

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

function relativeAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.floor(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function deadlineFrom(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return "overdue";
  const hrs = Math.floor(diffMs / 3600000);
  if (hrs < 48) return `expires in ${Math.max(1, hrs)}h`;
  const days = Math.floor(hrs / 24);
  return `expires in ${days}d`;
}

function initialsOf(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "—";
}

export function AttentionPipeline() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["desk-attention", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<AttentionItem[]> => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user!.id)
        .maybeSingle();
      if (!profile?.org_id) return [];

      const { data: matches } = await supabase
        .from("matches")
        .select("id, commodity, quantity_amount, quantity_unit, buyer_name, seller_name, state, buyer_org_id, seller_org_id, org_id, created_at, expires_at")
        .or(`buyer_org_id.eq.${profile.org_id},seller_org_id.eq.${profile.org_id},org_id.eq.${profile.org_id}`)
        .in("state", ["counterparty_sighted", "buyer_committed", "seller_committed", "pending_finality", "terms_pending", "committed"])
        .order("created_at", { ascending: false })
        .limit(8);

      if (!matches) return [];

      return matches.map((m: any) => {
        const isBuyer = m.buyer_org_id === profile.org_id;
        const counterparty = isBuyer ? m.seller_name : m.buyer_name;
        const qty = m.quantity_amount && m.quantity_unit
          ? `${Number(m.quantity_amount).toLocaleString()}${m.quantity_unit}`
          : "Unspecified volume";
        const priority: Priority = STATE_PRIORITY[m.state] ?? "low";
        return {
          id: m.id,
          title: `${qty} ${m.commodity ?? "—"}`,
          counterparty: counterparty ?? null,
          meta: counterparty ? counterparty : "Counterparty pending",
          ageLabel: relativeAge(m.created_at),
          deadlineLabel: deadlineFrom(m.expires_at),
          expiresAt: m.expires_at ?? null,
          priority,
          href: `/desk/deals/${m.id}`,
        };
      });
    },
  });

  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data].sort(
      (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
    );
  }, [data]);

  const highCount = sorted.filter((i) => i.priority === "high").length;

  return (
    <section className="bg-card border border-border shadow-sm rounded-xl overflow-hidden mb-8">
      <div className="bg-muted/80 border-b border-border px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-amber-600" strokeWidth={2} />
          <h2 className="text-xs font-bold tracking-widest uppercase text-muted-foreground">
            Requires Your Attention
          </h2>
        </div>
        {sorted.length > 0 && (
          <div className="flex items-center gap-1.5">
            {highCount > 0 && (
              <span className="bg-red-50 text-red-700 border border-red-200/60 text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide">
                {highCount} urgent
              </span>
            )}
            <span className="bg-amber-50 text-amber-700 border border-amber-200/60 text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide">
              {sorted.length} open
            </span>
          </div>
        )}
      </div>

      <div className="p-2">
        {isLoading ? (
          <AttentionRowsSkeleton />
        ) : sorted.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-border">
            {sorted.map((item) => (
              <li
                key={item.id}
                className="group flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 hover:bg-muted rounded-md transition-colors"
              >
                {/* Priority dot */}
                <span
                  aria-hidden
                  className={cn(
                    "shrink-0 w-2 h-2 rounded-full",
                    PRIORITY_DOT[item.priority],
                    item.priority === "high" && "ring-2 ring-red-200",
                  )}
                  title={`${item.priority} priority`}
                />

                {/* Counterparty initials */}
                <div
                  className="shrink-0 hidden sm:flex items-center justify-center w-8 h-8 rounded-full bg-muted text-muted-foreground text-[10px] font-semibold tracking-wide"
                  title={item.counterparty ?? "Counterparty pending"}
                >
                  {initialsOf(item.counterparty)}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground font-medium leading-snug truncate">
                    {item.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-snug truncate flex items-center gap-1.5 flex-wrap">
                    <span className="truncate">{item.meta}</span>
                    <span className="text-muted-foreground/50">·</span>
                    <span className="font-mono text-muted-foreground/70">{item.ageLabel}</span>
                    {item.deadlineLabel && (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <span
                          className={cn(
                            "font-mono cursor-help",
                            item.deadlineLabel === "overdue"
                              ? "text-red-600 font-semibold"
                              : "text-amber-600",
                          )}
                          title={
                            item.expiresAt
                              ? `Expires ${new Date(item.expiresAt).toLocaleString(undefined, {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })}`
                              : undefined
                          }
                        >
                          {item.deadlineLabel}
                        </span>
                      </>
                    )}
                  </p>
                </div>

                {/* CTA */}
                <button
                  onClick={() => navigate(item.href)}
                  className="shrink-0 inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-md bg-[hsl(var(--emerald))] text-white text-xs font-semibold hover:bg-[hsl(var(--emerald))] shadow-sm transition-colors"
                >
                  <span className="hidden sm:inline">Review &amp; Seal</span>
                  <span className="sm:hidden">Review</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="px-6 py-6 flex items-center gap-3">
      <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[hsl(var(--emerald-muted))] shrink-0">
        <CheckCircle2 className="h-4 w-4 text-[hsl(var(--emerald))]" strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-foreground font-semibold leading-tight">You are all caught up.</p>
        <p className="text-xs text-muted-foreground leading-snug">
          New activity will surface here automatically.
        </p>
      </div>
    </div>
  );
}

function AttentionRowsSkeleton() {
  return (
    <ul className="divide-y divide-border" aria-label="Loading attention items" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3"
        >
          {/* Priority dot */}
          <Skeleton className="shrink-0 w-2 h-2 rounded-full" />
          {/* Initials avatar */}
          <Skeleton className="shrink-0 hidden sm:block w-8 h-8 rounded-full" />
          {/* Content */}
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/2 max-w-[220px]" />
            <Skeleton className="h-2.5 w-2/3 max-w-[280px]" />
          </div>
          {/* CTA */}
          <Skeleton className="shrink-0 h-8 w-20 sm:w-32 rounded-md" />
        </li>
      ))}
    </ul>
  );
}
